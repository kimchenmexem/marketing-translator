/**
 * Deterministic French (fr-FR / fr-BE) trading-terminology linter.
 *
 * Encodes the rules captured in the May-2026 human evaluation of MEXEM
 * marketing translations. It is PURE and synchronous — no DB, no LLM — so it
 * can run in CI without an API key. Two consumers:
 *   - the fr-trading regression tests (src/test/fr-trading-rules-tests.ts);
 *   - optionally the post-translation quality gate, if we want hard output-side
 *     enforcement in addition to the prompt-side forbidden-phrase list.
 *
 * CONTEXT-SCOPED: the "négociation" ban only fires for stock-market / trading
 * copy. If the English source genuinely means "negotiate / negotiation"
 * (contracts, deals), the ban is suppressed and "négociation/négocier" is left
 * alone. This is the same scoping the user asked the forbidden-phrase list to
 * respect.
 */

export interface FrTradingFinding {
  /** Stable rule id (used by tests and any callers that branch on it). */
  rule: string;
  /** Human-readable explanation of the violation + the approved wording. */
  message: string;
  /** A short slice of the output around the offending text. */
  excerpt: string;
}

/** Signals that the copy is about the stock market / trading domain. */
const TRADING_SIGNAL =
  /\b(trad(?:e|es|ed|ing|er|ers)|stock|stocks|share|shares|equit\w*|bourse|boursier|action|actions|etf|etp|broker|courtier|portfolio|portefeuille|commission\w*|fee|fees|frais|invest\w*|march[ée]\w*|platform|plateforme)\b/i;

/** Genuine "negotiation" in the SOURCE — suppresses the négociation ban. */
const GENUINE_NEGOTIATION = /\bnegotiat(?:e|es|ed|ing|ion|ions|or|ors)\b/i;

function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 24);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

/** Push a finding for the first match of `re` in `output`, if any. */
function flagFirst(
  findings: FrTradingFinding[],
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

export function lintFrenchTrading(
  output: string,
  opts: { sourceText?: string } = {},
): FrTradingFinding[] {
  const findings: FrTradingFinding[] = [];
  const src = opts.sourceText ?? "";
  const tradingContext = TRADING_SIGNAL.test(src) || TRADING_SIGNAL.test(output);
  const genuineNegotiation = GENUINE_NEGOTIATION.test(src);

  // 1. "négociation" / "négocier" used for stock-market trading.
  if (tradingContext && !genuineNegotiation) {
    flagFirst(
      findings,
      output,
      /n[ée]goci\w*/i,
      "negociation-in-trading",
      'Use "trading" / "trader" / "Tradez" — "négociation/négocier" is never used for the stock market in French.',
    );
  }

  // 1b. "to trade" mistranslated as "échanger" (= exchange/swap) instead of "trader".
  //     Gated on the SOURCE saying "trade" (not "exchange"), so genuine
  //     exchange/swap copy (e.g. currency exchange) is left alone.
  if (tradingContext && /\btrad(?:e|es|ed|ing)\b/i.test(src) && !/\bexchange\b/i.test(src)) {
    flagFirst(
      findings,
      output,
      /[ÉéEe]chang\w*/i,
      "trade-as-echanger",
      'Translate "trade" as "trader" / "Tradez" — "échanger" means to exchange/swap, not to trade on the markets.',
    );
  }

  // 2. "la trading" — "le trading" is masculine.
  flagFirst(
    findings,
    output,
    /\b(?:la|une|cette|ma|ta|sa|notre|votre|leur)\s+trading\b/i,
    "trading-gender",
    '"le trading" is masculine — never "la trading".',
  );

  // 3. "Actions" capitalised mid-phrase after a determiner — should be lowercase.
  //    Sentence-initial "Actions & trading…" is fine, so we require a preceding
  //    lowercase determiner ("des Actions", "les Actions", "d'Actions").
  flagFirst(
    findings,
    output,
    /(?:\b(?:des|les|aux|en|vos|nos|ses|leurs|ces|certaines|plusieurs)\s+|\bd')Actions\b/,
    "actions-capitalized",
    'Common noun "actions" stays lowercase mid-sentence.',
  );

  // 4. "Européen*" capitalised as an ADJECTIVE (after a noun) — should be
  //    lowercase. Only the person-noun "un Européen" keeps the capital, so we
  //    flag only when the preceding word is NOT a determiner.
  {
    const determiners = new Set([
      "un", "une", "le", "la", "les", "des", "de", "du", "d", "l",
      "leur", "leurs", "nos", "vos", "ces", "cet", "cette", "quelques",
      "certains", "certaines",
    ]);
    const re = /(\b[\wàâäéèêëïîôöùûüç]+)\s+(Européens?|Européennes?)\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output)) !== null) {
      if (!determiners.has(m[1].toLowerCase())) {
        findings.push({
          rule: "europeen-capitalized",
          message:
            'Nationality adjective "européen(ne/s)" is lowercase; only the person-noun "un Européen" is capitalised.',
          excerpt: excerpt(output, m.index, m[0].length),
        });
        break;
      }
    }
  }

  // 5. "frais stables" → "frais fixes" (precise financial term) in trading copy.
  if (tradingContext) {
    flagFirst(
      findings,
      output,
      /frais\s+stables?/i,
      "fixed-fees-frais-fixes",
      'Use "frais fixes" (the precise financial term), not "frais stables".',
    );
  }

  // 5b. English "broker" left untranslated (should be "courtier"). The brand
  //     "Interactive Brokers" is exempt.
  if (tradingContext && /\bbroker\b/i.test(output) && !/interactive brokers?/i.test(output)) {
    flagFirst(
      findings,
      output,
      /\bbroker\b/i,
      "broker-courtier",
      'Translate "broker" → "courtier"; do not leave the English word "broker".',
    );
  }

  // 6. Refusal / meta-commentary (chatbot reply) instead of a translation.
  flagFirst(
    findings,
    output,
    /(je suis d[ée]sol[ée]|je ne peux pas (?:vous aider|r[ée]pondre|traduire|fournir)|je suis (?:l[àa]|ici) pour vous aider|comment puis-je vous (?:aider|assister)|puis-je vous aider|je suis (?:votre|un) assistant|n['’]h[ée]sitez pas à me (?:poser|demander|contacter)|en tant qu(?:'|e )(?:ia|assistant)|as an ai\b|i'?m sorry|i cannot\b|how (?:can|may) i (?:help|assist) you)/i,
    "refusal",
    "Output is a refusal / chatbot meta-reply — every input must be translated.",
  );

  // ── Source-dependent faithfulness rules ───────────────────────────────────
  if (src) {
    // 7. "cheapest" softened instead of "le moins cher" / "la moins chère".
    if (
      /\bcheapest\b/i.test(src) &&
      !/moins\s+ch[èe]re?/i.test(output) &&
      /(plus\s+comp[ée]titi\w+|meilleure?\b)/i.test(output)
    ) {
      flagFirst(
        findings,
        output,
        /(plus\s+comp[ée]titi\w+|meilleure?\b)/i,
        "cheapest-faithful",
        '"cheapest" → "le moins cher" / "la moins chère", not softened to "le plus compétitif" / "le meilleur".',
      );
    }

    // 8. "low cost" → "à faible coût", not "économique".
    //    NB: no leading \b — "é" is not a \w char, so \b never matches before it.
    if (/\blow[\s-]?cost\b/i.test(src) && /[ée]conomiques?\b/i.test(output)) {
      flagFirst(
        findings,
        output,
        /[ée]conomiques?\b/i,
        "low-cost-faible-cout",
        '"low cost" → "à faible coût" (technical), not "économique" (sounds like a budget retail product).',
      );
    }

    // 9. "fractional shares" → "actions fractionnées", never bare "fractions".
    if (
      /\bfractional\b/i.test(src) &&
      /\bfractions\b/i.test(output) &&
      !/actions?\s+fractionn[ée]es?/i.test(output)
    ) {
      flagFirst(
        findings,
        output,
        /\bfractions\b/i,
        "fractional-shares",
        '"fractional shares" → "actions fractionnées", never bare "fractions".',
      );
    }

    // 10. Financial "save" CTA → "épargner", not "économiser".
    if (
      /\b(start saving|save today|save now|saving now|begin (?:saving|today))\b/i.test(src) &&
      /[ée]conomis(?:er|ez|e|ent)\b/i.test(output) &&
      !/[ée]pargn/i.test(output)
    ) {
      flagFirst(
        findings,
        output,
        /[ée]conomis\w+/i,
        "save-epargner",
        'Financial "save" CTA → "épargner" (grow/save long-term), not "économiser".',
      );
    }

    // 11. "stock market" / "the market" in general → "la Bourse" / "boursier",
    //     not the literal "marché des actions".
    if (/\b(stock market|the market)\b/i.test(src) && /march[ée]\s+des\s+actions/i.test(output)) {
      flagFirst(
        findings,
        output,
        /march[ée]\s+des\s+actions/i,
        "stock-market-bourse",
        'The market in general → "la Bourse" / "marché boursier", not "marché des actions".',
      );
    }

    // 12. "AI-Powered" → "propulsé par l'IA", not "alimenté" (= power-supplied/fed).
    if (/\bAI[-\s]?(?:powered|driven)\b|\bpowered by ai\b/i.test(src) && /aliment[ée]/i.test(output)) {
      flagFirst(
        findings,
        output,
        /aliment[ée]\w*/i,
        "ai-propulse",
        '"AI-Powered" → "propulsé par l\'IA", not "alimenté" (which means power-supplied/fed).',
      );
    }

    // 13. "like a pro" → "comme un professionnel", not the casual "comme un pro".
    if (/\blike a pro\b/i.test(src) && /\bcomme un pro\b/i.test(output)) {
      flagFirst(
        findings,
        output,
        /\bcomme un pro\b/i,
        "comme-un-pro",
        '"like a pro" → "comme un professionnel", not the casual "comme un pro".',
      );
    }
  }

  return findings;
}

// ─── Conservative auto-repair ────────────────────────────────────────────────

export interface FrTradingRepair {
  /** Stable rule id for the repair that was applied. */
  rule: string;
  /** The exact substring that was replaced. */
  before: string;
  /** What it was replaced with. */
  after: string;
}

/** Map "Négociation"→"Trading" etc. preserving the leading-letter case. */
function casedSwap(matched: string, replacement: string): string {
  const first = matched.charAt(0);
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Deterministically repair ONLY the clearly-unsafe, unambiguous trading-context
 * collocations. Everything else is left for `lintFrenchTrading` to warn about —
 * we never blind-replace a bare "négociation", and we never touch text whose
 * source genuinely means negotiation.
 *
 * Repaired patterns (case-preserving):
 *   - plateforme(s) de négociation → plateforme(s) de trading
 *   - négociation en ligne        → trading en ligne
 *   - négociation d'actions       → trading d'actions
 *   - négocier des actions/ETF/ETP → trader des …
 *   - négociez des actions/ETF/ETP → tradez des …
 *   - la / La trading             → le / Le trading
 */
export function repairFrenchTrading(
  output: string,
  opts: { sourceText?: string } = {},
): { text: string; repairs: FrTradingRepair[] } {
  const src = opts.sourceText ?? "";
  // Context guard: only repair stock-market copy, and never when the source
  // genuinely means "negotiate / negotiation".
  const tradingContext = TRADING_SIGNAL.test(src) || TRADING_SIGNAL.test(output);
  if (!tradingContext || GENUINE_NEGOTIATION.test(src)) return { text: output, repairs: [] };

  const rules: Array<{ rule: string; re: RegExp; fn: (m: string, ...g: string[]) => string }> = [
    { rule: "plateforme-de-trading", re: /(plateformes?\s+de\s+)n[ée]gociation/gi, fn: (_m, g1) => g1 + "trading" },
    { rule: "trading-en-ligne", re: /n[ée]gociation(\s+en\s+ligne)/gi, fn: (m, g1) => casedSwap(m, "trading") + g1 },
    { rule: "trading-d-actions", re: /n[ée]gociation(\s+d['’]\s*actions)/gi, fn: (m, g1) => casedSwap(m, "trading") + g1 },
    { rule: "trader-des", re: /n[ée]gocier(\s+des\s+(?:actions|etfs?|etps?))/gi, fn: (m, g1) => casedSwap(m, "trader") + g1 },
    { rule: "tradez-des", re: /n[ée]gociez(\s+des\s+(?:actions|etfs?|etps?))/gi, fn: (m, g1) => casedSwap(m, "tradez") + g1 },
    // "to trade" mistranslated as "échanger/Échangez" → trader/Tradez (safe collocations only).
    { rule: "trader-des", re: /[ÉéEe]changer(\s+des\s+(?:actions|etfs?|etps?))/gi, fn: (m, g1) => casedSwap(m, "trader") + g1 },
    { rule: "tradez-des", re: /[ÉéEe]changez(\s+des\s+(?:actions|etfs?|etps?))/gi, fn: (m, g1) => casedSwap(m, "tradez") + g1 },
    { rule: "trading-gender", re: /\b(la)(\s+trading)\b/gi, fn: (_m, g1, g2) => casedSwap(g1, "le") + g2 },
  ];

  const repairs: FrTradingRepair[] = [];
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
