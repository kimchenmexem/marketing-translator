/**
 * Spanish (es-ES) trading-terminology rules — regression tests.
 *
 * Derived from the May-2026 es-ES human eval. Layers:
 *   A. Linter behaviour (pure) — eval before/after pairs.
 *   B. Auto-repair (pure) — safe collocations only.
 *   C. Gate scoping/modes (pure).
 *   D. Style-guide content (pure).
 *   E. DB rule channels — skipped if the DB is unreachable.
 *
 * Run:
 *   npm --workspace backend run seed:homepage-translations
 *   npm --workspace backend run seed:es-trading-forbidden
 *   npm --workspace backend run test:es-trading-rules
 */
import { prisma } from "../db";
import { getLocaleStyleGuide } from "../services/ai";
import { lintSpanishTrading, repairSpanishTrading } from "../services/spanishTradingLint";
import { applySpanishTradingGate } from "../services/spanishTradingGate";
import { qualityGateConfig } from "../services/qualityGateConfig";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.error(`  ✖ FAIL: ${name}`); }
}
function section(name: string) { console.log(`\n═══ ${name} ═══`); }

function expectFlagged(rule: string, source: string, badOutput: string) {
  const f = lintSpanishTrading(badOutput, { sourceText: source });
  assert(f.some((x) => x.rule === rule), `flags ${rule}: "${badOutput.slice(0, 48)}…"  (got: ${f.map((x) => x.rule).join(",") || "none"})`);
}
function expectClean(source: string, goodOutput: string) {
  const f = lintSpanishTrading(goodOutput, { sourceText: source });
  assert(f.length === 0, `clean: "${goodOutput.slice(0, 48)}…"  (got: ${f.map((x) => x.rule).join(",") || "none"})`);
}
function expectRepair(source: string, bad: string, expected: string) {
  const { text } = repairSpanishTrading(bad, { sourceText: source });
  assert(text === expected, `repair: "${bad}" → "${text}" (expected "${expected}")`);
}

async function dbReachable(): Promise<boolean> {
  try { await prisma.$queryRaw`SELECT 1`; return true; } catch { return false; }
}
async function assertGlossary(source: string, expectedTarget: string) {
  const row = await prisma.glossaryTerm.findFirst({ where: { localeCode: "es-ES", sourceTerm: source }, select: { targetTerm: true } });
  assert(row !== null && row.targetTerm === expectedTarget, `[es-ES] Glossary: ${source} → ${expectedTarget} (got: ${row?.targetTerm ?? "missing"})`);
}
async function assertForbidden(phrase: string) {
  const row = await prisma.forbiddenPhrase.findUnique({ where: { localeCode_phrase: { localeCode: "es-ES", phrase } }, select: { active: true } });
  assert(row !== null && row.active === true, `[es-ES] Forbidden (active): "${phrase}"`);
}

async function main() {
  // ── A. Linter regression ──────────────────────────────────────────────────
  section("A. negociación → trading (noun) / operar (verb)");
  expectFlagged("negociacion-in-trading", "Online trading", "Negociación en Línea");
  expectClean("Online trading", "Trading en línea");
  expectFlagged("negociacion-in-trading", "How to trade stocks", "Cómo negociar acciones con comisiones bajas");
  expectClean("How to trade stocks", "Cómo operar en acciones con comisiones bajas");
  expectFlagged("negociacion-in-trading", "transparent trading", "negociación transparente");
  expectClean("transparent trading", "trading transparente");
  // Genuine negotiation in source is NOT flagged.
  expectClean("We negotiate the contract", "Negociamos el contrato con socios");

  section("B. ETF / ETP invariant (no plural)");
  expectFlagged("etf-etp-invariant", "Trade ETFs", "Opera con ETFs europeos");
  expectClean("Trade ETFs", "Opera con ETF europeos");
  expectFlagged("etf-etp-invariant", "commission-free ETPs", "ETPs sin comisiones");
  expectClean("commission-free ETPs", "ETP sin comisiones");

  section("C. broker → bróker (not corredor); preferences");
  expectFlagged("broker-broker", "EU Broker", "Corredor de la UE");
  expectClean("EU Broker", "Bróker europeo");
  expectFlagged("fees-comisiones", "low fees broker", "bróker con tarifas bajas");
  expectClean("low fees broker", "bróker con comisiones bajas");
  expectFlagged("costes-not-costos", "for a clearer cost outlook", "para una visión más clara de los costos");
  expectClean("for a clearer cost outlook", "para una visión más clara de los costes");
  expectFlagged("cheapest-mas-barato", "Cheapest broker for EU stocks", "El bróker más económico para acciones europeas");
  expectClean("Cheapest broker for EU stocks", "El bróker más barato para acciones europeas");
  expectFlagged("ai-inteligencia-artificial", "AI-Powered Investing", "Inversión impulsada por IA");
  expectClean("AI-Powered Investing", "Inversión con inteligencia artificial");

  section("D. refusal");
  expectFlagged("refusal", "Then you should know this.", "Lo siento, no puedo ayudarte con eso.");
  expectClean("Then you should know this.", "Entonces, esto te interesa.");

  // ── B. Auto-repair ─────────────────────────────────────────────────────────
  section("E. auto-repair (safe collocations only)");
  expectRepair("Online trading", "Negociación en Línea", "Trading en Línea");
  expectRepair("trading platform", "plataforma de negociación", "plataforma de inversión");
  expectRepair("Trade ETFs", "Opera con ETFs europeos", "Opera con ETF europeos");
  expectRepair("commission-free ETPs", "ETPs sin comisiones de MEXEM", "ETP sin comisiones de MEXEM");
  {
    // "negociar" verb is NOT blind-repaired (needs a preposition) — left to warn.
    const r = repairSpanishTrading("Cómo negociar acciones", { sourceText: "How to trade stocks" });
    assert(r.repairs.length === 0, "negociar verb is not auto-repaired (left as warning)");
    // genuine negotiation source → no repair.
    const g = repairSpanishTrading("plataforma de negociación", { sourceText: "negotiation platform" });
    assert(g.repairs.length === 0, "genuine-negotiation source is not repaired");
  }

  // ── C. Gate scoping/modes ───────────────────────────────────────────────────
  section("F. runtime gate: scoping + modes");
  const saved = qualityGateConfig.spTradingGateMode;
  try {
    qualityGateConfig.spTradingGateMode = "repair";
    const es = applySpanishTradingGate("Online trading", "Negociación en Línea", "es-ES");
    assert(es.text === "Trading en Línea" && es.repairs.length === 1, "[repair] es-ES auto-repaired");
    const fr = applySpanishTradingGate("Online trading", "Négociation en ligne", "fr-FR");
    assert(fr.text === "Négociation en ligne" && fr.repairs.length === 0, "[repair] non-ES locale untouched");
    qualityGateConfig.spTradingGateMode = "warn";
    const w = applySpanishTradingGate("Online trading", "Negociación en línea", "es-ES");
    assert(w.text === "Negociación en línea" && w.repairs.length === 0 && w.warnings.length > 0, "[warn] never mutates, warns");
    qualityGateConfig.spTradingGateMode = "off";
    const off = applySpanishTradingGate("Online trading", "Negociación en línea", "es-ES");
    assert(off.text === "Negociación en línea" && off.warnings.length === 0, "[off] no-op");
  } finally {
    qualityGateConfig.spTradingGateMode = saved;
  }

  // ── D. Style-guide content ──────────────────────────────────────────────────
  section("G. style-guide content (es-ES)");
  const es = getLocaleStyleGuide("es-ES");
  assert(/informal "t[úu]"/i.test(es), "[es-ES] informal tú register");
  assert(/operar/i.test(es) && /NEVER "negociaci[oó]n"/i.test(es), "[es-ES] operar/trading, never negociación");
  assert(/"br[oó]ker"/i.test(es), "[es-ES] broker → bróker");
  assert(/invariant/i.test(es), "[es-ES] ETF/ETP invariant");
  assert(/comisiones/i.test(es) && /tarifas/i.test(es), "[es-ES] comisiones not tarifas");
  assert(/inteligencia artificial/i.test(es), "[es-ES] AI → inteligencia artificial");

  // ── E. DB rule channels ─────────────────────────────────────────────────────
  section("H. DB rule channels (skipped if DB unreachable)");
  if (!(await dbReachable())) {
    console.log("  ⚠ SKIP: database not reachable — run the seed scripts + a DB to verify these.");
  } else {
    await assertGlossary("trading platform", "plataforma de inversión");
    await assertForbidden("negociación en línea");
    await assertForbidden("plataforma de negociación");
    await assertForbidden("negociación transparente");
  }

  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("Failures:"); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((err) => { console.error("Test run failed:", err); process.exit(1); }).finally(() => prisma.$disconnect());
