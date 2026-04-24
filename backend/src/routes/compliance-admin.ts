/**
 * Admin routes for the compliance source-of-truth workflow.
 *
 * Covers: obligations CRUD, rules CRUD, review tasks, bundle compile/publish.
 *
 * Mounted at /api/compliance/admin. Protected by requireRole("MANAGER","ADMIN")
 * middleware in app.ts.
 *
 * ───── Audit policy ──────────────────────────────────────────────────
 * Every mutation on this router is fully atomic: the business write and
 * the AuditLog insert happen inside the same Prisma $transaction, so a
 * failure of either rolls back both. writeAuditTx is the only audit helper
 * used here — its transaction-aware semantics are what the "fail-closed"
 * contract now relies on. If Prisma cannot write the audit row, the
 * obligation/rule/bundle change is rolled back and the request returns 500.
 * ─────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import {
  createObligation,
  updateObligation,
  transitionObligation,
  listObligations,
  getObligation,
  serializeObligation,
  serializeRule,
} from "../compliance/obligations/service";
import {
  createRule,
  updateRule,
  deleteRule,
} from "../compliance/rules/service";
import {
  listTasks,
  getTask,
  assignTask,
  decideTask,
} from "../compliance/review/service";
import { compileDraftBundle } from "../compliance/bundles/compiler";
import { publishBundle, getPublishedBundle } from "../compliance/bundles/publisher";
import { writeAuditTx } from "../services/audit";

const router = Router();

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

// ═══════════════════════════════════════════════════════════════════════
// OBLIGATIONS
// ═══════════════════════════════════════════════════════════════════════

const createObligationSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  jurisdiction: z.string().min(1),
  localeCode: z.string().nullable().optional(),
  category: z.string().min(1),
  severity: z.enum(["critical", "major", "minor"]),
  sourceRefs: z.array(z.record(z.unknown())).default([]),
  createdBy: z.string().optional(),
});

const transitionSchema = z.object({
  status: z.enum(["pending", "reviewed", "approved", "rejected", "superseded"]),
  actor: z.string().min(1),
  note: z.string().optional(),
});

router.get("/obligations", async (req, res) => {
  try {
    const rows = await listObligations({
      status: qStr(req.query.status),
      jurisdiction: qStr(req.query.jurisdiction),
      localeCode: qStr(req.query.localeCode),
      category: qStr(req.query.category),
    });
    res.json({ obligations: rows.map(serializeObligation) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/obligations/:id", async (req, res) => {
  try {
    const row = await getObligation(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Obligation not found." });
    res.json({ obligation: serializeObligation(row) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/obligations", async (req, res) => {
  try {
    const payload = createObligationSchema.parse(req.body);
    const row = await prisma.$transaction(async (tx) => {
      const created = await createObligation(payload, tx);
      await writeAuditTx(tx, req, {
        action: "compliance.obligation.create",
        entityType: "ComplianceObligation",
        entityId: created.id,
        after: serializeObligation(created),
      });
      return created;
    });
    res.status(201).json({ obligation: serializeObligation(row) });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: err.message });
  }
});

router.put("/obligations/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.$transaction(async (tx) => {
      const before = await getObligation(id, tx);
      const updated = await updateObligation(id, req.body, tx);
      await writeAuditTx(tx, req, {
        action: "compliance.obligation.update",
        entityType: "ComplianceObligation",
        entityId: updated.id,
        before: before ? serializeObligation(before) : null,
        after: serializeObligation(updated),
      });
      return updated;
    });
    res.json({ obligation: serializeObligation(row) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/obligations/:id/transition", async (req, res) => {
  try {
    const { status, actor, note } = transitionSchema.parse(req.body);
    const id = Number(req.params.id);
    const row = await prisma.$transaction(async (tx) => {
      const before = await getObligation(id, tx);
      const updated = await transitionObligation(id, status, actor, note, tx);
      await writeAuditTx(tx, req, {
        action: "compliance.obligation.transition",
        entityType: "ComplianceObligation",
        entityId: updated.id,
        before: before ? { status: before.status } : null,
        after: { status: updated.status },
        metadata: { actor, note: note ?? null },
      });
      return updated;
    });
    res.json({ obligation: serializeObligation(row) });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    if (err.message?.includes("Invalid transition")) return res.status(409).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// COMPLIANCE RULES
// ═══════════════════════════════════════════════════════════════════════

const createRuleSchema = z.object({
  obligationId: z.number(),
  ruleType: z.enum(["banned_phrase", "regex", "required_disclaimer", "prominence", "semantic_check", "conditional_disclosure"]),
  config: z.record(z.unknown()),
  localeCode: z.string().nullable().optional(),
  severity: z.enum(["critical", "major", "minor"]).nullable().optional(),
  enabled: z.boolean().optional(),
});

router.post("/rules", async (req, res) => {
  try {
    const payload = createRuleSchema.parse(req.body);
    const row = await prisma.$transaction(async (tx) => {
      const created = await createRule(payload, tx);
      await writeAuditTx(tx, req, {
        action: "compliance.rule.create",
        entityType: "ComplianceRule",
        entityId: created.id,
        after: serializeRule(created),
      });
      return created;
    });
    res.status(201).json({ rule: serializeRule(row) });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: err.message });
  }
});

router.put("/rules/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.$transaction(async (tx) => {
      const before = await tx.complianceRule.findUnique({ where: { id } });
      const updated = await updateRule(id, req.body, tx);
      await writeAuditTx(tx, req, {
        action: "compliance.rule.update",
        entityType: "ComplianceRule",
        entityId: updated.id,
        before: before ? serializeRule(before) : null,
        after: serializeRule(updated),
      });
      return updated;
    });
    res.json({ rule: serializeRule(row) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/rules/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.$transaction(async (tx) => {
      const before = await tx.complianceRule.findUnique({ where: { id } });
      await deleteRule(id, tx);
      await writeAuditTx(tx, req, {
        action: "compliance.rule.delete",
        entityType: "ComplianceRule",
        entityId: id,
        before: before ? serializeRule(before) : null,
      });
    });
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// LEGAL REVIEW TASKS
// ═══════════════════════════════════════════════════════════════════════

router.get("/review-tasks", async (req, res) => {
  try {
    const rows = await listTasks({
      status: qStr(req.query.status),
      kind: qStr(req.query.kind),
      assignee: qStr(req.query.assignee),
    });
    res.json({ tasks: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/review-tasks/:id", async (req, res) => {
  try {
    const row = await getTask(Number(req.params.id));
    if (!row) return res.status(404).json({ error: "Review task not found." });
    res.json({ task: row });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/review-tasks/:id/assign", async (req, res) => {
  try {
    const { assignee } = z.object({ assignee: z.string().min(1) }).parse(req.body);
    const id = Number(req.params.id);
    const row = await prisma.$transaction(async (tx) => {
      const before = await getTask(id, tx);
      const updated = await assignTask(id, assignee, tx);
      await writeAuditTx(tx, req, {
        action: "compliance.review_task.assign",
        entityType: "LegalReviewTask",
        entityId: id,
        before: before ? { assignee: before.assignee, status: before.status } : null,
        after: { assignee: updated.assignee, status: updated.status },
      });
      return updated;
    });
    res.json({ task: row });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: err.message });
  }
});

const decideSchema = z.object({
  decision: z.enum(["approved", "rejected", "needs_changes"]),
  decidedBy: z.string().min(1),
  note: z.string().optional(),
});

router.post("/review-tasks/:id/decide", async (req, res) => {
  try {
    const payload = decideSchema.parse(req.body);
    const id = Number(req.params.id);
    const row = await prisma.$transaction(async (tx) => {
      const before = await getTask(id, tx);
      const updated = await decideTask(id, payload.decision, payload.decidedBy, payload.note, tx);
      await writeAuditTx(tx, req, {
        action: "compliance.review_task.decide",
        entityType: "LegalReviewTask",
        entityId: id,
        before: before ? { status: before.status, decision: before.decision } : null,
        after: { status: updated.status, decision: updated.decision },
        metadata: { decidedBy: payload.decidedBy, note: payload.note ?? null },
      });
      return updated;
    });
    res.json({ task: row });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// RULE BUNDLES
// ═══════════════════════════════════════════════════════════════════════

const compileBundleSchema = z.object({
  localeCode: z.string().min(2),
  // Either `jurisdiction` (single, back-compat) or `jurisdictions` (explicit list) must be provided.
  jurisdiction: z.string().min(1).optional(),
  jurisdictions: z.array(z.string().min(1)).optional(),
  overlays: z.array(z.string().min(1)).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Must be semver (e.g. 1.0.0)"),
  notes: z.string().optional(),
  compiledBy: z.string().optional(),
}).refine(
  (v) => !!v.jurisdiction || (v.jurisdictions && v.jurisdictions.length > 0),
  { message: "Provide either `jurisdiction` or a non-empty `jurisdictions` array." }
);

router.post("/bundles/compile", async (req, res) => {
  try {
    const payload = compileBundleSchema.parse(req.body);
    const result: any = await prisma.$transaction(async (tx) => {
      const compiled = await compileDraftBundle(payload, tx);
      await writeAuditTx(tx, req, {
        action: "compliance.bundle.compile",
        entityType: "RuleBundle",
        entityId: compiled?.bundleId ?? null,
        metadata: {
          localeCode: payload.localeCode,
          version: payload.version,
          jurisdiction: payload.jurisdiction ?? null,
          jurisdictions: payload.jurisdictions ?? null,
          overlays: payload.overlays ?? null,
          jurisdictionsApplied: compiled?.jurisdictionsApplied ?? null,
          ruleCount: compiled?.ruleCount ?? null,
        },
      });
      return compiled;
    });
    res.status(201).json({ bundle: result });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    res.status(500).json({ error: err.message });
  }
});

const publishSchema = z.object({
  publishedBy: z.string().min(1),
});

router.post("/bundles/:id/publish", async (req, res) => {
  try {
    const { publishedBy } = publishSchema.parse(req.body);
    const id = Number(req.params.id);
    const result: any = await prisma.$transaction(async (tx) => {
      const published = await publishBundle(id, publishedBy, tx);
      await writeAuditTx(tx, req, {
        action: "compliance.bundle.publish",
        entityType: "RuleBundle",
        entityId: id,
        after: {
          id,
          localeCode: published?.localeCode ?? null,
          version: published?.version ?? null,
          supersededBundleId: published?.supersededBundleId ?? null,
        },
        metadata: { publishedBy },
      });
      return published;
    });
    res.json({ published: result });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    if (err.message?.includes("not \"draft\"")) return res.status(409).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.get("/bundles/:id", async (req, res) => {
  try {
    const bundle = await prisma.ruleBundle.findUnique({
      where: { id: Number(req.params.id) },
    });
    if (!bundle) return res.status(404).json({ error: "Bundle not found." });

    res.json({
      bundle: {
        id: bundle.id,
        localeCode: bundle.localeCode,
        jurisdiction: bundle.jurisdiction,
        version: bundle.version,
        status: bundle.status,
        content: safeParse(bundle.contentJson, {}),
        contentHash: bundle.contentHash,
        sourceRefs: safeParse(bundle.sourceRefsJson, []),
        publishedAt: bundle.publishedAt,
        publishedBy: bundle.publishedBy,
        supersededAt: bundle.supersededAt,
        notes: bundle.notes,
        createdAt: bundle.createdAt,
        updatedAt: bundle.updatedAt,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/bundles/published/:localeCode", async (req, res) => {
  try {
    const bundle = await getPublishedBundle(req.params.localeCode);
    if (!bundle) return res.status(404).json({ error: "No published bundle for this locale." });

    res.json({
      bundle: {
        id: bundle.id,
        localeCode: bundle.localeCode,
        jurisdiction: bundle.jurisdiction,
        version: bundle.version,
        status: bundle.status,
        contentHash: bundle.contentHash,
        sourceRefs: safeParse(bundle.sourceRefsJson, []),
        publishedAt: bundle.publishedAt,
        publishedBy: bundle.publishedBy,
        notes: bundle.notes,
        // contentJson NOT exposed in the published lookup — use GET /bundles/:id for full content
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── helpers ─────────────────────────────────────────────────────────

function qStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export default router;
