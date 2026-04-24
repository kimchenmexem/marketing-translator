/**
 * Quick Translate — simple text-in / translated-text-out endpoint.
 *
 * No compliance validation. No quality gate. No market intelligence.
 * Just translate the source text to the target locale's language.
 *
 * Supports translating into multiple locales in one request.
 */

import { Router } from "express";
import { z } from "zod";
import { translateToLocale } from "../services/ai";
import { requireAuth } from "../middleware/auth";

const router = Router();

const SUPPORTED_LOCALES = [
  "it-IT", "fr-FR", "nl-NL", "nl-BE", "fr-BE", "es-ES", "en-GB",
] as const;

const LOCALE_LABELS: Record<string, { language: string; country: string }> = {
  "it-IT": { language: "Italian", country: "Italy" },
  "fr-FR": { language: "French", country: "France" },
  "nl-NL": { language: "Dutch", country: "Netherlands" },
  "nl-BE": { language: "Dutch", country: "Belgium" },
  "fr-BE": { language: "French", country: "Belgium" },
  "es-ES": { language: "Spanish", country: "Spain" },
  "en-GB": { language: "English", country: "United Kingdom" },
};

const quickTranslateSchema = z.object({
  text: z.string().min(1).max(5000),
  locales: z.array(z.enum(SUPPORTED_LOCALES)).min(1).max(7),
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { text, locales } = quickTranslateSchema.parse(req.body);

    const results = await Promise.all(
      locales.map(async (locale) => {
        const translated = await translateToLocale(text, locale);
        const meta = LOCALE_LABELS[locale] ?? { language: locale, country: locale };
        return {
          locale,
          language: meta.language,
          country: meta.country,
          translatedText: translated,
          charCount: translated.length,
        };
      })
    );

    res.json({
      sourceText: text,
      sourceCharCount: text.length,
      translations: results,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    console.error("POST /api/translate/quick failed:", err);
    res.status(500).json({ error: "Translation failed." });
  }
});

export default router;
