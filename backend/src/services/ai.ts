import { TranslationRequest, TranslationOutput, LengthConstraint } from "@mexem/shared";
import { validateLength } from "./validation";
import { getLocaleRules, getComplianceForbiddenWords } from "./localeRules";
import { loadBundle } from "../compliance/bundles/loader";
import { getMarketContextPack } from "../publishers/context-pack";
import type { MarketContextPack, MarketContextPackRequest } from "@mexem/shared";
import { validateCompliance } from "./compliance";
import { getFewShotExamples, formatFewShotPrompt } from "./fewShotExamples";
import { retrieveTranslationMemory, formatMemoryPrompt } from "./translationMemoryRetrieval";
import { runQualityGate, QualityGateResult } from "./qualityGate";
import { buildGlossaryPrompt } from "./glossary";
import { applyLocaleRewrites } from "./translationRewrites";
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
export function getLocaleStyleGuide(locale: string): string {
  const guides: Record<string, string> = {
    "it-IT": `ITALIAN STYLE — CRITICAL REGISTER RULES:
- Address the reader with the informal "tu" form (second-person singular). NEVER use "Lei" / third-person formal. Modern Italian retail-finance brands (Fineco, ScalableCapital, Webank, Directa, etc.) universally use "tu" for digital marketing — using "Lei" sounds outdated and bank-stuffy.
- NEVER capitalise possessives (no "Suo / Sua / Suoi / Sue"). Use lowercase "tuo / tua / tuoi / tue".
- Imperatives must be tu-form (-i / -a ending for -are/-ere/-ire verbs in 2nd person singular), NOT Lei-form (-i / -a / -ica with subjunctive).

VERB FORM PAIRS — use the LEFT (tu), never the RIGHT (Lei):
  • "Stai pensando" ✓ / "Sta pensando" ✗
  • "dovresti sapere" ✓ / "deve sapere" ✗
  • "Scopri" ✓ / "Scopra" ✗
  • "il tuo broker" ✓ / "il Suo broker" ✗
  • "hai" ✓ / "ha" ✗
  • "puoi" ✓ / "può" ✗
  • "Costruisci" ✓ / "Costruisca" ✗
  • "Modifica" ✓ / "Modifichi" ✗
  • "Tieni" ✓ / "Mantenga" ✗
  • "Investi" ✓ / "Operi" / "Investa" ✗
  • "Passa" ✓ / "Passi" ✗
  • "Apri" ✓ / "Apra" ✗
  • "Inizia" ✓ / "Inizi" ✗

OTHER GUIDANCE:
- Match the source's directness. A direct English question ("Investing in ETFs?") becomes an equally direct Italian one ("Stai pensando di investire in ETF?"), not a polished formal version.
- Prefer "trading" (loanword, standard in Italian fintech) over "negoziazione" for retail copy. Use "negoziazione" only in strictly regulatory contexts.
- Keep brand names (MEXEM, WisdomTree) and product terms (ETF, ETP) unchanged.
- Tone: warm, direct, approachable, but factual and professional. Not cold, not slangy.
- Numbers: comma as decimal separator, period as thousands (1.234,56).
- Adapt idioms — never translate English expressions literally.

HOMEPAGE / MARKETING NUANCES:
- For marketing tropes, prefer reviewer-blessed wordings: "Commissioni di Trading contenute" (NOT "...Basse"), "Azioni frazionate" (NOT "Frazionali"), "trading frazionato" (NOT "frazionale"), "Scopri i Conti societari" (NOT "Esplora Conti Aziendali").
- In the fractional-trading sentence write "azioni europee e statunitensi", not "azioni EU e US".
- "Powerful Trading Platforms" → "Piattaforme di trading evolute" (NOT "Potenti").`,

    "fr-FR": `FRENCH (FRANCE) STYLE — CRITICAL TERMINOLOGY RULES:
- "trading" is the ONLY acceptable word for stock-market trading. NEVER use "négociation" / "négocier" — French native readers do not use these for the stock market and they sound wrong. This overrides any general "prefer French terms" instinct.
- "le trading" is a MASCULINE noun: always "le trading" / "du trading" / "au trading", NEVER "la trading".
- The verb "to trade" is "trader" / "Tradez" — NEVER "négocier" and NEVER "échanger" / "Échangez" (which means to exchange/swap goods or currencies, not to trade on the markets).

TRADING TERM PAIRS — use the LEFT, never the RIGHT:
  • "Trading en ligne" ✓ / "Négociation en ligne" ✗
  • "Trading d'actions" ✓ / "Négociation d'actions" ✗
  • "Plateforme de trading" ✓ / "Plateforme de négociation" ✗
  • "Courtier de trading" / "Courtier en trading" ✓ / "Courtier en négociation" ✗
  • "Tradez des actions" ✓ / "Négociez des actions" ✗ / "Échangez des actions" ✗
  • "trader des ETF" ✓ / "négocier des ETF" ✗ / "échanger des ETF" ✗
  • "le trading d'ETF" ✓ / "la trading d'ETF" ✗
  • "le trading transparent" ✓ / "la négociation transparente" ✗

STOCK-MARKET VOCABULARY:
- "Stock Market" / the market in general → "la Bourse" (or "marché boursier"), NOT "marché des actions". "La Bourse" is the natural everyday term.
- "stocks / shares" as a specific product → "actions" (lowercase).
- "Invest in the Stock Market" → "Investir en Bourse"; use "Bourse" for the market, "actions" for the products.
- "fractional shares" → "actions fractionnées" (NEVER just "fractions" — that is meaningless on its own).
- "ETF" is invariant — use the singular form even when listing several products.

REGISTER, VOCABULARY & TONE:
- Use "vous" (formal), never "tu". Precise, clear register.
- "épargner" (not "économiser") for saving/growing money long-term ("Commencez à épargner").
- "frais fixes" (not "frais stables") — the precise financial term for fixed fees.
- "faible coût" (not "économique") — sounds technical, not like a cheap/discount retail product.
- "chez MEXEM" (not "sur MEXEM") when naming the broker as the provider.
- Always translate "broker" → "courtier"; never leave the English word "broker" (the only exception is the brand name "Interactive Brokers").
- Spell out regions in running copy: use "européen(ne/s)" in full, not the abbreviation "EU" / "UE" ("courtier européen", "investisseurs européens", "plateforme européenne"). The only exception is a reviewer-approved homepage stat line that keeps the short "EU et US" form.
- "AI-Powered" → "propulsé par l'IA" (NOT "alimenté par l'IA" — "alimenté" means power-supplied or fed).
- "like a pro" → "comme un professionnel" (not the casual "comme un pro").
- "investors who want it all" → "investisseurs exigeants" (discerning/demanding), not the literal "investisseurs qui veulent tout" (sounds childish).
- "zero / €0 commission" → "sans commission" (not "à zéro commission").
- Smooth, non-aggressive marketing tone: "Ne payez plus de commissions..." (not "Cessez de surpayer..." or "Arrêtez de payer...").
- Translate superlatives FAITHFULLY: "cheapest" → "le moins cher" / "la moins chère" (NOT softened to "le plus compétitif" or "le meilleur"). "best" → "le meilleur".
- Prefer punchy, empowering phrasing: "Le pouvoir d'investir" over "La puissance de l'investissement"; "optimisez votre achat" over "faites en sorte que... ait un impact"; "tout-en-un" for "full package".

CAPITALISATION (these are punctuation rules — getting them wrong is an error, not a style choice):
- SENTENCE CASE in headlines and titles. NEVER capitalise every word ("Investissez dans Votre Avenir Dès Maintenant" ✗ → "Investissez dans votre avenir dès maintenant" ✓).
- Region/nationality ADJECTIVES are lowercase: "courtier européen", "actions européennes". Only the noun for a person is capitalised ("un Européen").
- Common nouns mid-sentence stay lowercase: "Achetez des actions" (not "Achetez des Actions").

OTHER GUIDANCE:
- For slogans/titles, dropping a leading article is often punchier: "Marchés mondiaux, une seule plateforme !" (not "Des marchés mondiaux...").
- Keep the "&" ampersand when the source uses it in short marketing strings ("Actions & trading en ligne").
- "dès 2025" rather than "à partir de 2025" for a start date in marketing copy.
- For homepage stat cards, keep the "170+ marchés / 40+ pays / 29+ devises" form — do not expand to "Plus de 170...".
- Numbers: use comma as decimal separator, space as thousands separator (1 234,56).
- ALWAYS produce a real translation — never output a refusal or meta-commentary ("Je suis désolé, mais je ne peux pas..."). Every input is marketing copy to be translated.
- French readers value logical structure — lead with the value proposition, then explain.`,

    "nl-NL": `DUTCH (NETHERLANDS) STYLE:
- Dutch financial marketing is direct, practical, and no-nonsense. Avoid flowery language. Use "u" (formal). Get to the point quickly.
- TERMINOLOGY:
  • Keep the loanword "broker" — NEVER "makelaar" (that means a real-estate agent).
  • Prefer "trading" / "tradingplatform" over "handelsplatform" (which sounds dated); "beleggen" (investing) is the natural verb for the activity ("Beleg in aandelen", "online beleggen").
  • Keep "ETF" / "ETP", pluralised as "ETF's" / "ETP's" (apostrophe-s, Dutch convention).
  • "AI-Powered" → "AI-ondersteund" or, more marketing-forward, "Slimmer beleggen met AI" — NOT "AI-gestuurd".
  • "full package / all-in-one" → "all-in-one"; keep marketing loanwords where they read well ("Upgrade", "trading").
- WORD CHOICE:
  • cheap / cheapest / affordable → "voordelig / voordeligste" — NOT "goedkoop / goedkoopste" (sounds cheap/low-quality).
  • "with low fees" → "tegen lage kosten" (NOT "met lage kosten").
  • "fees" → "kosten" in most copy (not "tarieven"); "consistent fee structure" → "stabiele kostenstructuur".
  • Region: "Europese" in full, not the "EU-" prefix ("Europese aandelen", "Europese beleggers").
  • Drop a leading "How/Hoe" when it reads awkwardly — rephrase as an imperative ("Verhandel aandelen..." not "Hoe u aandelen kunt verhandelen...").
  • Use separable verbs fully: "Bouw uw ETF-portefeuille op" (not "...portefeuille"); "stel uw schema op".
- For the "Pioneering" headline write "Wij banen de weg naar transparante, voordelige handel." (reviewer-approved 05.26).
- Numbers: comma decimal, period thousands (1.234,56); "€ 1" with a space.
- ALWAYS produce a real translation — never a refusal or meta-commentary.`,

    "nl-BE": `DUTCH (BELGIAN) STYLE:
- Belgian Dutch is slightly more formal and softer than Netherlands Dutch. Use "u" (formal); slightly more polished, less blunt.
- In Belgian context "investeren" is a natural verb for investing and is sometimes preferred over "beleggen" ("Investeren in aandelen"); both are acceptable — "beleggen" / "Beleg" still reads well for short CTAs.
- Same terminology as Netherlands Dutch — in particular:
  • Keep "broker" (NEVER "makelaar" = real-estate agent); prefer "trading" / "tradingplatform" over "handelsplatform".
  • "ETF's" / "ETP's" (apostrophe-s).
  • cheap/cheapest/affordable → "voordelig / voordeligste" (not "goedkoop"); "with low fees" → "tegen lage kosten".
  • "AI-Powered" → "AI-ondersteund" / "Slimmer beleggen met AI" (not "AI-gestuurd"); "all-in-one"; region "Europese" not "EU-".
- Numbers: same as Netherlands Dutch (1.234,56); "€ 1" with a space.
- Belgians may use some French-influenced expressions — acceptable if natural.
- ALWAYS produce a real translation — never a refusal or meta-commentary.`,

    "fr-BE": `FRENCH (BELGIAN) STYLE:
- Belgian French is very close to France French but slightly less formal in register. Use "vous" (formal).
- Belgian French readers appreciate clarity and directness over literary elegance.

CRITICAL TERMINOLOGY (same as France French):
- Use "trading" / "trader" / "Tradez" for stock-market trading; NEVER "négociation" / "négocier" (not used for the stock market in French) and NEVER "échanger" / "Échangez" (that means to exchange/swap, not to trade). "Trade EU stocks" → "Tradez des actions européennes", NOT "Échangez...".
- "le trading" is MASCULINE — never "la trading".
- "actions" (lowercase) for shares; "la Bourse" / "boursier" for the market in general (not "marché des actions"). "Invest in Stocks" → "Investir en Bourse".
- "fractional shares" → "actions fractionnées" (never bare "fractions"). "ETF" is invariant.

VOCABULARY & TONE:
- Always translate "broker" → "courtier"; never leave the English "broker" (except the brand "Interactive Brokers").
- Spell out regions: "européen(ne/s)" in full, NOT the abbreviation "EU" / "UE" ("courtier européen", "investisseurs européens", "plateforme européenne").
- "AI-Powered" → "propulsé par l'IA" (NOT "alimenté par l'IA" — "alimenté" means power-supplied/fed).
- "like a pro" → "comme un professionnel" (not the casual "comme un pro").
- "investors who want it all" → "investisseurs exigeants" (discerning), not the literal "qui veulent tout" (sounds childish).
- "épargner" (not "économiser") for long-term saving; "faible coût" (not "économique"); "frais fixes" (not "frais stables"); "zero / €0 commission" → "sans commission".
- Smooth, non-aggressive tone: "Ne payez plus de commissions..." (not "Arrêtez de payer..." / "Cessez de surpayer...").
- Translate superlatives faithfully: "cheapest" → "le moins cher" / "la moins chère".

CAPITALISATION: sentence case in headlines; nationality adjectives lowercase ("courtier européen", not "Européen"); common nouns lowercase mid-sentence ("Achetez des actions").

- Numbers: same format as France French (1 234,56).
- ALWAYS produce a real translation — never output a refusal or meta-commentary.`,

    "es-ES": `SPANISH (SPAIN) STYLE — CRITICAL REGISTER & TERMINOLOGY:
- REGISTER: address the reader with the informal "tú" (second-person singular) for marketing copy — modern Spanish retail-finance brands use "tú", not "usted". Imperatives in tú form: "Invierte", "Opera", "Descubre", "Empieza", "Compra", "Accede", "Disfruta", "Mejora", "Únete". Possessives "tu / tus" (NOT "su / sus"); "te ofrecemos" (NOT "le ofrecemos"). Keep legal/risk disclaimers impersonal.
- "to trade" → the verb "operar" ("operar con ETF", "operar en acciones"); the noun "trading" stays "trading" ("trading en línea", "trading transparente", "trading fraccionado"). NEVER "negociación" / "negociar" for stock-market trading. "trade(s)" as a noun → "operación / operaciones".
- "broker" → "bróker" (WITH accent), NEVER "corredor" or unaccented "broker".
- "ETF" and "ETP" are INVARIANT — no plural "-s". Write "ETF" / "ETP" even for several ("varios ETF", not "ETFs").

TERMINOLOGY PAIRS — use the LEFT, never the RIGHT:
  • "trading en línea" ✓ / "negociación en línea" ✗
  • "operar con ETF" ✓ / "negociar ETFs" ✗
  • "operar en acciones" ✓ / "negociar acciones" ✗
  • "trading transparente" ✓ / "negociación transparente" ✗
  • "bróker" ✓ / "corredor" ✗
  • "ETF" ✓ / "ETFs" ✗      • "ETP" ✓ / "ETPs" ✗
  • "comisiones" ✓ / "tarifas" ✗      • "costes" ✓ / "costos" ✗

VOCABULARY:
- "fees" → "comisiones" (NOT "tarifas"). "fixed / flat fee" → "comisión fija" (not "tarifa plana", not "comisiones estables"). "consistent fees" → "comisiones consistentes".
- European Spanish "costes" (NOT Latin-American "costos"); "consistente" (not "coherente").
- "cheapest / cheap" → "más barato/a" (preferred over "más económico/a").
- "AI-Powered / AI-driven" → "con inteligencia artificial" (spell it out; NOT "impulsada por IA").
- "full package / all-in-one" → "todo en uno".
- "Caution" (disclaimer header) → "Aviso" (not "Advertencia"). "Terms & conditions" → "términos y condiciones" (not just "condiciones"). "Third party fees" → "comisiones de terceros".
- "fractional trading" → "trading fraccionado"; "fractional shares" → "acciones fraccionadas".
- Join coordinated items with "y", not a dash: "acciones europeas y ETF" (not "acciones europeas - ETF").
- Region: "europeo/a/os" in full, not "de la UE" / "UE".
- CTA naturalness: prefer "empieza hoy" over a literal "¡Actúa ahora!"; "Invierte de forma inteligente" over "Invierte con inteligencia".

OTHER:
- Prefer European Spanish ("ordenador" not "computadora").
- Adjective order: descriptive adjective AFTER the noun for product/pricing phrases ("comisiones bajas", not "bajas comisiones").
- Numbers: comma decimal separator, period thousands separator (1.234,56).
- ALWAYS produce a real translation — never a refusal or meta-commentary.
- Spanish allows expressive copy — engaging but professional.`,

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
// Per-textType default length recommendation in characters. Used when the
// operator-supplied lengthConstraint is permissive ("max" with no value),
// or when the textType has a hard platform limit the prompt should honour
// even if the operator didn't think to set one. Sourced from public
// platform specs (Google Ads help, Meta business help, common email best
// practice). Adjust here when a platform updates its limits.
const TEXT_TYPE_DEFAULT_MAX_CHARS: Record<string, number> = {
  google_search_headline: 30,
  google_search_description: 90,
  google_display_headline: 30,
  google_display_long_headline: 90,
  google_display_description: 90,
  google_pmax_headline: 30,
  google_pmax_long_headline: 90,
  google_pmax_description: 90,
  google_youtube_headline: 30,
  google_youtube_description: 90,
  meta_primary_text: 125,
  meta_headline: 40,
  meta_description: 30,
  meta_long_headline: 100,
  push_notification: 120,
  sms: 160,
  landing_headline: 80,
  banner: 60,
  cta_button: 24,
  email_subject: 60,
  email_body: 600,
};

function describeConstraint(c: LengthConstraint): string | null {
  if (c.mode === "exact" && typeof c.exactChars === "number") {
    return `EXACTLY ${c.exactChars} characters`;
  }
  if (c.mode === "near" && typeof c.exactChars === "number") {
    return `approximately ${c.exactChars} characters (±10)`;
  }
  if (c.mode === "max" && typeof c.maxChars === "number") {
    return `at most ${c.maxChars} characters`;
  }
  if (c.mode === "max" && typeof c.maxWords === "number") {
    return `at most ${c.maxWords} words`;
  }
  if (
    c.mode === "range" &&
    typeof c.minChars === "number" &&
    typeof c.maxCharsRange === "number"
  ) {
    return `between ${c.minChars} and ${c.maxCharsRange} characters`;
  }
  if (
    c.mode === "range" &&
    typeof c.minWords === "number" &&
    typeof c.maxWordsRange === "number"
  ) {
    return `between ${c.minWords} and ${c.maxWordsRange} words`;
  }
  return null;
}

// Builds an explicit length instruction for the LLM prompt. The model
// otherwise had no idea what target length to aim for — particularly bad
// for emails where the operator may not pass an explicit constraint.
// Resolution order:
//   1. Explicit lengthConstraint provided by the caller
//   2. Per-textType platform default (TEXT_TYPE_DEFAULT_MAX_CHARS)
//   3. Nothing — model writes free-form
function buildLengthInstruction(
  constraint: LengthConstraint,
  textType: string,
): string {
  const fromConstraint = describeConstraint(constraint);
  if (fromConstraint) {
    return `\nLENGTH: The output must be ${fromConstraint}. Count characters in the target language. Plan the sentence so it fits comfortably — do not pad to reach the limit nor truncate mid-thought.`;
  }
  const fallbackMax = TEXT_TYPE_DEFAULT_MAX_CHARS[textType];
  if (fallbackMax) {
    return `\nLENGTH: For "${textType}" the conventional limit is ${fallbackMax} characters. Aim for that as a soft upper bound; concise is better than padded.`;
  }
  return "";
}

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


export interface TranslateToLocaleOptions {
  /**
   * Which textType to scope translation-memory + few-shot lookups against.
   * Default "quick_translate" — matches what the /api/translate/quick route
   * persists so the system learns from itself across calls.
   */
  textType?: string;
  /** Audience profile for the market-context pack. Default "retail". */
  audienceType?: "retail" | "active_trader" | "professional" | "mass_market";
}

export async function translateToLocale(
  text: string,
  locale: string,
  opts: TranslateToLocaleOptions = {}
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for translation.");
  }
  const textType = opts.textType ?? "quick_translate";
  const audienceType = opts.audienceType ?? "retail";

  const language = getLocaleLanguage(locale);
  const styleGuide = getLocaleStyleGuide(locale);

  // Fetch every external-source layer in parallel so the only sequential cost
  // is the OpenAI call itself. Each layer degrades to a no-op when the DB
  // has no data for it — the system bootstraps cleanly with an empty corpus
  // and gets smarter as the brand reviews more output.
  const [
    glossaryBlock,
    forbiddenPhrases,
    fewShot,
    memoryExamples,
    marketContext,
  ] = await Promise.all([
    buildGlossaryPrompt(text, locale),
    listActiveForbiddenPhrasesForLocale(locale),
    getFewShotExamples(locale, textType).catch(() => ({ positive: [], negative: [] })),
    retrieveTranslationMemory(text, locale, textType).catch(() => []),
    getMarketContextPack({
      locale: locale as MarketContextPackRequest["locale"],
      audienceType,
      textType,
    }).catch(() => null),
  ]);

  const forbiddenBlock = formatForbiddenPhrasesBlock(forbiddenPhrases);
  const fewShotBlock = formatFewShotPrompt(fewShot);
  const memoryBlock = formatMemoryPrompt(memoryExamples);
  const marketContextPrompt = buildMarketContextPrompt(marketContext);

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
${styleGuide ? `\n${styleGuide}\n` : ""}${glossaryBlock}${forbiddenBlock}${fewShotBlock}${memoryBlock}${marketContextPrompt}
Output only the translated text, nothing else.`
      },
      { role: "user", content: text }
    ],
    temperature: 0.3,
    max_tokens: 1000
  });
  const draft = extractTranslation(response);

  // Deterministic post-process — re-uses the locale rewrite layer so quick
  // translations get the same term-level overrides as the full pipeline
  // (ETFs→ETF, EU-aandelen→Europese aandelen, négociation→trading, …).
  const rewrite = applyLocaleRewrites(draft, locale);
  if (rewrite.fired.length > 0) {
    console.log(
      `[rewrites] ${locale} quick-translate: ${rewrite.fired.map((r) => r.id).join(", ")}`
    );
  }
  return rewrite.text;
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
  const lengthInstruction = buildLengthInstruction(
    request.lengthConstraint,
    request.textType,
  );

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
CONTENT TYPE: ${request.textType}${lengthInstruction}
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
- Output only the translated text, nothing else.
- NEVER prefix output with "CTA " — "CTA" is a metadata label, not user-visible copy. For source like "CTA All Products" output only the translated button label (e.g. "Tous les produits"), not "CTA Tous les produits".
- Preserve approved product names exactly (the GLOSSARY block above lists them). Do not "improve" or pluralise them differently than the glossary.
- For legal / disclaimer fragments, stay close to the approved reviewer wording — these are regulated lines, not creative copy.${request.textType === "homepage" ? "\n- HOMEPAGE CONTEXT: the source may arrive split across UI lines. Translate phrase-by-phrase so each line remains grammatical in the target language. When a reviewer-approved split exists (see TRANSLATION MEMORY), match it." : ""}`;

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
        const postQualityText = qualityResult.outputText;

        // Deterministic post-process rewrites — locale-specific term-level
        // fixes the brand wants enforced regardless of LLM output (ETFs→ETF,
        // UE-as-adjective→europeo/i/e, tariffa→commissione, …). Runs after
        // the quality gate so it overrides any LLM-side wording, and BEFORE
        // the final compliance check so compliance sees the final shipped
        // text. No-op when no rules match.
        const rewrite = applyLocaleRewrites(postQualityText, request.targetLocale);
        const finalText = rewrite.text;
        if (rewrite.fired.length > 0) {
          console.log(
            `[rewrites] ${request.targetLocale} v${i + 1}: ` +
              rewrite.fired.map((r) => r.id).join(", ")
          );
        }

        // If the text changed at any point after the initial compliance run
        // (quality gate or rewrites), re-run compliance on the final text.
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
