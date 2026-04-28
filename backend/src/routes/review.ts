import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { canReadAllReviews, canReadAllJobs, ownerScope } from "../services/access";
import { writeAudit } from "../services/audit";
import { upsertActiveForbiddenPhrase } from "../compliance/forbidden/service";

const router = Router();

const VALID_ISSUE_CODES = [
  "tone",
  "terminology",
  "grammar",
  "fluency",
  "literal_translation",
  "brand_voice",
  "register",
] as const;

const reviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().optional(),
  issueCodes: z
    .array(z.enum(VALID_ISSUE_CODES))
    .optional()
    .default([]),
  correctedTranslation: z.string().optional(),
  reviewerId: z.string().optional(),
  /**
   * Phrases the reviewer wants the AI to never produce again for the
   * output's target locale. Each becomes a ForbiddenPhrase row, scoped to
   * the locale, with `triggeringReviewId` pointing at this review for
   * provenance. Idempotent — duplicate submissions reactivate (not error).
   */
  forbiddenPhrases: z.array(z.string().min(1).max(500)).max(50).optional().default([]),
});

// Create a review for an output — REVIEWER+ only.
router.post("/:outputId", requireRole("REVIEWER", "MANAGER", "ADMIN"), async (req, res) => {
  const outputId = Number(req.params.outputId);
  if (Number.isNaN(outputId)) {
    return res.status(400).json({ error: "Invalid output id." });
  }

  try {
    const payload = reviewSchema.parse(req.body);

    const output = await prisma.translationOutput.findUnique({
      where: { id: outputId },
      include: { job: { select: { targetLocale: true } } },
    });
    if (!output) {
      return res.status(404).json({ error: "Output not found." });
    }
    const targetLocale = output.job.targetLocale;

    const authUser = req.authUser!;
    const review = await prisma.$transaction(async (tx) => {
      // Create the review record — reviewerUserId is the authoritative actor
      // identity; the legacy free-form `reviewerId` is kept for backward compat.
      const created = await tx.translationReview.create({
        data: {
          outputId,
          decision: payload.decision,
          note: payload.note,
          issueCodes: payload.issueCodes.length
            ? JSON.stringify(payload.issueCodes)
            : null,
          correctedTranslation: payload.correctedTranslation,
          reviewerId: payload.reviewerId,
          reviewerUserId: authUser.id,
        },
      });

      // Also update the output's approved flag for backward compat
      const updatedOutput = await tx.translationOutput.update({
        where: { id: outputId },
        data: {
          approved: payload.decision === "approved",
          reviewNote: payload.note,
        },
      });

      // Append a history snapshot for the post-update output state. Version
      // number is (max + 1) for this output — the @@unique constraint
      // enforces monotonicity; a race between two concurrent reviews on the
      // same output will lose one transaction to a unique violation, which
      // is the correct failure mode (no interleaved state loss).
      const lastVersion = await tx.translationOutputVersion.findFirst({
        where: { translationOutputId: outputId },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      await tx.translationOutputVersion.create({
        data: {
          translationOutputId: outputId,
          versionNumber: (lastVersion?.versionNumber ?? 0) + 1,
          eventType: "review_update",
          outputText: updatedOutput.outputText,
          correctedTranslation: payload.correctedTranslation ?? null,
          approved: updatedOutput.approved,
          reviewNote: updatedOutput.reviewNote,
          score: updatedOutput.score,
          issueCodesJson: payload.issueCodes.length
            ? JSON.stringify(payload.issueCodes)
            : null,
          triggeringReviewId: created.id,
          createdByUserId: authUser.id,
        },
      });

      // Reviewer-flagged compliance phrases. Each becomes a ForbiddenPhrase
      // row scoped to the output's targetLocale, idempotent — duplicate
      // submissions reactivate. The runtime translation prompt builders
      // pick these up automatically on the next translate call.
      for (const raw of payload.forbiddenPhrases) {
        const phrase = raw.trim();
        if (!phrase) continue;
        await upsertActiveForbiddenPhrase({
          phrase,
          localeCode: targetLocale,
          reason: payload.note ?? "reviewer-flagged via review submission",
          addedByUserId: authUser.id,
          triggeringReviewId: created.id,
        }, tx);
      }

      return created;
    });

    // review.approve / review.reject — log actor + decision + structured
    // issue codes. The correctedTranslation field is deliberately excluded
    // (can be arbitrarily long) — its id is captured via entityId.
    await writeAudit(req, {
      action: payload.decision === "approved" ? "review.approve" : "review.reject",
      entityType: "TranslationReview",
      entityId: review.id,
      after: {
        id: review.id,
        outputId,
        decision: payload.decision,
        issueCodes: payload.issueCodes,
        note: payload.note ?? null,
        correctedTranslationLength: payload.correctedTranslation?.length ?? 0,
        reviewerUserId: authUser.id,
        forbiddenPhrasesAdded: payload.forbiddenPhrases.length,
      },
    });

    res.status(201).json({ review });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }
    console.error(error);
    res.status(500).json({ error: "Unable to create review." });
  }
});

// Get version history for an output. Anchored on TranslationOutput — returns
// every TranslationOutputVersion in ascending versionNumber order. Same
// ownership/RBAC rules as the review GET: USER sees only their own jobs'
// outputs; REVIEWER+ sees all. On mismatch, return 404 (no info leak about
// the existence of other users' outputs).
router.get("/:outputId/history", requireAuth, async (req, res) => {
  const outputId = Number(req.params.outputId);
  if (Number.isNaN(outputId)) {
    return res.status(400).json({ error: "Invalid output id." });
  }

  const authUser = req.authUser!;

  if (!canReadAllReviews(authUser.role)) {
    const output = await prisma.translationOutput.findFirst({
      where: {
        id: outputId,
        job: ownerScope(authUser, canReadAllJobs, "createdByUserId"),
      },
      select: { id: true },
    });
    if (!output) return res.status(404).json({ error: "Not found." });
  }

  const versions = await prisma.translationOutputVersion.findMany({
    where: { translationOutputId: outputId },
    orderBy: { versionNumber: "asc" },
    select: {
      id: true,
      versionNumber: true,
      eventType: true,
      outputText: true,
      correctedTranslation: true,
      approved: true,
      reviewNote: true,
      score: true,
      issueCodesJson: true,
      triggeringReviewId: true,
      createdByUserId: true,
      createdAt: true,
    },
  });

  res.json({ versions });
});

// Get all reviews for an output. USER sees reviews only for outputs of jobs
// they own; REVIEWER+ sees all reviews.
router.get("/:outputId", requireAuth, async (req, res) => {
  const outputId = Number(req.params.outputId);
  if (Number.isNaN(outputId)) {
    return res.status(400).json({ error: "Invalid output id." });
  }

  const authUser = req.authUser!;

  if (!canReadAllReviews(authUser.role)) {
    // USER: confirm the output belongs to a job they own, else 404.
    const output = await prisma.translationOutput.findFirst({
      where: {
        id: outputId,
        job: ownerScope(authUser, canReadAllJobs, "createdByUserId"),
      },
      select: { id: true },
    });
    if (!output) return res.status(404).json({ error: "Not found." });
  }

  const reviews = await prisma.translationReview.findMany({
    where: { outputId },
    orderBy: { createdAt: "desc" },
  });

  res.json({ reviews });
});

export default router;
