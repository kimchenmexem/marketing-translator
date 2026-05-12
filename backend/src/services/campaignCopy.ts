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
  CampaignCopyBatchRequest,
  CampaignCopyBatchResponse,
  CampaignCopyBatchConceptResult,
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

  // validateCompliance returns `suggestions` as `issues.map(i => "Address: " + i)`
  // — strictly redundant with `issues`. Report only issues so callers don't
  // see every violation twice.
  const notes: string[] = [];
  for (const r of results) {
    if (!r) continue;
    for (const issue of r.issues ?? []) notes.push(`[${r.label}] ${issue}`);
  }
  return notes;
}

// ── Batch generator ─────────────────────────────────────────────────────────
//
// One OpenAI call produces copy for every concept in the campaign. This is
// strictly better than per-concept calls in two ways:
//   1. Cross-concept variation: the model sees all concepts at once and is
//      explicitly told to make headlines / CTAs distinct. Eliminates the
//      "Explore Your Options × 3" problem seen with independent calls.
//   2. Latency: one round-trip instead of N, at the cost of one larger
//      prompt. For 3 concepts this is typically faster and cheaper than
//      3 parallel single-concept calls.

function buildBatchSystemPrompt(
  locale: LocaleCode,
  conceptCount: number,
  riskWarningRequired: boolean,
): string {
  const language = localeLanguageLabel(locale);
  const riskClause = riskWarningRequired
    ? "Each disclaimer must include a regulator-appropriate risk warning."
    : "Each disclaimer must be minimal but legally appropriate.";
  return [
    `You write localized financial-marketing ad copy in ${language}.`,
    `You are designing copy for ${conceptCount} distinct concepts inside ONE campaign.`,
    `Output every text field directly in ${language}. Do not output English unless the target language IS English.`,
    `Tone must be professional, factual, and compliant with EU financial-marketing regulation (ESMA / national regulator equivalents).`,
    `Avoid: guarantees of return, urgency tactics, superlative claims ("best", "leader"), oversimplification ("easy", "effortless").`,
    riskClause,
    ``,
    `CROSS-CONCEPT RULES (critical — the concepts share a campaign, the copy MUST NOT):`,
    `- Every concept gets a DISTINCT headline. No shared key phrases between concepts.`,
    `- Every concept gets a DISTINCT CTA — use a different action verb in each (e.g. "Explore", "Start", "Discover", "Compare"). Do not repeat a CTA verbatim.`,
    `- Every subheadline must reflect that concept's own strategic_idea / target_emotion / mood; subheadlines must not be interchangeable across concepts.`,
    `- Disclaimers may follow a shared regulator pattern but should vary in wording where natural.`,
    ``,
    `OPTIONAL TYPOGRAPHIC ACCENTS — produce when they strengthen a concept (omit when not natural; never include for every concept):`,
    `- "eyebrow": a SHORT, ALL-CAPS category label that sits above the headline (1-3 words, ≤ 40 chars). Use for clear category framing (e.g. "ETF TRADING", "PROFESSIONAL PLATFORM"). NEVER include numeric claims, percentages, or money amounts in the eyebrow.`,
    `- "kicker": a short supporting pull-quote-style line below the subheadline (≤ 120 chars). Use sparingly — only when it adds a memorable framing that the subhead alone doesn't carry. Like every other field it must be regulator-compliant.`,
    `DO NOT produce "stat" (specific numbers / percentages / dollar amounts) — those are regulatory claims that must come from a verified human-approved source, never from this model.`,
    ``,
    `Per-field length: headline ≤ 60 chars · subheadline ≤ 120 chars · body ≤ 280 chars (optional) · cta ≤ 24 chars · disclaimer = regulator-appropriate · eyebrow ≤ 40 chars (optional) · kicker ≤ 120 chars (optional).`,
    ``,
    `Return STRICT JSON only, no prose. Top-level shape:`,
    `{ "concepts": [ { "conceptId": "...", "headline": "...", "subheadline": "...", "body": "...", "cta": "...", "disclaimer": "...", "eyebrow": "...", "kicker": "..." }, ... ] }`,
    `The "conceptId" in each output MUST exactly equal the conceptId you were given. Omit "eyebrow" and "kicker" entirely (or use null) for concepts where they don't fit.`,
  ].join("\n");
}

function buildBatchUserPrompt(req: CampaignCopyBatchRequest): string {
  const tone = Array.isArray(req.tone) ? req.tone.join(", ") : req.tone;
  const lines: string[] = [
    `Marketing message: ${req.brief.marketingMessage}`,
    `Campaign goal: ${req.brief.campaignGoal}`,
    `Tone: ${tone}`,
  ];
  if (req.brief.targetAudience) lines.push(`Target audience: ${req.brief.targetAudience}`);
  if (req.brief.notes) lines.push(`Additional notes: ${req.brief.notes}`);
  if (req.complianceNotes) lines.push(`Compliance guidance: ${req.complianceNotes}`);
  lines.push(``);
  lines.push(`Concepts (${req.concepts.length}):`);
  for (let i = 0; i < req.concepts.length; i++) {
    const c = req.concepts[i];
    const pieces: string[] = [`conceptId="${c.conceptId}"`];
    if (c.name) pieces.push(`name="${c.name}"`);
    if (c.strategicIdea) pieces.push(`strategic_idea="${c.strategicIdea}"`);
    if (c.targetEmotion) pieces.push(`target_emotion="${c.targetEmotion}"`);
    if (c.tone) {
      const t = Array.isArray(c.tone) ? c.tone.join("/") : c.tone;
      pieces.push(`concept_tone="${t}"`);
    }
    if (c.composition) pieces.push(`composition="${c.composition}"`);
    if (c.moodKeywords && c.moodKeywords.length > 0) {
      pieces.push(`mood="${c.moodKeywords.join(", ")}"`);
    }
    lines.push(`  ${i + 1}. ${pieces.join(" | ")}`);
  }
  return lines.join("\n");
}

interface RawBatchConceptFromModel {
  conceptId: string;
  headline: string;
  subheadline: string;
  body?: string;
  cta: string;
  disclaimer: string;
  // Optional accents — see buildBatchSystemPrompt for the contract.
  eyebrow?: string;
  kicker?: string;
}

function parseBatchModelJson(
  content: string,
  expectedIds: string[],
): RawBatchConceptFromModel[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Model returned non-JSON content for batch campaign copy.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model returned a non-object JSON value.");
  }
  const arr = (parsed as { concepts?: unknown }).concepts;
  if (!Array.isArray(arr)) {
    throw new Error('Model output is missing the "concepts" array.');
  }
  if (arr.length !== expectedIds.length) {
    throw new Error(
      `Model returned ${arr.length} concepts but ${expectedIds.length} were requested.`,
    );
  }
  const requiredFields: ReadonlyArray<keyof RawBatchConceptFromModel> = [
    "conceptId",
    "headline",
    "subheadline",
    "cta",
    "disclaimer",
  ];
  const out: RawBatchConceptFromModel[] = [];
  for (let i = 0; i < arr.length; i++) {
    const o = arr[i];
    if (!o || typeof o !== "object") {
      throw new Error(`Model output concept[${i}] is not an object.`);
    }
    const obj = o as Record<string, unknown>;
    for (const k of requiredFields) {
      const v = obj[k];
      if (typeof v !== "string" || v.trim() === "") {
        throw new Error(`Model output concept[${i}] missing required field "${k}".`);
      }
    }
    const item: RawBatchConceptFromModel = {
      conceptId: (obj.conceptId as string).trim(),
      headline: (obj.headline as string).trim(),
      subheadline: (obj.subheadline as string).trim(),
      cta: (obj.cta as string).trim(),
      disclaimer: (obj.disclaimer as string).trim(),
    };
    if (typeof obj.body === "string" && obj.body.trim() !== "") {
      item.body = obj.body.trim();
    }
    // Optional accent fields — accept when the model produced them and
    // they meet basic length / non-empty checks. Out-of-spec values
    // (too long, etc.) are silently dropped rather than rejecting the
    // whole concept.
    if (typeof obj.eyebrow === "string") {
      const e = obj.eyebrow.trim();
      if (e.length > 0 && e.length <= 60) item.eyebrow = e;
    }
    if (typeof obj.kicker === "string") {
      const k = obj.kicker.trim();
      if (k.length > 0 && k.length <= 160) item.kicker = k;
    }
    out.push(item);
  }
  // Verify every expected id is present (order-independent).
  const got = new Set(out.map((c) => c.conceptId));
  const missing = expectedIds.filter((id) => !got.has(id));
  if (missing.length > 0) {
    throw new Error(
      `Model output missing conceptIds: ${missing.join(", ")}.`,
    );
  }
  return out;
}

async function aggregateBatchComplianceNotes(
  concept: RawBatchConceptFromModel,
  locale: LocaleCode,
): Promise<string[]> {
  const fields: Array<{ label: string; text: string }> = [
    { label: "headline", text: concept.headline },
    { label: "subheadline", text: concept.subheadline },
    { label: "cta", text: concept.cta },
    { label: "disclaimer", text: concept.disclaimer },
  ];
  if (concept.body) fields.push({ label: "body", text: concept.body });
  // Optional accents — when present, they are rendered text on the banner
  // so they must pass through the same compliance check as the rest.
  if (concept.eyebrow) fields.push({ label: "eyebrow", text: concept.eyebrow });
  if (concept.kicker) fields.push({ label: "kicker", text: concept.kicker });

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

  // See aggregateComplianceNotes: `suggestions` is just `issues` with an
  // "Address: " prefix — emitting both doubles the noise. Issues only.
  const notes: string[] = [];
  for (const r of results) {
    if (!r) continue;
    for (const issue of r.issues ?? []) notes.push(`[${r.label}] ${issue}`);
  }
  return notes;
}

export async function generateCampaignCopyBatch(
  req: CampaignCopyBatchRequest,
): Promise<CampaignCopyBatchResponse> {
  if (!SUPPORTED_LOCALES.includes(req.targetLocale)) {
    throw new UnsupportedLocaleError(req.targetLocale);
  }
  if (!Array.isArray(req.concepts) || req.concepts.length === 0) {
    throw new Error("Batch request must include at least one concept.");
  }

  const riskWarningRequired = req.riskWarningRequired ?? true;
  const expectedIds = req.concepts.map((c) => c.conceptId);

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: buildBatchSystemPrompt(
          req.targetLocale,
          req.concepts.length,
          riskWarningRequired,
        ),
      },
      { role: "user", content: buildBatchUserPrompt(req) },
    ],
  });
  const content = extractTranslation(completion);
  const rawConcepts = parseBatchModelJson(content, expectedIds);

  // Compliance validation per concept, all concepts in parallel.
  const results: CampaignCopyBatchConceptResult[] = await Promise.all(
    rawConcepts.map(async (c) => {
      const notes = await aggregateBatchComplianceNotes(c, req.targetLocale);
      return {
        conceptId: c.conceptId,
        headline: c.headline,
        subheadline: c.subheadline,
        body: c.body,
        cta: c.cta,
        disclaimer: c.disclaimer,
        eyebrow: c.eyebrow,
        kicker: c.kicker,
        complianceNotes: notes,
      };
    }),
  );

  return {
    locale: req.targetLocale,
    direction: localeDirection(req.targetLocale),
    concepts: results,
  };
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
