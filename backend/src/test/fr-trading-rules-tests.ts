/**
 * French trading-terminology rules — regression tests.
 *
 * Derived directly from the May-2026 human evaluation. Three layers:
 *
 *   A. Linter behaviour (PURE — no DB, no LLM). For each human-eval pair we
 *      assert the BAD output is flagged for the right rule and the APPROVED
 *      output is clean. This is the deterministic core and always runs.
 *
 *   B. Style-guide content (PURE). Asserts the fr-FR / fr-BE style guides carry
 *      the reviewer guidance the prompt relies on.
 *
 *   C. DB rule channels (glossary + forbidden phrases). Requires the DB and the
 *      seed/fix scripts to have run; skipped cleanly if the DB is unreachable.
 *
 * Run with:
 *   npm --workspace backend run fix:fr-trading-glossary -- --apply   # (C) data
 *   npm --workspace backend run seed:fr-trading-forbidden            # (C) data
 *   npm --workspace backend run test:fr-trading-rules
 */
import { prisma } from "../db";
import { getLocaleStyleGuide } from "../services/ai";
import { lintFrenchTrading, repairFrenchTrading } from "../services/frenchTradingLint";
import { applyFrenchTradingGate } from "../services/frenchTradingGate";
import { qualityGateConfig } from "../services/qualityGateConfig";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.error(`  ✖ FAIL: ${name}`);
  }
}

function section(name: string) {
  console.log(`\n═══ ${name} ═══`);
}

/** The BAD output must produce a finding for `rule`. */
function expectFlagged(rule: string, source: string, badOutput: string) {
  const found = lintFrenchTrading(badOutput, { sourceText: source });
  assert(
    found.some((f) => f.rule === rule),
    `flags ${rule}: "${badOutput.slice(0, 48)}…"  (got: ${found.map((f) => f.rule).join(",") || "none"})`,
  );
}

/** The APPROVED output must be clean (no findings at all). */
function expectClean(source: string, goodOutput: string) {
  const found = lintFrenchTrading(goodOutput, { sourceText: source });
  assert(
    found.length === 0,
    `clean: "${goodOutput.slice(0, 48)}…"  (got: ${found.map((f) => f.rule).join(",") || "none"})`,
  );
}

async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function assertGlossary(locale: string, source: string, expectedTarget: string) {
  const row = await prisma.glossaryTerm.findFirst({
    where: { localeCode: locale, sourceTerm: source },
    select: { targetTerm: true },
  });
  assert(
    row !== null && row.targetTerm === expectedTarget,
    `[${locale}] Glossary: ${source} → ${expectedTarget} (got: ${row?.targetTerm ?? "missing"})`,
  );
}

async function assertGlossaryFree(locale: string, source: string, banned: RegExp) {
  const row = await prisma.glossaryTerm.findFirst({
    where: { localeCode: locale, sourceTerm: source },
    select: { targetTerm: true },
  });
  assert(
    row !== null && !banned.test(row.targetTerm),
    `[${locale}] Glossary "${source}" free of ${banned} (got: ${row?.targetTerm ?? "missing"})`,
  );
}

async function assertForbidden(locale: string, phrase: string) {
  const row = await prisma.forbiddenPhrase.findUnique({
    where: { localeCode_phrase: { localeCode: locale, phrase } },
    select: { active: true },
  });
  assert(row !== null && row.active === true, `[${locale}] Forbidden (active): "${phrase}"`);
}

async function main() {
  // ── A. Linter regression on the human-eval corpus ────────────────────────
  section("A. négociation → trading (never 'négociation' for the stock market)");
  expectFlagged("negociation-in-trading", "Online Trading", "Négociation en ligne");
  expectClean("Online Trading", "Trading en ligne");
  expectFlagged("negociation-in-trading", "Stock Trading", "Négociation d'actions");
  expectClean("Stock Trading", "Trading d'actions");
  expectFlagged("negociation-in-trading", "trading platform", "plateforme de négociation");
  expectClean("trading platform", "plateforme de trading");
  expectFlagged("negociation-in-trading", "How to trade ETFs in Europe", "négocier des ETF en Europe");
  expectClean("How to trade ETFs in Europe", "trader des ETF en Europe");
  expectFlagged("negociation-in-trading", "Trade EU stocks", "Négociez des actions européennes");
  expectClean("Trade EU stocks", "Tradez des actions européennes");
  // Genuine negotiation in the source is NOT flagged.
  expectClean("We negotiate contracts with partners", "Nous négocions des contrats avec nos partenaires");

  section("B. 'le trading' is masculine, never 'la trading'");
  expectFlagged("trading-gender", "your broker for ETF trading", "votre courtier pour la trading d'ETF");
  expectClean("your broker for ETF trading", "votre courtier pour le trading d'ETF");
  expectFlagged("negociation-in-trading", "transparent trading", "la négociation transparente");
  expectClean("transparent trading", "le trading transparent");

  section("C. 'actions' lowercase mid-sentence");
  expectFlagged("actions-capitalized", "Buy Stocks", "Achetez des Actions");
  expectClean("Buy Stocks", "Achetez des actions");

  section("D. nationality adjective 'européen' lowercase");
  expectFlagged("europeen-capitalized", "EU Broker", "Courtier Européen");
  expectClean("EU Broker", "Courtier européen");

  section("E. faithful superlatives: cheapest → le moins cher / la moins chère");
  expectFlagged(
    "cheapest-faithful",
    "Cheapest broker for EU stocks",
    "Le courtier le plus compétitif pour les actions européennes",
  );
  expectClean("Cheapest broker for EU stocks", "Courtier le moins cher pour les actions européennes");
  expectFlagged(
    "cheapest-faithful",
    "Cheapest alternative to Interactive Brokers",
    "La meilleure alternative à Interactive Brokers",
  );
  expectClean("Cheapest alternative to Interactive Brokers", "Alternative la moins chère à Interactive Brokers");

  section("F. low cost → à faible coût (not 'économique')");
  expectFlagged(
    "low-cost-faible-cout",
    "Pioneering the path towards transparent, low-cost trading.",
    "Ouvrir la voie vers un trading transparent et économique.",
  );
  expectClean(
    "Pioneering the path towards transparent, low-cost trading.",
    "Ouvrir la voie vers un trading transparent et à faible coût.",
  );

  section("G. fixed / flat fees → frais fixes (not 'frais stables')");
  expectFlagged("fixed-fees-frais-fixes", "Stable fees, clear cost.", "Des frais stables, une transparence des coûts.");
  expectClean("Stable fees, clear cost.", "Des frais fixes, des coûts transparents.");

  section("H. fractional shares → actions fractionnées (never bare 'fractions')");
  expectFlagged(
    "fractional-shares",
    "Enjoy the flexibility of fractional shares.",
    "Profitez de la flexibilité des fractions.",
  );
  expectClean("Enjoy the flexibility of fractional shares.", "Profitez de la flexibilité des actions fractionnées.");

  section("I. financial 'save' CTA → épargner (not 'économiser')");
  expectFlagged("save-epargner", "Join & save today!", "Rejoignez-nous et économisez dès aujourd'hui !");
  expectClean("Join & save today!", "Rejoignez-nous et épargnez dès aujourd'hui !");

  section("J. the market in general → la Bourse / boursier (not 'marché des actions')");
  expectFlagged("stock-market-bourse", "Invest in the Stock Market", "Investissez dans le marché des actions");
  expectClean("Invest in the Stock Market", "Investissez dans le marché boursier");

  section("K. never return a refusal / meta-commentary");
  expectFlagged("refusal", "Then you should know this.", "Je suis désolé, mais je ne peux pas vous aider avec ça.");
  // Chatbot meta-reply variant observed in live verification (June 2026).
  expectFlagged("refusal", "Then you should know this.", "Je suis là pour vous aider. Comment puis-je vous assister aujourd'hui ?");
  expectClean("Then you should know this.", "Dans ce cas, vous devriez savoir ceci :");

  // ── A2. Auto-repair (conservative, deterministic) ─────────────────────────
  section("L. auto-repair fixes the clearly-unsafe collocations");
  function expectRepair(source: string, bad: string, expected: string) {
    const { text } = repairFrenchTrading(bad, { sourceText: source });
    assert(text === expected, `repair: "${bad}" → "${text}" (expected "${expected}")`);
  }
  expectRepair("trading platform", "plateforme de négociation", "plateforme de trading");
  expectRepair("trading platforms", "plateformes de négociation", "plateformes de trading");
  expectRepair("Online Trading", "Négociation en ligne", "Trading en ligne");
  expectRepair("Stock Trading", "Négociation d'actions", "Trading d'actions");
  expectRepair("trade ETFs", "négocier des ETF", "trader des ETF");
  expectRepair("Trade stocks", "Négociez des actions", "Tradez des actions");
  expectRepair("ETF trading", "votre courtier pour la trading d'ETF", "votre courtier pour le trading d'ETF");
  expectRepair("transparent trading", "La trading transparente", "Le trading transparente");

  section("M. auto-repair stays conservative");
  {
    // Bare / ambiguous "négociation" with no safe rewrite is NOT mutated…
    const amb = repairFrenchTrading("low fees", { sourceText: "Low fees broker" });
    assert(amb.repairs.length === 0, "ambiguous case is not auto-repaired");
    const courtier = repairFrenchTrading("courtier en négociation à frais réduits", { sourceText: "low-cost trading broker" });
    assert(
      courtier.text === "courtier en négociation à frais réduits" && courtier.repairs.length === 0,
      "unenumerated 'courtier en négociation' is left for warning, not blind-replaced",
    );
    // …but the linter still flags it so it surfaces as a warning.
    assert(
      lintFrenchTrading(courtier.text, { sourceText: "low-cost trading broker" }).some((f) => f.rule === "negociation-in-trading"),
      "the unrepaired 'négociation' is still flagged as a warning",
    );
    // Genuine negotiation source → never touched.
    const genuine = repairFrenchTrading("Nous négocions le contrat", { sourceText: "We negotiate the contract terms" });
    assert(genuine.repairs.length === 0, "genuine-negotiation source is never repaired");
  }

  // ── A3. Runtime gate (scoping + modes) ─────────────────────────────────────
  section("N. runtime gate: scoping and modes");
  const savedMode = qualityGateConfig.frTradingGateMode;
  try {
    qualityGateConfig.frTradingGateMode = "repair";
    const frFr = applyFrenchTradingGate("trading platform", "plateforme de négociation", "fr-FR");
    assert(frFr.text === "plateforme de trading" && frFr.repairs.length === 1, "[repair] fr-FR is auto-repaired");
    const frBe = applyFrenchTradingGate("Online Trading", "Négociation en ligne", "fr-BE");
    assert(frBe.text === "Trading en ligne" && frBe.repairs.length === 1, "[repair] fr-BE is auto-repaired");
    const es = applyFrenchTradingGate("trading platform", "plataforma de negociación", "es-ES");
    assert(es.text === "plataforma de negociación" && es.repairs.length === 0, "[repair] non-FR locale untouched");

    qualityGateConfig.frTradingGateMode = "warn";
    const warn = applyFrenchTradingGate("trading platform", "plateforme de négociation", "fr-FR");
    assert(
      warn.text === "plateforme de négociation" && warn.repairs.length === 0 && warn.warnings.length > 0,
      "[warn] never mutates but surfaces warnings",
    );

    qualityGateConfig.frTradingGateMode = "off";
    const off = applyFrenchTradingGate("trading platform", "plateforme de négociation", "fr-FR");
    assert(off.text === "plateforme de négociation" && off.repairs.length === 0 && off.warnings.length === 0, "[off] no-op");
  } finally {
    qualityGateConfig.frTradingGateMode = savedMode;
  }

  // ── B. Style-guide content ────────────────────────────────────────────────
  section("Style-guide content (fr-FR / fr-BE)");
  const fr = getLocaleStyleGuide("fr-FR");
  assert(/ONLY acceptable word for stock-market trading/i.test(fr), "[fr-FR] bans 'négociation' for trading");
  assert(/"le trading" is a MASCULINE noun/i.test(fr), "[fr-FR] 'le trading' masculine rule");
  assert(/le moins cher/i.test(fr), "[fr-FR] faithful 'cheapest' → 'le moins cher'");
  assert(/faible coût/i.test(fr), "[fr-FR] 'faible coût' over 'économique'");
  assert(/frais fixes/i.test(fr), "[fr-FR] 'frais fixes' over 'frais stables'");
  assert(/actions fractionnées/i.test(fr), "[fr-FR] 'actions fractionnées'");
  assert(/épargner/i.test(fr), "[fr-FR] financial 'épargner'");
  assert(/never output a refusal/i.test(fr), "[fr-FR] never refuse — always translate");

  const frBe = getLocaleStyleGuide("fr-BE");
  assert(/NEVER "la trading"|never "la trading"/i.test(frBe), "[fr-BE] inherits 'le trading' masculine rule");
  assert(/n[ée]gociation/i.test(frBe) && /trading/i.test(frBe), "[fr-BE] inherits the négociation→trading rule");

  // ── C. DB rule channels (skipped if the DB is unreachable) ────────────────
  section("DB rule channels (glossary + forbidden phrases)");
  if (!(await dbReachable())) {
    console.log("  ⚠ SKIP: database not reachable — run the seed/fix scripts and a DB to verify these.");
  } else {
    for (const locale of ["fr-FR", "fr-BE"]) {
      await assertGlossary(locale, "trading platform", "plateforme de trading");
      await assertGlossaryFree(locale, "trading platform", /n[ée]gociation/i);
      await assertForbidden(locale, "plateforme de négociation");
      await assertForbidden(locale, "négociation en ligne");
      await assertForbidden(locale, "négocier des ETF");
      await assertForbidden(locale, "la trading");
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error("Test run failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
