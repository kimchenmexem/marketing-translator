import { TranslationRequest, TranslationOutput } from "@mexem/shared";
import { validateLength } from "./validation";
import { getLocaleRules, getComplianceForbiddenWords } from "./localeRules";
import { loadBundle } from "../compliance/bundles/loader";
import { getMarketContextPack } from "../publishers/context-pack";
import type { MarketContextPack } from "@mexem/shared";
import { validateCompliance } from "./compliance";
import { getFewShotExamples, formatFewShotPrompt } from "./fewShotExamples";
import { retrieveTranslationMemory, formatMemoryPrompt } from "./translationMemoryRetrieval";
import { runQualityGate, QualityGateResult } from "./qualityGate";
import { buildGlossaryPrompt } from "./glossary";
import { extractTranslation, lazyOpenAI } from "./openaiHelpers";
import {
  listActiveForbiddenPhrasesForLocale,
  formatForbiddenPhrasesBlock,
} from "../compliance/forbidden/service";

const openai = lazyOpenAI(60_000);

/** Primary model for all translation tasks. */
const TRANSLATION_MODEL = "gpt-4o";

function getLocaleLanguage(locale: string): string {
  const map: Record<string, string> = {
    "it-IT": "Italian",
    "fr-FR": "French",
    "nl-NL": "Dutch",
    "nl-BE": "Dutch (Belgian)",
    "fr-BE": "French (Belgian)",
    "es-ES": "Spanish (European)",
    "en-GB": "English (British)"
  };
  return map[locale] || "the target";
}

/**
 * Locale-specific marketing style guidance.
 * These are injected into every translation prompt to produce natural,
 * locally-appropriate copy — not word-for-word translation.
 */
function getLocaleStyleGuide(locale: string): string {
  const guides: Record<string, string> = {
    "it-IT": `ITALIAN STYLE:
- Address the reader directly with the informal "tu" form (second-person singular). Use "tu" verb conjugations: "stai", "puoi", "sei", "investi", etc. — NOT "Lei" / "Sta" / "può" / "investe" (third-person formal). Modern Italian retail-finance brands (Fineco, ScalableCapital, Webank, etc.) universally use "tu" for digital marketing.
- Match the source's directness. If the English is a direct question ("Investing in ETFs?"), the Italian should be equally direct ("Stai pensando di investire in ETF?"), not a polished formal version.
- Prefer established Italian financial terminology: "strumenti finanziari", "negoziazione", "piattaforma di investimento".
- Tone is warm and approachable but still factual and professional — not cold, not over-casual.
- Numbers: use comma as decimal separator, period as thousands separator (1.234,56).
- Adapt idioms — do not translate English expressions literally. Find the Italian equivalent or rephrase.`,

    "fr-FR": `FRENCH (FRANCE) STYLE:
- French financial copy uses a precise, formal register. Clarity and elegance matter.
- Use "vous" (formal), never "tu".
- Prefer established French financial terms: "plateforme de négociation", "instruments financiers", "courtier".
- Avoid anglicisms when a good French term exists: "trading" → "négociation" or "investissement" depending on context, but keep "ETF" and "ETP" as-is (industry standard).
- Numbers: use comma as decimal separator, space as thousands separator (1 234,56).
- French readers value logical structure — lead with the value proposition, then explain.`,

    "nl-NL": `DUTCH (NETHERLANDS) STYLE:
- Dutch financial marketing is direct, practical, and no-nonsense. Avoid flowery language.
- Use "u" (formal) for this professional context.
- Dutch readers appreciate directness — get to the point quickly.
- Prefer Dutch financial terms where they exist: "handelsplatform", "beleggen", "effecten".
- Keep "ETF" and "ETP" as-is (standard in Dutch financial media).
- Numbers: use comma as decimal separator, period as thousands separator (1.234,56).
- Avoid long compound words when a shorter phrase is clearer.`,

    "nl-BE": `DUTCH (BELGIAN) STYLE:
- Belgian Dutch is slightly more formal and softer than Netherlands Dutch.
- Use "u" (formal).
- The same financial terminology applies as Netherlands Dutch, but tone should be slightly more polished and less blunt.
- Numbers: same format as Netherlands Dutch (1.234,56).
- Belgians may use some French-influenced expressions — this is acceptable if natural.`,

    "fr-BE": `FRENCH (BELGIAN) STYLE:
- Belgian French is very close to France French but slightly less formal in register.
- Use "vous" (formal).
- Financial terminology is the same as France French.
- Numbers: same format as France French (1 234,56).
- Belgian French readers appreciate clarity and directness over literary elegance.`,

    "es-ES": `SPANISH (SPAIN) STYLE:
- Spanish financial marketing uses a formal but accessible register. Not stiff, not casual.
- Use "usted" (formal) for this professional context.
- Prefer European Spanish conventions, not Latin American: "ordenador" not "computadora", "negociación" not "operación".
- Prefer established Spanish financial terms: "plataforma de inversión", "valores", "renta variable".
- Numbers: use comma as decimal separator, period as thousands separator (1.234,56).
- Spanish allows for slightly more expressive copy than English — use it to create engaging text, but stay professional.`,

    "en-GB": `BRITISH ENGLISH STYLE:
- Use British spelling: "favour", "organisation", "licence" (noun), "practise" (verb).
- Financial marketing in the UK tends to be understated and factual. Avoid American-style hyperbole.
- Prefer British financial terms: "shares" not "stocks" (when referring to equities), "current account" not "checking account".
- The FCA requires a particularly measured tone — no superlatives, no implied guarantees.`,
  };
  return guides[locale] ?? "";
}

function getPersonaGuidance(persona: string, tone: string | string[]): string {
  const personaMap: Record<string, string> = {
    beginners: "The audience is new to investing. Use simple, reassuring language. Avoid jargon. Explain benefits in plain terms. Use an encouraging, accessible register.",
    active_traders: "The audience are experienced, frequent traders. Use technical vocabulary naturally (ETPs, execution, liquidity, commissions). Be direct and action-oriented. Skip basic explanations.",
    experienced_investors: "The audience are seasoned investors with portfolio management knowledge. Use professional financial language. Emphasise platform depth, tools, and transparency over simplicity.",
    premium_audience: "The audience expects a premium, exclusive experience. Use sophisticated, elevated language. Convey prestige, quality, and exclusivity. Avoid anything that sounds mass-market.",
    potential_investors: "The audience is considering investing for the first time or switching platforms. Use clear, trustworthy language that highlights platform strengths and transparency. Address common hesitations without pressure. Focus on facts, tools, and ease of getting started.",
  };
  const toneMap: Record<string, string> = {
    friendly: "Warm, approachable, conversational — like advice from a trusted friend.",
    confident: "Bold, assertive, no hedging — convey certainty and expertise.",
    professional: "Formal, precise, credible — boardroom-appropriate language.",
    approachable: "Clear and human — knowledgeable but not intimidating.",
    premium: "Refined and exclusive — understated luxury, not flashy.",
    persuasive: "Compelling, benefit-driven — motivate action without pressure.",
    educational: "Informative, clear, patient — explain and guide.",
    direct: "Short, sharp, no filler — every word earns its place.",
  };
  const pg = personaMap[persona] ?? "Adapt language to the target audience.";
  const tones = Array.isArray(tone) ? tone : [tone];
  const tg = tones.map(t => toneMap[t]).filter(Boolean).join(" ");
  return `${pg} ${tg}`.trim();
}

/** Map translation persona to publisher audienceType for context pack lookup. */
function personaToAudienceType(persona: string): string {
  const map: Record<string, string> = {
    beginners: "retail",
    potential_investors: "retail",
    active_traders: "active_trader",
    experienced_investors: "professional",
    premium_audience: "professional",
  };
  return map[persona] ?? "retail";
}

/**
 * Build an optional market-context prompt fragment from a context pack.
 * Advisory only — framing hints and editorial cues, never raw article text.
 * Returns empty string if no pack is available.
 */
function buildMarketContextPrompt(pack: MarketContextPack | null): string {
  if (!pack || pack.topSources.length === 0) return "";

  const lines: string[] = [
    "",
    "MARKET CONTEXT (advisory — for style/framing reference only, NOT for compliance):",
  ];

  if (pack.preferredFraming.length > 0) {
    lines.push("Framing hints for this audience:");
    for (const f of pack.preferredFraming.slice(0, 3)) lines.push(`  - ${f}`);
  }

  if (pack.editorialThemes.length > 0) {
    lines.push(`Key market themes in ${pack.country}: ${pack.editorialThemes.slice(0, 5).join(", ")}.`);
  }

  if (pack.channelHints.length > 0) {
    lines.push(`Channel context: ${pack.channelHints.slice(0, 2).join("; ")}.`);
  }

  const topNames = pack.topSources.slice(0, 3).map(s => s.name);
  if (topNames.length > 0) {
    lines.push(`Reference publishers in this market: ${topNames.join(", ")}. Match their editorial register and terminology conventions — do not copy their content.`);
  }

  lines.push("Do NOT let market context override compliance rules. Compliance is authoritative.");
  return lines.join("\n");
}

function enforceRequiredTerms(text: string, requiredTerms: string[]): string {
  if (!requiredTerms.length) return text;
  let result = text;
  for (const term of requiredTerms) {
    if (!result.toLowerCase().includes(term.toLowerCase())) {
      result = `${result} ${term}`;
    }
  }
  return result.trim();
}


export async function translateToLocale(text: string, locale: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for translation.");
  }
  const language = getLocaleLanguage(locale);
  const styleGuide = getLocaleStyleGuide(locale);
  const glossaryBlock = await buildGlossaryPrompt(text, locale);
  const forbiddenPhrases = await listActiveForbiddenPhrasesForLocale(locale);
  const forbiddenBlock = formatForbiddenPhrasesBlock(forbiddenPhrases);
  const response = await openai.chat.completions.create({
    model: TRANSLATION_MODEL,
    messages: [
      {
        role: "system",
        content: `You are an expert marketing copywriter and translator for MEXEM, a regulated European trading platform.

TASK: Translate the following marketing text into ${language} (${locale}).

TRANSLATION PRINCIPLES:
- This is marketing localisation, not literal translation. The output must read as if it were originally written in ${language} by a native-speaking copywriter.
- Adapt sentence structure, rhythm, and phrasing to what sounds natural in ${language}. Do not mirror English syntax.
- Preserve the marketing intent, persuasive tone, and call-to-action strength — but express them the way a ${language} copywriter would.
- Preserve all brand names (MEXEM, WisdomTree, etc.) exactly as written.
- Preserve all risk warnings and disclaimers — translate them accurately.
- Do not add, remove, or invent information. The meaning must remain faithful.
${styleGuide ? `\n${styleGuide}\n` : ""}${glossaryBlock}${forbiddenBlock}
Output only the translated text, nothing else.`
      },
      { role: "user", content: text }
    ],
    temperature: 0.3,
    max_tokens: 1000
  });
  return extractTranslation(response);
}

/** Extended output that includes quality gate metadata */
export interface TranslationOutputWithQuality extends TranslationOutput {
  qualityGate?: {
    score: number;
    approved: boolean;
    stage: string;
    issues: Array<{ code: string; severity: string; message: string }>;
    hardCheckIssues: Array<{ code: string; severity: string; message: string }>;
  };
  /** Internal — used by translate route to persist quality reviews */
  _qualityGateResult?: QualityGateResult;
}

export async function runTranslationJob(request: TranslationRequest): Promise<TranslationOutputWithQuality[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for AI orchestration.");
  }

  const count = request.outputCount ?? 1;
  const language = getLocaleLanguage(request.targetLocale);
  const localeRules = getLocaleRules(request.targetLocale);
  const personaGuidance = getPersonaGuidance(request.persona, request.tone);
  const requiredTermsList = request.requiredTerms?.filter(Boolean) ?? [];
  const forbiddenTerms = request.forbiddenTerms?.length ? `FORBIDDEN terms (must NOT appear in output): ${request.forbiddenTerms.join(", ")}.` : "";
  const campaignCtx = request.campaignContext ? `Campaign context: ${request.campaignContext}.` : "";
  const complianceNotes = request.complianceNotes ? `Compliance notes: ${request.complianceNotes}.` : "";
  const requiredTermsInstruction = requiredTermsList.length
    ? `REQUIRED terms (must appear verbatim in output, do not translate them): ${requiredTermsList.join(", ")}.`
    : "";

  // Retrieve human-reviewed examples, translation memory, published bundle, market context, and glossary in parallel
  const audienceType = personaToAudienceType(request.persona);
  const [fewShotBlock, memoryExamples, bundle, marketContext, glossaryPrompt] = await Promise.all([
    getFewShotExamples(request.targetLocale, request.textType, request.sourceLanguage),
    retrieveTranslationMemory(request.sourceText, request.targetLocale, request.textType),
    loadBundle(request.targetLocale),
    getMarketContextPack({ locale: request.targetLocale, audienceType: audienceType as any, textType: request.textType }).catch(() => null),
    buildGlossaryPrompt(request.sourceText, request.targetLocale),
  ]);
  const fewShotPrompt = formatFewShotPrompt(fewShotBlock);
  const memoryPrompt = formatMemoryPrompt(memoryExamples);
  const marketContextPrompt = buildMarketContextPrompt(marketContext);

  // Reviewer-flagged compliance phrases (DB-driven, accumulates over time).
  const reviewerFlaggedPhrases = await listActiveForbiddenPhrasesForLocale(request.targetLocale);
  const reviewerFlaggedBlock = formatForbiddenPhrasesBlock(reviewerFlaggedPhrases);

  // Prefer bundle banned phrases over hardcoded list when a bundle is published.
  //
  // The instruction used to ship aggressive substitution examples ("instead of
  // 'now' use 'today/discover/get started'") which were paraphrases, not
  // synonyms — the model would shift the *meaning* of the source to dodge a
  // banned word. The replacement instruction below tells the model to pick
  // the closest faithful equivalent and explicitly preserve meaning.
  const complianceForbidden = bundle?.content.bannedPhrases.length
    ? bundle.content.bannedPhrases
    : getComplianceForbiddenWords(request.targetLocale as any);
  const complianceForbiddenInstruction = complianceForbidden.length
    ? `\nCOMPLIANCE — BANNED WORDS in ${language} (must not appear in the output): ${complianceForbidden.join(", ")}.
If your translation would naturally use one of these, pick the closest faithful synonym that preserves the source meaning exactly. Do not paraphrase the message to avoid a word.`
    : "";

  const styleGuide = getLocaleStyleGuide(request.targetLocale);

  const systemPrompt = `You are an expert marketing copywriter and translator for MEXEM, a regulated European trading platform.

TASK: Translate and localise marketing copy from ${request.sourceLanguage} to ${language} (${request.targetLocale}).

TRANSLATION PRINCIPLES:
- Translate the source into ${language} faithfully. Preserve the exact meaning, every fact, every claim, every named entity. Do not add, remove, summarise, rephrase, or invent information.
- Adapt only what grammar and idiom require to read naturally in ${language} — sentence structure and phrasing may differ from English, but the *message* must not.
- Preserve the source's tone (factual, persuasive, urgent, etc.). Do not soften, intensify, or restyle it.
- If the source repeats a word or phrase, repeat it in the translation. Do not introduce synonyms to "vary" vocabulary.

AUDIENCE & TONE: ${personaGuidance}
${styleGuide ? `\n${styleGuide}\n` : ""}
LOCALE RULES: ${localeRules}
CONTENT TYPE: ${request.textType}
${requiredTermsInstruction}
${forbiddenTerms}
${complianceForbiddenInstruction}${reviewerFlaggedBlock}
${campaignCtx}
${complianceNotes}
${glossaryPrompt}
${fewShotPrompt}
${memoryPrompt}${marketContextPrompt}
HARD RULES:
- Preserve brand names (MEXEM, WisdomTree) and asterisks (*) exactly as written.
- Do not add disclaimers unless instructed.
- This is for a regulated financial platform — use factual, professional language. Never imply guaranteed returns, capital safety, or urgency.
- Output only the translated text, nothing else.`;

  try {
    const versionHints = [
      "",
      " Rephrase this completely using entirely different words and sentence structure while keeping the same meaning.",
      " Write a shorter, punchier version with a different opening and fresh vocabulary.",
      " Rewrite using a more direct, active voice with completely different word choices.",
      " Create a version with a different tone and approach — surprise the reader with a fresh angle.",
    ];
    const versionTemps = [0.2, 0.5, 0.7, 0.8, 0.9];

    // If follow-up call, skip hint[0]/temp[0] so we don't regenerate the same "baseline" translation.
    const offset = request.versionOffset ?? 0;
    const existingVersions = request.existingVersions ?? [];
    const avoidBlock = existingVersions.length
      ? `\n\nPrevious versions already exist. Produce something clearly different in wording, structure, and opening — DO NOT repeat any of these:\n${existingVersions.map((v, i) => `- Version ${i + 1}: ${v}`).join("\n")}`
      : "";

    // Generate all versions in parallel
    const raw = await Promise.all(
      Array.from({ length: count }, (_, i) => {
        const idx = offset + i;
        // If we've already passed the baseline (index 0), bump to at least index 1 so we never reuse temp 0.2 + empty hint
        const hintIdx = idx === 0 ? 0 : ((idx - 1) % (versionHints.length - 1)) + 1;
        const tempIdx = idx === 0 ? 0 : ((idx - 1) % (versionTemps.length - 1)) + 1;
        return openai.chat.completions.create({
          model: TRANSLATION_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: request.sourceText + versionHints[hintIdx] + avoidBlock }
          ],
          temperature: versionTemps[tempIdx],
          max_tokens: 800
        }).then(r => {
          const text = extractTranslation(r);
          return enforceRequiredTerms(text, requiredTermsList);
        });
      })
    );

    // Deduplicate — keep only unique versions, including against existing ones
    const seen = new Set<string>(existingVersions.map(v => v.toLowerCase().trim()));
    const versions = raw.filter(v => {
      const normalized = v.toLowerCase().trim();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

    // Run quality gate + compliance in parallel for all versions
    const outputs: TranslationOutputWithQuality[] = await Promise.all(
      versions.map(async (outputText, i) => {
        const [compliance, qualityResult] = await Promise.all([
          validateCompliance(outputText, request.targetLocale),
          runQualityGate(
            request.sourceText,
            outputText,
            request.targetLocale,
            request.textType,
            request.sourceLanguage,
            systemPrompt,
            existingVersions
          ),
        ]);

        // Use the quality-gate output (may be repaired/regenerated)
        const finalText = qualityResult.outputText;

        // If the quality gate changed the text, re-run compliance on the new text
        const finalCompliance = finalText !== outputText
          ? await validateCompliance(finalText, request.targetLocale)
          : compliance;

        // Blend compliance score and quality score
        const complianceScore = finalCompliance.finalConfidence / 100;
        const blendedScore = (complianceScore * 0.4) + (qualityResult.qualityScore * 0.6);

        return {
          version: i + 1,
          outputText: finalText,
          score: Math.round(blendedScore * 100) / 100,
          validation: {
            ...validateLength(finalText, request.lengthConstraint),
            compliance: {
              compliant: finalCompliance.status === 'SAFE' || finalCompliance.status === 'BORDERLINE',
              issues: finalCompliance.issues,
              suggestions: finalCompliance.issues.map(issue => `Address: ${issue}`),
              bundleVersion: finalCompliance.bundleVersion ?? null,
              sourceRefs: finalCompliance.sourceRefs ?? [],
              bundleRuleMatches: finalCompliance.bundleRuleMatches ?? [],
            }
          },
          marketContext: marketContext && marketContext.topSources.length > 0 ? {
            applied: true,
            locale: marketContext.locale,
            country: marketContext.country,
            audienceProfile: audienceType,
            topSourceCount: marketContext.topSources.length,
          } : { applied: false },
          qualityGate: {
            score: qualityResult.qualityScore,
            approved: qualityResult.qualityApproved,
            stage: qualityResult.stage,
            issues: qualityResult.issues,
            hardCheckIssues: qualityResult.hardCheckIssues,
          },
          _qualityGateResult: qualityResult,
        };
      })
    );

    return outputs;
  } catch (error) {
    console.error("Translation error:", error);
    throw error;
  }
}
