/**
 * Standalone Compliance Check service.
 *
 * Reuses the existing compliance decision pipeline:
 *   text + locale → validateCompliance() → normalise to product-facing shape
 *
 * NOT translation-aware. NOT publisher-aware. NOT a rewrite engine.
 * Runtime reads only published RuleBundle content via the bundle loader;
 * falls back to legacy jurisdictionRules.ts when no bundle is published.
 *
 * Non-crypto. No crypto/MiCAR/VA logic anywhere.
 */

import type { LocaleCode } from "@mexem/shared";
import type {
  ComplianceCheckRequest,
  ComplianceCheckResponse,
  ComplianceCheckStatus,
  ComplianceCheckRiskLevel,
  ComplianceCheckMatchedRule,
  ComplianceCheckRecommendedAction,
} from "@mexem/shared";

import { validateCompliance } from "./compliance";
import { getJurisdictionRules } from "./jurisdictionRules";
import { rewriteForCompliance } from "./semantic-compliance";
import { sentenceAround, hasAnyDisclaimer } from "../compliance/engine/executor";

// Locale → country display name
const COUNTRY_NAME: Record<string, string> = {
  "it-IT": "Italy",
  "fr-FR": "France",
  "nl-NL": "Netherlands",
  "nl-BE": "Belgium",
  "fr-BE": "Belgium",
  "es-ES": "Spain",
  "en-GB": "United Kingdom",
  "el-GR": "Greece",
};

const COUNTRY_CODE: Record<string, string> = {
  "it-IT": "IT", "fr-FR": "FR", "nl-NL": "NL", "nl-BE": "BE",
  "fr-BE": "BE", "es-ES": "ES", "en-GB": "GB", "el-GR": "GR",
};

/** Internal DecisionStatus → external product status. */
function mapStatus(
  internalStatus: string,
  internalAction: string,
  hasCriticalBundleMatch: boolean,
  hasAnyHardRuleMatch: boolean
): ComplianceCheckStatus {
  // ── Tier 1: deterministic bundle rules are authoritative ──────────
  // A hard-rule match (banned phrase, regex, missing disclaimer) at critical
  // severity is an unconditional rejection.
  if (hasCriticalBundleMatch) return "rejected";

  // Any non-critical hard-rule match (major/minor banned phrase, missing
  // disclaimer) is still a rejection — the rule is deterministic and reviewed.
  if (hasAnyHardRuleMatch) return "rejected";

  // ── Tier 2: LLM-only concerns WITHOUT hard-rule support ──────────
  // If the decision-layer said "blocked" but the bundle executor found ZERO
  // hard-rule matches, the blocking came purely from LLM interpretation.
  // LLM-only concerns are not authoritative enough for rejection — they
  // should be routed to human review instead.
  if (internalAction === "blocked" && !hasAnyHardRuleMatch) return "review_required";

  // Other NON_COMPLIANT paths (unlikely without hard rules, but defensive)
  if (internalStatus === "NON_COMPLIANT" && !hasAnyHardRuleMatch) return "review_required";
  if (internalStatus === "NON_COMPLIANT") return "rejected";

  if (internalStatus === "SAFE") return "approved";
  // BORDERLINE, UNCERTAIN → needs human
  return "review_required";
}

/**
 * Internal RiskLevel → external risk level.
 * Any rejected-equivalent input (NON_COMPLIANT, blocked action, or critical
 * bundle match) surfaces as 'critical' so risk and status stay coherent.
 */
function mapRiskLevel(
  internalRisk: string,
  internalStatus: string,
  internalAction: string,
  hasCriticalBundleMatch: boolean,
  hasAnyHardRuleMatch: boolean
): ComplianceCheckRiskLevel {
  // Hard-rule-backed rejection = critical (deterministic ground truth).
  if (hasCriticalBundleMatch || hasAnyHardRuleMatch) return "critical";
  // LLM flagged the text as HIGH_RISK — surface as "high" regardless of
  // whether the status is NON_COMPLIANT. The previous logic short-circuited
  // every LLM-only NON_COMPLIANT to "medium" even when the decision layer
  // also flagged HIGH_RISK, so "high" was effectively unreachable without
  // a banned-phrase hit.
  if (internalRisk === "HIGH_RISK") return "high";
  // LLM blocked the text but didn't escalate the risk dial — moderate
  // concern. Reserve "high" for cases the decision layer explicitly raised.
  if (internalStatus === "NON_COMPLIANT" || internalAction === "blocked") return "medium";
  if (internalRisk === "MEDIUM_RISK") return "medium";
  return "low";
}

/** Internal FinalAction → external recommendedAction. */
function mapRecommendedAction(
  internalAction: string,
  hasAnyHardRuleMatch: boolean
): ComplianceCheckRecommendedAction {
  if (internalAction === "auto_approved") return "publish_as_is";
  // Only produce "do_not_publish" when backed by hard rules.
  // LLM-only "blocked" is downgraded to "route_to_legal_review."
  if (internalAction === "blocked" && hasAnyHardRuleMatch) return "do_not_publish";
  return "route_to_legal_review";
}

/** Derive regulators from bundle metadata or legacy fallback. */
function deriveRegulators(
  bundleVersion: string | null | undefined,
  sourceRefs: Array<{ sourceCode: string }>,
  locale: string
): string[] {
  const out: string[] = [];
  const countryCode = COUNTRY_CODE[locale];
  if (countryCode) out.push(countryCode);

  if (bundleVersion && sourceRefs.length > 0) {
    const seen = new Set<string>(out);
    for (const r of sourceRefs) {
      if (!seen.has(r.sourceCode)) {
        out.push(r.sourceCode);
        seen.add(r.sourceCode);
      }
    }
  } else {
    // Legacy fallback — regulator string from jurisdictionRules.ts
    const r = getJurisdictionRules(locale as LocaleCode);
    if (r?.regulator) {
      // r.regulator may be "ESMA / CySEC" — split
      for (const part of r.regulator.split("/").map(s => s.trim())) {
        if (part && !out.includes(part)) out.push(part);
      }
    }
  }
  return out;
}

/** Shape both validators converge on for quote-carrying findings. */
interface LlmFinding {
  category: string;
  quote: string;
  severity: 'critical' | 'major' | 'minor';
}

/** Server-side fallback: which substrings in a piece of text tend to trigger
 *  each compliance category. Used when the LLM omits a quote or hallucinates
 *  one that doesn't appear in the input. Multi-language so an Italian LLM
 *  response on Italian text still produces highlights.
 *
 *  This is NOT the compliance rule — it's purely a highlighter assistant. The
 *  rule logic lives in obligations + bundles. Adding/removing entries here
 *  changes what the UI marks, not what passes/fails. */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  no_guarantees: [
    "guaranteed returns", "guaranteed profit", "guaranteed income", "guaranteed gain",
    "risk-free", "risk free", "no risk", "100% safe", "completely safe",
    "capital protected", "capital guarantee", "capital protection",
    "assured profits", "assured returns", "certain gains",
    "rendimento garantito", "profitto assicurato", "garantito",
    "rendement garanti", "profit assuré", "garanti",
    "rentabilidad garantizada", "rentabilidad asegurada", "garantizado",
    "gegarandeerd rendement", "gegarandeerd",
  ],
  risk_balance: [
    "returns", "return", "profit", "profits", "gain", "gains",
    "performance", "yield", "yields", "growth", "earnings",
    "rendement", "rendimento", "rendimiento", "rentabilidad", "ganancia",
  ],
  urgency: [
    "now", "today", "hurry", "limited time", "last chance", "act now", "don't miss",
    "offerta limitata", "agisci ora", "non perdere",
    "offre limitée", "agissez maintenant", "ne manquez pas",
    "oferta limitada", "actúa ahora",
    "beperkte tijd", "handel nu",
  ],
  authority: [
    "the best", "number one", "top platform", "leading", "award-winning",
    "il migliore", "leader", "numero uno",
    "le meilleur", "numéro un",
    "el mejor", "número uno",
    "de beste", "nummer één",
  ],
  no_financial_advice: [
    "you should invest", "you should buy", "we recommend buying", "we advise you",
    "this is a buy", "you must invest", "right time to invest",
    "dovresti investire", "ti consigliamo",
    "vous devriez investir", "nous recommandons",
    "deberías invertir", "le recomendamos",
    "u zou moeten beleggen",
  ],
  past_performance: [
    "past performance", "historical return", "historical returns", "last year",
    "annual return", "annual returns", "track record", "year-to-date", "ytd",
    "performance passée", "performances passées",
    "performance passate", "rendimento passato",
    "rendimiento pasado", "resultados pasados",
    "resultaten in het verleden",
  ],
  promotional: [
    "amazing", "incredible", "revolutionary", "extraordinary",
    "straordinario", "rivoluzionario",
    "extraordinaire", "révolutionnaire",
    "extraordinario", "revolucionario",
    "buitengewoon",
  ],
  marketing_identifiable: [],
  fair_clear_not_misleading: [],
  disclosure_consistency: [],
  national_marketing_conduct: [],
};

function findKeywordInText(text: string, keyword: string): string | null {
  if (!keyword || !text) return null;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(keyword.toLowerCase());
  if (idx === -1) return null;
  return text.substring(idx, idx + keyword.length);
}

function fallbackQuoteForCategory(text: string, category: string): string {
  const keywords = CATEGORY_KEYWORDS[category] ?? [];
  for (const kw of keywords) {
    const hit = findKeywordInText(text, kw);
    if (hit) return hit;
  }
  return "";
}

/** Take the LLM's claimed quote; if it doesn't actually appear in the text
 *  (LLM paraphrased or hallucinated), substitute a keyword fallback. */
function resolveEvidence(text: string, finding: LlmFinding): string {
  if (finding.quote) {
    const hit = findKeywordInText(text, finding.quote);
    if (hit) return hit;
  }
  return fallbackQuoteForCategory(text, finding.category);
}

/** Explicit "this is not advice / educational only" disclaimer, across locales. */
const NOT_ADVICE_DISCLAIMER =
  /\b(do(es)? not constitute (investment |financial )?advice|not (intended as |investment |financial )?advice|(educational|informational) purposes only|for (educational|informational) purposes|ne constitue pas un conseil|à titre (informatif|éducatif)|no constituye (asesoramiento|consejo)|fines (informativos|educativos)|non costituisce (consulenza|consiglio)|vormt geen (beleggings)?advies|informatieve doeleinden)\b/iu;

/** "Missing risk / performance disclosure" categories — satisfied when the text
 *  actually carries a risk disclaimer, so they should not be raised then. */
const DISCLOSURE_SATISFIED_CATEGORIES = new Set(["risk_balance", "past_performance"]);

/** Language that actually signals a guarantee / capital-safety claim. A genuine
 *  "no_guarantees" violation must quote something like this; an LLM that flags a
 *  benign phrase ("put your shares to work") without any such wording is
 *  misfiring. Multilingual. */
const GUARANTEE_MARKERS =
  /\b(guarantee[sd]?|assured?|assure[sd]?|risk-?free|no risk|100\s*%|capital protected|fully protected|protected|completely safe|safe|certain (?:returns?|gains?|profits?)|won'?t lose|can'?t lose|garanti\w*|asegurad\w*|garantizad\w*|garantit\w*|gegarandeerd|sans risque|sin riesgo|senza rischio|zonder risico)\b/iu;

/**
 * An LLM finding is a false positive — and should be suppressed — when it is
 * flagging the compliance safeguards themselves rather than a real breach:
 *   1. its quote IS disclaimer / risk-disclosure language (you cannot violate a
 *      rule by stating the disclaimer);
 *   2. it is a "missing risk/performance disclosure" category but the text
 *      already carries a risk disclaimer;
 *   3. it is an evidence-less "no guarantees" concern on a text that discloses
 *      the risk of loss (a genuine guarantee claim would be quotable);
 *   4. it is a "gives investment advice" concern but the text carries an explicit
 *      not-advice / educational-only disclaimer.
 */
export function suppressLlmFinding(category: string, evidence: string | undefined, text: string): boolean {
  const cat = (category || "").toLowerCase().trim();
  if (evidence && hasAnyDisclaimer(evidence)) return true;
  if (DISCLOSURE_SATISFIED_CATEGORIES.has(cat) && hasAnyDisclaimer(text)) return true;
  // no_guarantees is about an affirmative guarantee/capital-safety claim. When
  // the text already discloses risk, a finding that does not actually quote
  // guarantee language is a misfire (covers both the no-quote case and a quote
  // of a benign phrase like "put your shares to work").
  if (cat === "no_guarantees" && hasAnyDisclaimer(text) && !(evidence && GUARANTEE_MARKERS.test(evidence))) return true;
  if (cat === "no_financial_advice" && NOT_ADVICE_DISCLAIMER.test(text)) return true;
  return false;
}

/** Merge bundle rule matches + LLM findings into one dedup'd list.
 *
 *  Each LLM-flagged finding now carries the exact substring from the input
 *  that triggered it (`evidence`), so the frontend can highlight it inline
 *  in the source text. Categories without a verbatim quote are still
 *  surfaced — they just have an empty `evidence`. */
function buildMatchedRules(
  text: string,
  bundleMatches: Array<{ ruleType: string; severity: string; message: string; evidence?: string; context?: string }> | undefined,
  semanticFindings: LlmFinding[] | undefined,
  semanticIssues: string[] | undefined,
  independentFindings: LlmFinding[] | undefined,
  independentViolations: string[] | undefined,
  sourceRefs: Array<{ sourceCode: string }>,
  externalStatus: ComplianceCheckStatus,
  obligationRefs?: Array<{ category: string; sourceCode: string; documentRef?: string; quote?: string }>
): ComplianceCheckMatchedRule[] {
  // When approved, suppress all match output (consistent with decision-layer SAFE behavior)
  if (externalStatus === "approved") return [];

  const rules: ComplianceCheckMatchedRule[] = [];
  const seen = new Set<string>();
  const primarySource = sourceRefs[0]?.sourceCode;

  // category → the exact regulation it traces to (regulator + document + quote),
  // so an LLM finding cites the rulebook, not just a category label.
  const basisByCategory = new Map<string, ComplianceCheckMatchedRule["regulatoryBasis"]>();
  for (const o of obligationRefs ?? []) {
    const key = (o.category || "").toLowerCase().trim();
    if (key && !basisByCategory.has(key)) {
      basisByCategory.set(key, { sourceCode: o.sourceCode, documentRef: o.documentRef, quote: o.quote });
    }
  }
  const basisFor = (category: string) => basisByCategory.get((category || "").toLowerCase().trim());

  const add = (r: ComplianceCheckMatchedRule) => {
    // Include the evidence in the dedup key so two distinct phrases under
    // the same category render as two findings (matches the LLM contract).
    const key = `${r.type}:${(r.evidence ?? "").toLowerCase()}:${r.message.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rules.push(r);
  };

  // Resolve the enclosing sentence for an LLM evidence quote (bundle matches
  // already carry their own context from the executor).
  const contextFor = (ev?: string): string | undefined => {
    if (!ev) return undefined;
    const idx = text.toLowerCase().indexOf(ev.toLowerCase());
    return idx === -1 ? undefined : sentenceAround(text, idx, ev.length);
  };

  for (const m of bundleMatches ?? []) {
    add({
      type: m.ruleType as any,
      severity: (m.severity as any) ?? "major",
      message: m.message,
      evidence: m.evidence,
      context: m.context,
      sourceCode: primarySource,
    });
  }

  // LLM-sourced findings — prefer the structured shape with quotes. Each
  // quote is validated against the original text (LLMs paraphrase); if it
  // doesn't appear verbatim, fall back to category-keyword lookup so the
  // highlighter still has something to mark up.
  if (semanticFindings && semanticFindings.length > 0) {
    for (const f of semanticFindings) {
      const evidence = resolveEvidence(text, f);
      if (suppressLlmFinding(f.category, evidence, text)) continue;
      add({
        type: "llm_semantic",
        severity: f.severity ?? "minor",
        message: f.category,
        evidence: evidence || undefined,
        context: contextFor(evidence),
        regulatoryBasis: basisFor(f.category),
      });
    }
  } else {
    for (const issue of semanticIssues ?? []) {
      if (!issue || typeof issue !== "string") continue;
      // Category-only fallback path (older LLM responses) — still try to
      // surface a keyword from the text so highlighting works.
      const evidence = fallbackQuoteForCategory(text, issue);
      if (suppressLlmFinding(issue, evidence, text)) continue;
      add({ type: "llm_semantic", severity: "minor", message: issue, evidence: evidence || undefined });
    }
  }

  if (independentFindings && independentFindings.length > 0) {
    for (const f of independentFindings) {
      const evidence = resolveEvidence(text, f);
      if (suppressLlmFinding(f.category, evidence, text)) continue;
      add({
        type: "llm_independent",
        severity: f.severity ?? "minor",
        message: f.category,
        evidence: evidence || undefined,
        context: contextFor(evidence),
        regulatoryBasis: basisFor(f.category),
      });
    }
  } else {
    for (const v of independentViolations ?? []) {
      if (!v || typeof v !== "string") continue;
      const evidence = fallbackQuoteForCategory(text, v);
      if (suppressLlmFinding(v, evidence, text)) continue;
      add({ type: "llm_independent", severity: "minor", message: v, evidence: evidence || undefined });
    }
  }

  return rules;
}

/** Build a short human-readable summary. */
function buildSummary(
  status: ComplianceCheckStatus,
  locale: string,
  bundleVersion: string | null,
  matchedRules: ComplianceCheckMatchedRule[]
): string {
  const n = matchedRules.length;
  const prefix = status.toUpperCase().replace("_", " ");
  const bundleLabel = bundleVersion ?? "legacy rules";

  if (status === "approved") {
    return `${prefix}: 0 rule matches under ${locale} / ${bundleLabel}. Text is clean.`;
  }

  // Name up to 2 top matches for context
  const sample = matchedRules
    .filter(r => r.type !== "llm_semantic" && r.type !== "llm_independent")
    .slice(0, 2)
    .map(r => r.evidence ? `"${r.evidence}"` : r.message.split(":")[0])
    .filter(Boolean)
    .join(", ");

  return `${prefix}: ${n} rule match${n === 1 ? "" : "es"} under ${locale} / ${bundleLabel}.${sample ? " " + sample + "." : ""}`;
}

function isCriticalBundleMatch(matches: Array<{ severity: string }> | undefined): boolean {
  return (matches ?? []).some(m => m.severity === "critical");
}

/**
 * Perform a standalone compliance check.
 * No translation, no rewrite (unless withSuggestedFixes=true, which is opt-in).
 */
export async function runComplianceCheck(
  req: ComplianceCheckRequest
): Promise<ComplianceCheckResponse> {
  const { text, locale } = req;

  // Reuse the existing full compliance pipeline — bundle-aware, with fallback.
  const decision = await validateCompliance(text, locale);

  const bundleVersion = decision.bundleVersion ?? null;
  const sourceRefs = decision.sourceRefs ?? [];
  const bundleMatches = decision.bundleRuleMatches ?? [];
  const hasCritical = isCriticalBundleMatch(bundleMatches);
  const hasAnyHardRule = bundleMatches.length > 0;

  let externalStatus = mapStatus(decision.status, decision.finalAction, hasCritical, hasAnyHardRule);
  let externalRisk = mapRiskLevel(decision.riskLevel, decision.status, decision.finalAction, hasCritical, hasAnyHardRule);
  let recommendedAction = mapRecommendedAction(decision.finalAction, hasAnyHardRule);

  const matchedRules = buildMatchedRules(
    text,
    bundleMatches,
    decision.semanticResult?.findings as LlmFinding[] | undefined,
    decision.semanticResult?.issues,
    decision.independentResult?.findings as LlmFinding[] | undefined,
    decision.independentResult?.violations,
    sourceRefs,
    externalStatus,
    decision.obligationRefs ?? undefined
  );

  // If the non-approval was driven SOLELY by LLM concerns, and every one of them
  // was vetted as a false positive (e.g. flagging the risk disclaimer itself, or
  // a missing-disclosure concern on text that does disclose), and no
  // deterministic rule fired — there is no actionable issue. Approve it.
  const hadLlmConcerns =
    (decision.semanticResult?.findings?.length ?? 0) +
    (decision.semanticResult?.issues?.length ?? 0) +
    (decision.independentResult?.findings?.length ?? 0) +
    (decision.independentResult?.violations?.length ?? 0) > 0;
  const approvedAfterVetting =
    externalStatus !== "approved" && !hasAnyHardRule && matchedRules.length === 0 && hadLlmConcerns;
  if (approvedAfterVetting) {
    externalStatus = "approved";
    externalRisk = "low";
    recommendedAction = "publish_as_is";
  }

  const regulatorsApplied = deriveRegulators(bundleVersion, sourceRefs, locale);
  const summary = buildSummary(externalStatus, locale, bundleVersion, matchedRules);

  // Issues list — short labels surfaced to the caller. Already deduped in decision-layer.
  const issues = externalStatus === "approved" ? [] : (decision.issues ?? []);

  // Human review gate: any non-approved status, or critical bundle match, or low
  // confidence (but not when we just approved after vetting away false positives).
  const needsHumanReview =
    externalStatus !== "approved" ||
    hasCritical ||
    (decision.finalConfidence < 55 && !approvedAfterVetting);

  // Optional suggested fixes — opt-in. Produce a compliant alternative and
  // RE-CHECK it (up to one retry) so we only present a rewrite that actually
  // passes compliance. If it still doesn't pass, surface the best attempt
  // flagged as needing review (never claim a non-passing rewrite is compliant).
  let suggestedFixes: ComplianceCheckResponse["suggestedFixes"] | undefined;
  if (req.withSuggestedFixes && externalStatus !== "approved" && issues.length > 0) {
    try {
      let candidate = text;
      let candidateIssues = issues;
      let best: { rewrittenText: string; changesMade: string[]; passesCompliance: boolean } | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await rewriteForCompliance(candidate, candidateIssues, locale);
        if (!r?.rewrittenText || r.rewrittenText === candidate) break;
        // Re-check the rewrite (without withSuggestedFixes — no recursion).
        const recheck = await runComplianceCheck({ text: r.rewrittenText, locale });
        const passes = recheck.status === "approved";
        best = { rewrittenText: r.rewrittenText, changesMade: r.changesMade ?? [], passesCompliance: passes };
        if (passes) break;
        // Feed the remaining issues into another attempt.
        candidate = r.rewrittenText;
        candidateIssues = recheck.issues.length ? recheck.issues : candidateIssues;
      }
      if (best) suggestedFixes = [best];
    } catch {
      // Non-fatal — suggestions are advisory only
      suggestedFixes = undefined;
    }
  }

  return {
    status: externalStatus,
    riskLevel: externalRisk,
    locale,
    country: COUNTRY_NAME[locale] ?? locale,
    regulatorsApplied,
    bundleVersion,
    summary,
    issues,
    matchedRules,
    sourceRefs,
    recommendedAction,
    confidence: decision.finalConfidence,
    needsHumanReview,
    suggestedFixes,
    checkedAt: new Date().toISOString(),
  };
}
