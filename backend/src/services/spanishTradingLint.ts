/**
 * Deterministic Spanish (es-ES) trading-terminology linter + repairer.
 *
 * Encodes the rules from the May-2026 es-ES human evaluation. PURE and
 * synchronous (no DB, no LLM). Mirrors frenchTradingLint.ts.
 *
 * CONTEXT-SCOPED: the "negociación" ban only fires for stock-market / trading
 * copy, and is suppressed when the English source genuinely means "negotiate".
 *
 * Register (tú vs usted) is intentionally NOT linted/repaired here — verb
 * conjugation makes deterministic rewriting unsafe; the prompt style guide
 * drives the informal "tú" register instead.
 */

export interface SpTradingFinding {
  rule: string;
  message: string;
  excerpt: string;
}

export interface SpTradingRepair {
  rule: string;
  before: string;
  after: string;
}

/** Signals that the copy is about the stock market / trading domain. */
const TRADING_SIGNAL =
  /\b(trad(?:e|es|ed|ing|er|ers)|stock|stocks|share|shares|etf|etp|broker|br[oó]ker|acci[oó]n|acciones|invertir|inversi[oó]n|bolsa|mercado|mercados|comisi\w*|cartera|operar|operaci[oó]n)\b/i;

/** Genuine "negotiation" in the SOURCE — suppresses the negociación ban. */
const GENUINE_NEGOTIATION = /\bnegotiat(?:e|es|ed|ing|ion|ions|or|ors)\b/i;

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 24);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

function flagFirst(
  findings: SpTradingFinding[],
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

export function lintSpanishTrading(
  output: string,
  opts: { sourceText?: string } = {},
): SpTradingFinding[] {
  const findings: SpTradingFinding[] = [];
  const src = opts.sourceText ?? "";
  const tradingContext = TRADING_SIGNAL.test(src) || TRADING_SIGNAL.test(output);
  const genuineNegotiation = GENUINE_NEGOTIATION.test(src);

  // 1. "negociación" / "negociar" used for stock-market trading.
  if (tradingContext && !genuineNegotiation) {
    flagFirst(
      findings,
      output,
      /negoci(?:aci[oó]n|ar|e|es|emos|an|ado|ada)\w*/i,
      "negociacion-in-trading",
      'Use "trading" (noun) / "operar" (verb) — "negociación/negociar" is not used for retail trading copy in this brand.',
    );
  }

  // 2. ETF / ETP pluralised — they are invariant in Spanish.
  flagFirst(
    findings,
    output,
    /\bET[FP]s\b/,
    "etf-etp-invariant",
    '"ETF" / "ETP" are invariant in Spanish — no plural "-s".',
  );

  // 3. "broker" left as "corredor" (should be "bróker").
  if (tradingContext) {
    flagFirst(
      findings,
      output,
      /\bcorredor(?:es)?\b/i,
      "broker-broker",
      'Translate "broker" as "bróker" (accented), not "corredor".',
    );
  }

  // 4. Refusal / meta-commentary instead of a translation.
  flagFirst(
    findings,
    output,
    /(lo siento|no puedo ayudarte|no puedo ayudarle|no puedo responder|como (?:una )?ia\b|as an ai\b|i'?m sorry|i cannot\b|c[oó]mo puedo ayudarte)/i,
    "refusal",
    "Output is a refusal / chatbot meta-reply — every input must be translated.",
  );

  // ── Source-dependent preferences ──────────────────────────────────────────
  if (src) {
    // 5. "fees" → "comisiones", not "tarifas".
    if (/\bfees?\b/i.test(src) && /\btarifas?\b/i.test(output)) {
      flagFirst(
        findings,
        output,
        /\btarifas?\b/i,
        "fees-comisiones",
        '"fees" → "comisiones", not "tarifas".',
      );
    }

    // 6. European Spanish "costes", not "costos".
    if (/\bcosts?\b/i.test(src) && /\bcostos?\b/i.test(output)) {
      flagFirst(findings, output, /\bcostos?\b/i, "costes-not-costos", 'Use European Spanish "costes", not "costos".');
    }

    // 7. "cheapest / cheap" → "más barato/a", not "más económico/a".
    if (/\bcheap(?:est)?\b/i.test(src) && /m[áa]s\s+econ[óo]mic[oa]s?\b/i.test(output)) {
      flagFirst(
        findings,
        output,
        /m[áa]s\s+econ[óo]mic[oa]s?\b/i,
        "cheapest-mas-barato",
        '"cheapest" → "más barato/a" (preferred over "más económico/a").',
      );
    }

    // 8. "AI-Powered" → "con inteligencia artificial", not "impulsada/o por IA".
    if (/\bAI[-\s]?(?:powered|driven)\b|\bpowered by ai\b/i.test(src) && /\bpor\s+IA\b|impulsad[oa]/i.test(output)) {
      flagFirst(
        findings,
        output,
        /(?:impulsad[oa]\s+por\s+IA|por\s+IA)/i,
        "ai-inteligencia-artificial",
        '"AI-Powered" → "con inteligencia artificial" (spell it out), not "impulsada por IA".',
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
 * Repair ONLY the unambiguous, safe collocations. The "negociar → operar" verb
 * swap is NOT auto-repaired (it needs a preposition — "operar con/en" — so a
 * clean substitution is impossible); it is left for the linter to warn.
 *
 * Repaired:
 *   - ETFs / ETPs            → ETF / ETP (invariant)
 *   - negociación en línea   → trading en línea
 *   - plataforma de negociación → plataforma de inversión
 */
export function repairSpanishTrading(
  output: string,
  opts: { sourceText?: string } = {},
): { text: string; repairs: SpTradingRepair[] } {
  const src = opts.sourceText ?? "";
  const tradingContext = TRADING_SIGNAL.test(src) || TRADING_SIGNAL.test(output);
  if (!tradingContext) return { text: output, repairs: [] };
  const genuineNegotiation = GENUINE_NEGOTIATION.test(src);

  const rules: Array<{ rule: string; re: RegExp; fn: (m: string, ...g: string[]) => string }> = [
    { rule: "etf-invariant", re: /\bETFs\b/g, fn: () => "ETF" },
    { rule: "etp-invariant", re: /\bETPs\b/g, fn: () => "ETP" },
  ];
  if (!genuineNegotiation) {
    rules.push(
      { rule: "trading-en-linea", re: /negociaci[oó]n(\s+en\s+l[ií]nea)/gi, fn: (m, g1) => casedSwap(m, "trading") + g1 },
      { rule: "plataforma-inversion", re: /(plataformas?\s+de\s+)negociaci[oó]n/gi, fn: (_m, g1) => g1 + "inversión" },
    );
  }

  const repairs: SpTradingRepair[] = [];
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
