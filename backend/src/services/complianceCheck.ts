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

// Locale → country display name
const COUNTRY_NAME: Record<string, string> = {
  "it-IT": "Italy",
  "fr-FR": "France",
  "nl-NL": "Netherlands",
  "nl-BE": "Belgium",
  "fr-BE": "Belgium",
  "es-ES": "Spain",
  "en-GB": "United Kingdom",
};

const COUNTRY_CODE: Record<string, string> = {
  "it-IT": "IT", "fr-FR": "FR", "nl-NL": "NL", "nl-BE": "BE",
  "fr-BE": "BE", "es-ES": "ES", "en-GB": "GB",
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

/** Merge bundle rule matches + LLM issues into one dedup'd list. */
function buildMatchedRules(
  bundleMatches: Array<{ ruleType: string; severity: string; message: string; evidence?: string }> | undefined,
  semanticIssues: string[] | undefined,
  independentViolations: string[] | undefined,
  sourceRefs: Array<{ sourceCode: string }>,
  externalStatus: ComplianceCheckStatus
): ComplianceCheckMatchedRule[] {
  // When approved, suppress all match output (consistent with decision-layer SAFE behavior)
  if (externalStatus === "approved") return [];

  const rules: ComplianceCheckMatchedRule[] = [];
  const seen = new Set<string>();
  const primarySource = sourceRefs[0]?.sourceCode;

  const add = (r: ComplianceCheckMatchedRule) => {
    const key = `${r.type}:${r.message.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rules.push(r);
  };

  for (const m of bundleMatches ?? []) {
    add({
      type: m.ruleType as any,
      severity: (m.severity as any) ?? "major",
      message: m.message,
      evidence: m.evidence,
      sourceCode: primarySource,
    });
  }

  // LLM-sourced issues: keep only when the external status is not approved
  for (const issue of semanticIssues ?? []) {
    if (!issue || typeof issue !== "string") continue;
    add({ type: "llm_semantic", severity: "minor", message: issue });
  }
  for (const v of independentViolations ?? []) {
    if (!v || typeof v !== "string") continue;
    add({ type: "llm_independent", severity: "minor", message: v });
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

  const externalStatus = mapStatus(decision.status, decision.finalAction, hasCritical, hasAnyHardRule);
  const externalRisk = mapRiskLevel(decision.riskLevel, decision.status, decision.finalAction, hasCritical, hasAnyHardRule);
  const recommendedAction = mapRecommendedAction(decision.finalAction, hasAnyHardRule);

  const matchedRules = buildMatchedRules(
    bundleMatches,
    decision.semanticResult?.issues,
    decision.independentResult?.violations,
    sourceRefs,
    externalStatus
  );

  const regulatorsApplied = deriveRegulators(bundleVersion, sourceRefs, locale);
  const summary = buildSummary(externalStatus, locale, bundleVersion, matchedRules);

  // Issues list — short labels surfaced to the caller. Already deduped in decision-layer.
  const issues = externalStatus === "approved" ? [] : (decision.issues ?? []);

  // Human review gate: any non-approved status, or critical bundle match, or low confidence
  const needsHumanReview =
    externalStatus !== "approved" ||
    hasCritical ||
    decision.finalConfidence < 55;

  // Optional suggested fixes — opt-in, off by default
  let suggestedFixes: ComplianceCheckResponse["suggestedFixes"] | undefined;
  if (req.withSuggestedFixes && externalStatus !== "approved" && issues.length > 0) {
    try {
      const r = await rewriteForCompliance(text, issues, locale);
      if (r?.rewrittenText && r.rewrittenText !== text) {
        suggestedFixes = [{ rewrittenText: r.rewrittenText, changesMade: r.changesMade ?? [] }];
      }
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
