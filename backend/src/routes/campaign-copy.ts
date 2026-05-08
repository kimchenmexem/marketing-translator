/**
 * POST /api/campaign-copy
 *
 * Service-to-service endpoint that produces a localized ad copy package
 * for a campaign brief. Used by ai-campaign-banner so it never has to
 * generate marketing copy itself.
 *
 * Auth: requireAuthOrApiKey (static CAMPAIGN_COPY_API_KEY when set; else
 * Clerk). No DB persistence in v1.
 */

import { Router } from "express";
import { z } from "zod";
import {
  generateCampaignCopy,
  UnsupportedLocaleError,
} from "../services/campaignCopy";
import { requireAuthOrApiKey } from "../middleware/serviceAuth";

const router = Router();

const SUPPORTED_LOCALES = [
  "it-IT", "fr-FR", "nl-NL", "nl-BE", "fr-BE", "es-ES", "en-GB",
] as const;

const requestSchema = z.object({
  brief: z.object({
    marketingMessage: z.string().min(1).max(2000),
    campaignGoal: z.enum(["awareness", "consideration", "conversion", "retention"]),
    targetAudience: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
  }),
  targetLocale: z.enum(SUPPORTED_LOCALES),
  tone: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  complianceNotes: z.string().max(2000).optional(),
  riskWarningRequired: z.boolean().optional(),
  conceptHint: z
    .object({
      conceptId: z.string().min(1).optional(),
      name: z.string().min(1).max(120).optional(),
      strategicIdea: z.string().min(1).max(500).optional(),
    })
    .optional(),
});

router.post("/", requireAuthOrApiKey, async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors });
  }
  try {
    const result = await generateCampaignCopy(parsed.data);
    return res.json(result);
  } catch (err) {
    if (err instanceof UnsupportedLocaleError) {
      return res.status(400).json({ error: err.message });
    }
    console.error("POST /api/campaign-copy failed:", err);
    return res.status(500).json({ error: "Campaign copy generation failed." });
  }
});

export default router;
