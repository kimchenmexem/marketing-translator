/**
 * Deterministic Dutch (nl-NL / nl-BE) trading-terminology linter + repairer.
 *
 * From the May-2026 nl-NL human eval. PURE and synchronous. Mirrors the French
 * and Spanish linters, but Dutch is mostly word-choice polish: the only clear
 * error is "makelaar" (= real-estate agent) for "broker".
 *
 * Register stays formal ("u/uw") — the eval kept it, so it is NOT linted.
 */

export interface NlTradingFinding {
  rule: string;
  message: string;
  excerpt: string;
}

export interface NlTradingRepair {
  rule: string;
  before: string;
  after: string;
}

/** Signals that the copy is about the stock market / trading domain. */
const TRADING_SIGNAL =
  /\b(trad(?:e|es|ed|ing|er)|stock|stocks|share|shares|etf|etp|broker|aandel\w*|beleg\w*|effecten|handel\w*|markt|markten|kosten|tarie\w*|portefeuille|fonds|commissie\w*)\b/i;

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 24);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

function flagFirst(
  findings: NlTradingFinding[],
  output: string,
  re: RegExp,
  rule: string,
  message: string,
): boolean {
  const m = output.match(re);
  if (!m || m.index === undefined) return false;
  findings.push({ rule, message, excerpt: excerpt(output, m.index, m[0].length) });
  return true;
}

export function lintDutchTrading(
  output: string,
  opts: { sourceText?: string } = {},
): NlTradingFinding[] {
  const findings: NlTradingFinding[] = [];
  const src = opts.sourceText ?? "";
  const tradingContext = TRADING_SIGNAL.test(src) || TRADING_SIGNAL.test(output);

  // 1. "makelaar" (= real-estate agent) used for "broker".
  if (tradingContext) {
    flagFirst(
      findings,
      output,
      /makelaar\w*/i,
      "broker-not-makelaar",
      'Use the loanword "broker" — "makelaar" means a real-estate agent in Dutch.',
    );
  }

  // 2. "handelsplatform" sounds dated — prefer "tradingplatform" / "broker".
  if (tradingContext) {
    flagFirst(
      findings,
      output,
      /\bhandelsplatform\w*/i,
      "tradingplatform-not-handelsplatform",
      'Prefer "tradingplatform" / "broker" — "handelsplatform(en)" sounds dated.',
    );
  }

  // 3. Refusal / meta-commentary instead of a translation.
  flagFirst(
    findings,
    output,
    /(het spijt me|ik kan je niet helpen|ik kan u niet helpen|ik kan niet|als (?:een )?ai\b|as an ai\b|i'?m sorry|i cannot\b|sorry, maar)/i,
    "refusal",
    "Output is a refusal / chatbot meta-reply — every input must be translated.",
  );

  // ── Source-dependent preferences ──────────────────────────────────────────
  if (src) {
    // 4. cheap / cheapest / affordable → "voordelig" family, not "goedkoop"
    //    ("goedkoop" sounds cheap/low-quality).
    if (/\b(cheap(?:est)?|affordable|low[\s-]?cost)\b/i.test(src) && /\bgoedko\w+/i.test(output)) {
      flagFirst(
        findings,
        output,
        /\bgoedko\w+/i,
        "voordelig-not-goedkoop",
        'Use "voordelig / voordeligste" — "goedkoop / goedkoopste" sounds cheap.',
      );
    }

    // 5. "with low fees" → "tegen lage kosten", not "met lage kosten".
    if (/\bwith low fees\b|\blow fees\b/i.test(src) && /\bmet lage kosten\b/i.test(output)) {
      flagFirst(
        findings,
        output,
        /\bmet lage kosten\b/i,
        "tegen-lage-kosten",
        '"with low fees" → "tegen lage kosten", not "met lage kosten".',
      );
    }

    // 6. "AI-Powered" → "AI-ondersteund" / "Slimmer beleggen met AI", not "AI-gestuurd".
    if (/\bAI[-\s]?(?:powered|driven)\b|\bpowered by ai\b/i.test(src) && /\bAI-gestuurd\w*/i.test(output)) {
      flagFirst(
        findings,
        output,
        /\bAI-gestuurd\w*/i,
        "ai-ondersteund",
        '"AI-Powered" → "AI-ondersteund" or "Slimmer beleggen met AI", not "AI-gestuurd".',
      );
    }
  }

  return findings;
}

// ─── Conservative auto-repair ────────────────────────────────────────────────

function casedSwap(matched: string, replacement: string): string {
  const first = matched.charAt(0);
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Repair only the safe, unambiguous swaps. "makelaar" is NOT auto-repaired
 * (it shows up inside compounds like "aandelenhandelsmakelaar" where a blind
 * swap reads badly) — it is warned instead.
 *
 * Repaired:
 *   - met lage kosten → tegen lage kosten
 *   - AI-gestuurd     → AI-ondersteund
 *   - (source cheap/affordable) goedkoop family → voordelig family
 */
export function repairDutchTrading(
  output: string,
  opts: { sourceText?: string } = {},
): { text: string; repairs: NlTradingRepair[] } {
  const src = opts.sourceText ?? "";
  // No trading-context guard: the gate is already locale-scoped (nl-NL/nl-BE),
  // and each rule below has its own specific trigger (source "cheap", literal
  // "met lage kosten", literal "AI-gestuurd"), so they are safe on their own.

  const rules: Array<{ rule: string; re: RegExp; fn: (m: string, ...g: string[]) => string }> = [
    { rule: "tegen-lage-kosten", re: /\bmet(\s+lage\s+kosten)\b/gi, fn: (m, g1) => casedSwap(m, "tegen") + g1 },
    { rule: "ai-ondersteund", re: /\bAI-gestuurd\b/gi, fn: (m) => (m.charAt(3) === "G" ? "AI-Ondersteund" : "AI-ondersteund") },
    // "handelsplatform(en/s)" → "tradingplatform(en)" (plural normalised to -en).
    { rule: "tradingplatform", re: /\bhandelsplatform(?:en|s)\b/gi, fn: (m) => casedSwap(m, "tradingplatformen") },
    { rule: "tradingplatform", re: /\bhandelsplatform\b/gi, fn: (m) => casedSwap(m, "tradingplatform") },
  ];
  if (/\b(cheap(?:est)?|affordable|low[\s-]?cost)\b/i.test(src)) {
    rules.push(
      { rule: "voordelig-not-goedkoop", re: /\bgoedkoopste\b/gi, fn: (m) => casedSwap(m, "voordeligste") },
      { rule: "voordelig-not-goedkoop", re: /\bgoedkoper\b/gi, fn: (m) => casedSwap(m, "voordeliger") },
      { rule: "voordelig-not-goedkoop", re: /\bgoedkope\b/gi, fn: (m) => casedSwap(m, "voordelige") },
      { rule: "voordelig-not-goedkoop", re: /\bgoedkoop\b/gi, fn: (m) => casedSwap(m, "voordelig") },
    );
  }

  const repairs: NlTradingRepair[] = [];
  let text = output;
  for (const { rule, re, fn } of rules) {
    text = text.replace(re, (...args) => {
      const m = args[0] as string;
      const groups = args.slice(1, -2) as string[];
      const after = fn(m, ...groups);
      if (after !== m) repairs.push({ rule, before: m, after });
      return after;
    });
  }
  return { text, repairs };
}
