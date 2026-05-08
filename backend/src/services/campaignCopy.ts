/**
 * Campaign-copy generator.
 *
 * Single-call OpenAI prompt that produces a full localized ad copy package
 * (headline, subheadline, body, cta, disclaimer) for a campaign brief in
 * one shot. The result is then run through the existing compliance
 * decision layer per text field; the aggregated issues + suggestions are
 * surfaced to the caller as a flat string[] in `complianceNotes`.
 *
 * No persistence in v1 — every call is stateless.
 */

import type { LocaleCode } from "@mexem/shared";
import type {
  CampaignCopyRequest,
  CampaignCopyResponse,
  LocaleDirection,
} from "@mexem/shared";
import { lazyOpenAI, extractTranslation } from "./openaiHelpers";
import { validateCompliance } from "./compliance";

const openai = lazyOpenAI(60_000);

const MODEL = "gpt-4o";

const SUPPORTED_LOCALES: LocaleCode[] = [
  "it-IT",
  "fr-FR",
  "nl-NL",
  "nl-BE",
  "fr-BE",
  "es-ES",
  "en-GB",
];

// All currently supported locales are LTR. Hebrew/Arabic are not yet
// supported by the translator; if they are added, extend this map.
const RTL_LOCALES = new Set<LocaleCode>([]);

function localeDirection(locale: LocaleCode): LocaleDirection {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

function localeLanguageLabel(locale: LocaleCode): string {
  const map: Record<LocaleCode, string> = {
    "it-IT": "Italian (Italy)",
    "fr-FR": "French (France)",
    "nl-NL": "Dutch (Netherlands)",
    "nl-BE": "Dutch (Belgium)",
    "fr-BE": "French (Belgium)",
    "es-ES": "Spanish (Spain)",
    "en-GB": "English (United Kingdom)",
  };
  return map[locale];
}

export class UnsupportedLocaleError extends Error {
  constructor(locale: string) {
    super(`Locale "${locale}" is not supported by /api/campaign-copy.`);
    this.name = "UnsupportedLocaleError";
  }
}

interface RawCopyFromModel {
  headline: string;
  subheadline: string;
  body?: string;
  cta: string;
  disclaimer: string;
}

const REQUIRED_KEYS: ReadonlyArray<keyof RawCopyFromModel> = [
  "headline",
  "subheadline",
  "cta",
  "disclaimer",
];

function buildSystemPrompt(locale: LocaleCode, riskWarningRequired: boolean): string {
  const language = localeLanguageLabel(locale);
  const riskClause = riskWarningRequired
    ? "Include a regulator-appropriate risk warning in the disclaimer field."
    : "Keep the disclaimer minimal but legally appropriate.";
  return [
    `You write localized financial-marketing ad copy in ${language}.`,
    `Output every text field directly in ${language}. Do not output English unless the target language IS English.`,
    `Tone must be professional, factual, and compliant with EU financial-marketing regulation (ESMA / national regulator equivalents).`,
    `Avoid: guarantees of return, urgency tactics, superlative claims ("best", "leader"), oversimplification ("easy", "effortless").`,
    riskClause,
    `Return STRICT JSON only, no prose, with the exact keys: headline, subheadline, body, cta, disclaimer.`,
    `headline: punchy, ≤ 60 chars. subheadline: one supporting line, ≤ 120 chars. body: optional supporting paragraph, ≤ 280 chars. cta: ≤ 24 chars action phrase. disclaimer: regulator-appropriate compliance line.`,
  ].join("\n");
}

function buildUserPrompt(req: CampaignCopyRequest): string {
  const tone = Array.isArray(req.tone) ? req.tone.join(", ") : req.tone;
  const lines: string[] = [
    `Marketing message: ${req.brief.marketingMessage}`,
    `Campaign goal: ${req.brief.campaignGoal}`,
    `Tone: ${tone}`,
  ];
  if (req.brief.targetAudience) lines.push(`Target audience: ${req.brief.targetAudience}`);
  if (req.brief.notes) lines.push(`Additional notes: ${req.brief.notes}`);
  if (req.complianceNotes) lines.push(`Compliance guidance: ${req.complianceNotes}`);
  if (req.conceptHint) {
    const hint: string[] = [];
    if (req.conceptHint.name) hint.push(`name="${req.conceptHint.name}"`);
    if (req.conceptHint.strategicIdea) hint.push(`strategic_idea="${req.conceptHint.strategicIdea}"`);
    if (hint.length > 0) lines.push(`Concept: ${hint.join(", ")}`);
  }
  lines.push("");
  lines.push(`Return JSON: { "headline": "...", "subheadline": "...", "body": "...", "cta": "...", "disclaimer": "..." }`);
  return lines.join("\n");
}

function parseModelJson(content: string): RawCopyFromModel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Model returned non-JSON content for campaign copy.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model returned a non-object JSON value.");
  }
  const obj = parsed as Record<string, unknown>;
  for (const k of REQUIRED_KEYS) {
    const v = obj[k];
    if (typeof v !== "string" || v.trim() === "") {
      throw new Error(`Model output is missing required field "${k}".`);
    }
  }
  const out: RawCopyFromModel = {
    headline: (obj.headline as string).trim(),
    subheadline: (obj.subheadline as string).trim(),
    cta: (obj.cta as string).trim(),
    disclaimer: (obj.disclaimer as string).trim(),
  };
  if (typeof obj.body === "string" && obj.body.trim() !== "") {
    out.body = obj.body.trim();
  }
  return out;
}

async function aggregateComplianceNotes(
  copy: RawCopyFromModel,
  locale: LocaleCode,
): Promise<string[]> {
  const fields: Array<{ label: string; text: string }> = [
    { label: "headline", text: copy.headline },
    { label: "subheadline", text: copy.subheadline },
    { label: "cta", text: copy.cta },
    { label: "disclaimer", text: copy.disclaimer },
  ];
  if (copy.body) fields.push({ label: "body", text: copy.body });

  const results = await Promise.all(
    fields.map(async (f) => {
      try {
        const r = await validateCompliance(f.text, locale);
        return { label: f.label, ...r };
      } catch {
        return null;
      }
    }),
  );

  const notes: string[] = [];
  for (const r of results) {
    if (!r) continue;
    for (const issue of r.issues ?? []) notes.push(`[${r.label}] ${issue}`);
    for (const sug of r.suggestions ?? []) notes.push(`[${r.label}] ${sug}`);
  }
  return notes;
}

export async function generateCampaignCopy(
  req: CampaignCopyRequest,
): Promise<CampaignCopyResponse> {
  if (!SUPPORTED_LOCALES.includes(req.targetLocale)) {
    throw new UnsupportedLocaleError(req.targetLocale);
  }

  const riskWarningRequired = req.riskWarningRequired ?? true;
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: buildSystemPrompt(req.targetLocale, riskWarningRequired) },
      { role: "user", content: buildUserPrompt(req) },
    ],
  });
  const content = extractTranslation(completion);
  const copy = parseModelJson(content);
  const complianceNotes = await aggregateComplianceNotes(copy, req.targetLocale);

  return {
    locale: req.targetLocale,
    direction: localeDirection(req.targetLocale),
    headline: copy.headline,
    subheadline: copy.subheadline,
    body: copy.body,
    cta: copy.cta,
    disclaimer: copy.disclaimer,
    complianceNotes,
  };
}
