/**
 * Deterministic Greek (el-GR) trading-terminology linter + repairer.
 *
 * Encodes the confident, objective rules used to refine the el-GR style guide
 * (grammar/orthography + cross-locale consistency). PURE and synchronous
 * (no DB, no LLM). Mirrors spanishTradingLint.ts.
 *
 * Only the unambiguous, gender/inflection-free collocations are auto-repaired
 * (ETF/ETP invariant). Anything that would require Greek adjective agreement or
 * a preposition insertion (ΕΕ → ευρωπαϊκές, "trading μετοχές" → "trading σε
 * μετοχές") is WARN-only — the prompt style guide drives those, because a blind
 * substitution would mangle agreement. Register (εσείς) is likewise left to the
 * style guide.
 */

export interface ElTradingFinding {
  rule: string;
  message: string;
  excerpt: string;
}

export interface ElTradingRepair {
  rule: string;
  before: string;
  after: string;
}

/** Signals that the copy is about the stock market / trading domain. */
const TRADING_SIGNAL =
  /\b(trad(?:e|es|ed|ing|er|ers)|stock|stocks|share|shares|etfs?|etps?|broker)\b|μετοχ|χρηματιστ|επενδ|συναλλαγ|χαρτοφυλάκι/iu;

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 24);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

function flagFirst(
  findings: ElTradingFinding[],
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

export function lintGreekTrading(
  output: string,
  opts: { sourceText?: string } = {},
): ElTradingFinding[] {
  const findings: ElTradingFinding[] = [];
  const src = opts.sourceText ?? "";
  const tradingContext = TRADING_SIGNAL.test(src) || TRADING_SIGNAL.test(output);

  // 1. ETF / ETP pluralised — invariant in Greek (auto-repaired; flagged for visibility).
  flagFirst(
    findings,
    output,
    /\bET[FP]s\b/,
    "etf-etp-invariant",
    '"ETF" / "ETP" are invariant in Greek — no plural "-s".',
  );

  // 2. "ΕΕ" used where the source says European stocks/markets — prefer the
  //    spelled-out adjective "ευρωπαϊκές/ευρωπαϊκά …", not the abbreviation.
  if (tradingContext && /\bEU\b|european/i.test(src)) {
    flagFirst(
      findings,
      output,
      /(?<![\p{L}\p{N}])ΕΕ(?![\p{L}\p{N}])/u,
      "eu-spelled-out",
      'Spell out "ευρωπαϊκές/ευρωπαϊκά …" (e.g. ευρωπαϊκές μετοχές) instead of the abbreviation "ΕΕ".',
    );
  }

  // 3. "κάντε trading μετοχές" — needs the preposition "σε" (+ accusative).
  if (tradingContext) {
    flagFirst(
      findings,
      output,
      /trading\s+(?:τις\s+|τα\s+)?μετοχ\w*/iu,
      "trading-preposition",
      'Use "trading σε μετοχές" — "trading" takes the preposition "σε" (+ accusative), not a bare noun.',
    );
  }

  // 4. Refusal / meta-commentary instead of a translation.
  flagFirst(
    findings,
    output,
    /(λυπάμαι|δεν μπορώ να (?:βοηθήσω|απαντήσω)|ως (?:ένα )?(?:τεχνητή νοημοσύνη|μοντέλο)|as an ai\b|i'?m sorry|i cannot\b)/iu,
    "refusal",
    "Output is a refusal / chatbot meta-reply — every input must be translated.",
  );

  return findings;
}

// ─── Conservative auto-repair ────────────────────────────────────────────────

/**
 * Repair ONLY the unambiguous, inflection-free collocations:
 *   - ETFs / ETPs → ETF / ETP (invariant)
 *
 * The ΕΕ → ευρωπαϊκές and preposition fixes are NOT auto-repaired (Greek
 * adjective agreement / preposition government makes a clean substitution
 * unsafe); they are WARN-only.
 */
export function repairGreekTrading(
  output: string,
  opts: { sourceText?: string } = {},
): { text: string; repairs: ElTradingRepair[] } {
  const src = opts.sourceText ?? "";
  const tradingContext = TRADING_SIGNAL.test(src) || TRADING_SIGNAL.test(output);
  if (!tradingContext) return { text: output, repairs: [] };

  const rules: Array<{ rule: string; re: RegExp; fn: () => string }> = [
    { rule: "etf-invariant", re: /\bETFs\b/g, fn: () => "ETF" },
    { rule: "etp-invariant", re: /\bETPs\b/g, fn: () => "ETP" },
  ];

  const repairs: ElTradingRepair[] = [];
  let text = output;
  for (const { rule, re, fn } of rules) {
    text = text.replace(re, (m) => {
      const after = fn();
      if (after !== m) repairs.push({ rule, before: m, after });
      return after;
    });
  }
  return { text, repairs };
}
