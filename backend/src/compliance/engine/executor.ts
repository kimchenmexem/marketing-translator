/**
 * Bundle Rule Executor.
 *
 * Runs the deterministic (non-LLM) rules in a published bundle against text.
 * Returns matched issues with evidence and source references.
 *
 * This is a pure function — no I/O, no DB reads.
 */

import type { RuleBundleContent, ObligationSeverity, SourceRef } from "@mexem/shared";
import type { LoadedBundle } from "../bundles/loader";

export interface BundleRuleMatch {
  ruleType: "banned_phrase" | "regex" | "required_disclaimer";
  severity: ObligationSeverity;
  message: string;
  /** The text fragment that matched. */
  evidence?: string;
  /** The full sentence the match sits in — findings are judged in context. */
  context?: string;
}

export interface BundleExecutionResult {
  matches: BundleRuleMatch[];
  passed: boolean;
  /** The bundle that was evaluated. */
  bundleVersion: string;
  sourceRefs: SourceRef[];
}

/**
 * Whole-phrase, Unicode-aware match. Requires the phrase to sit on word
 * boundaries so a short banned phrase ("win") does not match inside a larger
 * word ("window"). Boundaries are asserted only against alphanumerics (so a
 * phrase that begins/ends with punctuation still matches). Returns the actual
 * matched fragment (preserving the source casing) or null.
 */
export function matchWholePhrase(text: string, phrase: string): string | null {
  const trimmed = phrase.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
    const m = text.match(re);
    return m ? m[0] : null;
  } catch {
    // Defensive: if the constructed pattern is somehow invalid, fall back to a
    // case-insensitive substring check rather than throwing.
    const idx = text.toLowerCase().indexOf(trimmed.toLowerCase());
    return idx === -1 ? null : text.slice(idx, idx + trimmed.length);
  }
}

/**
 * Recognised risk-disclosure / terms-&-conditions language across the supported
 * locales (EN/FR/NL/ES/IT). Used to answer "does the text contain ANY
 * disclaimer at all?" — deliberately broad, so a disclaimer that is reworded or
 * translated differently from the bundle's canonical text still counts.
 */
const DISCLAIMER_MARKERS =
  /\b(risk|risks|risico'?s?|risque|risques|riesgo|riesgos|rischio|rischi|loss|lose|losing|verlies|verliezen|perte|perdre|p[ée]rdida|perder|perdita|perdere|warning|caution|disclaimer|avertissement|advertencia|avvertenza|waarschuwing|let op|aviso)\b|capital|past performance|performances? pass[ée]es?|rendimientos? pasados?|rendimenti passati|in het verleden|terms (?:and|&) conditions|conditions g[ée]n[ée]rales|t[ée]rminos y condiciones|termini e condizioni|algemene voorwaarden|\bvoorwaarden\b|κίνδυν|απώλει|ζημί|προειδοποίηση|παρελθούσες αποδόσεις|προηγούμενες αποδόσεις|Risik|Verlust|Warnung|Wertentwicklung|gefährd|Gefahr/iu;

/** True when the text contains any recognised disclaimer / risk-disclosure language. */
export function hasAnyDisclaimer(text: string): boolean {
  return DISCLAIMER_MARKERS.test(text);
}

/**
 * Expand a match position to the full sentence that contains it, so a finding
 * is examined and reported in context rather than as a bare fragment.
 * Sentence boundaries: . ! ? or a line break (or string start/end).
 */
export function sentenceAround(text: string, index: number, matchLength: number): string {
  if (index < 0) return "";
  let start = index;
  while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start--;
  let end = index + Math.max(1, matchLength);
  while (end < text.length && !/[.!?\n]/.test(text[end])) end++;
  if (end < text.length) end++; // include the terminator
  return text.slice(start, end).trim();
}

/**
 * Run all deterministic rules in a bundle against the given text.
 */
export function executeBundleRules(text: string, bundle: LoadedBundle): BundleExecutionResult {
  const matches: BundleRuleMatch[] = [];
  const content = bundle.content;
  const lowerText = text.toLowerCase();

  // ── Banned phrases ─────────────────────────────────────────────────
  // Whole-phrase match on word boundaries (NOT a naive substring `includes`),
  // so a short banned phrase like "win" does not falsely match inside a larger
  // word ("window"). Accented letters are handled via \p{L} — the \b
  // metacharacter does not treat them as word characters.
  for (const phrase of content.bannedPhrases) {
    const hit = matchWholePhrase(text, phrase);
    if (hit) {
      const sentence = sentenceAround(text, text.indexOf(hit), hit.length);
      matches.push({
        ruleType: "banned_phrase",
        severity: "critical",
        message: `Prohibited phrase "${phrase}" appears in: "${sentence}"`,
        evidence: hit,
        context: sentence,
      });
    }
  }

  // ── Regex rules ────────────────────────────────────────────────────
  for (const rule of content.regexRules) {
    try {
      const regex = new RegExp(rule.pattern, rule.flags ?? "gi");
      const match = text.match(regex);
      if (match) {
        const sentence = sentenceAround(text, match.index ?? text.indexOf(match[0]), match[0].length);
        const reason = rule.message ?? `matched the prohibited pattern /${rule.pattern}/`;
        matches.push({
          ruleType: "regex",
          severity: rule.severity,
          message: `${reason} — in: "${sentence}"`,
          evidence: match[0],
          context: sentence,
        });
      }
    } catch {
      // Invalid regex in bundle — skip (should have been caught at compile time)
    }
  }

  // ── Required disclaimers ───────────────────────────────────────────
  // If a trigger word is present, a disclaimer is required. Per product
  // decision, the requirement is satisfied as long as the text contains ANY
  // recognised disclaimer (not necessarily the bundle's exact canonical text):
  // a "missing disclaimer" finding fires ONLY when no disclaimer is present at
  // all. This avoids false positives when the disclaimer is reworded or
  // translated differently from the bundle text.
  for (const disc of content.requiredDisclaimers) {
    const triggers = disc.triggers ?? [];
    const firedTrigger = triggers.find(t => lowerText.includes(t.toLowerCase()));
    const hasAnyTrigger = triggers.length === 0 || firedTrigger !== undefined;
    if (hasAnyTrigger) {
      const disclaimerPresent =
        lowerText.includes(disc.text.toLowerCase()) || hasAnyDisclaimer(text);
      if (!disclaimerPresent) {
        // Exact reason: name the trigger that required a disclosure and show
        // the sentence it appeared in.
        const sentence = firedTrigger
          ? sentenceAround(text, lowerText.indexOf(firedTrigger.toLowerCase()), firedTrigger.length)
          : "";
        const reason = firedTrigger
          ? `The text mentions "${firedTrigger}"${sentence ? ` (in: "${sentence}")` : ""}, which requires a risk disclosure, but no disclaimer was found.`
          : `A required risk disclosure is missing: "${disc.text.substring(0, 80)}…"`;
        matches.push({
          ruleType: "required_disclaimer",
          severity: "major",
          message: reason,
          context: sentence || undefined,
        });
      }
    }
  }

  const hasCritical = matches.some(m => m.severity === "critical");
  return {
    matches,
    passed: matches.length === 0,
    bundleVersion: `${bundle.localeCode}@${bundle.version}`,
    sourceRefs: bundle.sourceRefs,
  };
}
