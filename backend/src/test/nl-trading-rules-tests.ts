/**
 * Dutch (nl-NL / nl-BE) trading-terminology rules — regression tests.
 * From the May-2026 nl-NL human eval. Layers: linter, auto-repair, gate
 * scoping/modes, style-guide content, DB rule channels (skipped if no DB).
 *
 * Run:
 *   npm --workspace backend run seed:nl-trading-forbidden
 *   npm --workspace backend run test:nl-trading-rules
 */
import { prisma } from "../db";
import { getLocaleStyleGuide } from "../services/ai";
import { lintDutchTrading, repairDutchTrading } from "../services/dutchTradingLint";
import { applyDutchTradingGate } from "../services/dutchTradingGate";
import { qualityGateConfig } from "../services/qualityGateConfig";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.error(`  ✖ FAIL: ${name}`); }
}
function section(n: string) { console.log(`\n═══ ${n} ═══`); }

function expectFlagged(rule: string, source: string, bad: string) {
  const f = lintDutchTrading(bad, { sourceText: source });
  assert(f.some((x) => x.rule === rule), `flags ${rule}: "${bad.slice(0, 48)}…"  (got: ${f.map((x) => x.rule).join(",") || "none"})`);
}
function expectClean(source: string, good: string) {
  const f = lintDutchTrading(good, { sourceText: source });
  assert(f.length === 0, `clean: "${good.slice(0, 48)}…"  (got: ${f.map((x) => x.rule).join(",") || "none"})`);
}
function expectRepair(source: string, bad: string, expected: string) {
  const { text } = repairDutchTrading(bad, { sourceText: source });
  assert(text === expected, `repair: "${bad}" → "${text}" (expected "${expected}")`);
}
async function dbReachable(): Promise<boolean> {
  try { await prisma.$queryRaw`SELECT 1`; return true; } catch { return false; }
}
async function assertGlossary(source: string, expected: string) {
  const row = await prisma.glossaryTerm.findFirst({ where: { localeCode: "nl-NL", sourceTerm: source }, select: { targetTerm: true } });
  assert(row !== null && row.targetTerm === expected, `[nl-NL] Glossary: ${source} → ${expected} (got: ${row?.targetTerm ?? "missing"})`);
}
async function assertForbidden(locale: string, phrase: string) {
  const row = await prisma.forbiddenPhrase.findUnique({ where: { localeCode_phrase: { localeCode: locale, phrase } }, select: { active: true } });
  assert(row !== null && row.active === true, `[${locale}] Forbidden (active): "${phrase}"`);
}

async function main() {
  section("A. broker, not makelaar; handelsplatform dated");
  expectFlagged("broker-not-makelaar", "Low-cost stock trading broker", "Goedkope aandelenhandelsmakelaar");
  expectClean("EU Broker", "Europese broker");
  expectFlagged("tradingplatform-not-handelsplatform", "best trading platforms", "Een van de beste handelsplatformen");
  expectClean("best trading platforms", "Een van de beste tradingplatformen");

  section("B. voordelig not goedkoop; tegen lage kosten; AI-ondersteund");
  expectFlagged("voordelig-not-goedkoop", "Cheapest broker for EU stocks", "Goedkoopste broker voor Europese aandelen");
  expectClean("Cheapest broker for EU stocks", "Voordeligste broker voor Europese aandelen");
  expectFlagged("tegen-lage-kosten", "Expand portfolio with low fees", "Breid uw portefeuille uit met lage kosten");
  expectClean("Expand portfolio with low fees", "Breid uw portefeuille uit tegen lage kosten");
  expectFlagged("ai-ondersteund", "AI-Powered Investing", "AI-gestuurd beleggen");
  expectClean("AI-Powered Investing", "AI-ondersteund beleggen");

  section("C. refusal");
  expectFlagged("refusal", "Then you should know this.", "Het spijt me, ik kan u niet helpen.");
  expectClean("Then you should know this.", "Dan moet u dit weten.");

  section("D. auto-repair (safe swaps)");
  expectRepair("Expand portfolio with low fees", "Breid uw portefeuille uit met lage kosten", "Breid uw portefeuille uit tegen lage kosten");
  expectRepair("AI-Powered Investing", "AI-gestuurd beleggen", "AI-ondersteund beleggen");
  expectRepair("Cheapest broker for EU stocks", "Goedkoopste broker voor Europese aandelen", "Voordeligste broker voor Europese aandelen");
  {
    // makelaar is warned, not blind-repaired (compound risk).
    const r = repairDutchTrading("Goedkope aandelenhandelsmakelaar", { sourceText: "Low-cost broker" });
    assert(!r.repairs.some((x) => /makelaar/.test(x.before)), "makelaar not auto-repaired (left as warning)");
    // "goedkoop" untouched when the source isn't a cheap/affordable claim.
    const g = repairDutchTrading("Een goedkope oplossing", { sourceText: "A simple solution" });
    assert(g.repairs.length === 0, "goedkoop left alone when source has no cheap/affordable signal");
  }

  section("E. runtime gate: scoping + modes");
  const saved = qualityGateConfig.nlTradingGateMode;
  try {
    qualityGateConfig.nlTradingGateMode = "repair";
    const nl = applyDutchTradingGate("with low fees", "Beleg met lage kosten", "nl-NL");
    assert(nl.text === "Beleg tegen lage kosten" && nl.repairs.length === 1, "[repair] nl-NL auto-repaired");
    const fr = applyDutchTradingGate("with low fees", "avec des frais", "fr-FR");
    assert(fr.text === "avec des frais" && fr.repairs.length === 0, "[repair] non-NL locale untouched");
    qualityGateConfig.nlTradingGateMode = "warn";
    const w = applyDutchTradingGate("Low-cost broker", "Goedkope makelaar", "nl-NL");
    assert(w.text === "Goedkope makelaar" && w.repairs.length === 0 && w.warnings.length > 0, "[warn] never mutates, warns");
    qualityGateConfig.nlTradingGateMode = "off";
    const off = applyDutchTradingGate("Low-cost broker", "Goedkope makelaar", "nl-NL");
    assert(off.text === "Goedkope makelaar" && off.warnings.length === 0, "[off] no-op");
  } finally {
    qualityGateConfig.nlTradingGateMode = saved;
  }

  section("F. style-guide content (nl-NL / nl-BE)");
  const nl = getLocaleStyleGuide("nl-NL");
  assert(/NEVER "makelaar"/i.test(nl), "[nl-NL] broker not makelaar");
  assert(/tradingplatform/i.test(nl), "[nl-NL] tradingplatform over handelsplatform");
  assert(/voordelig/i.test(nl) && /goedkoop/i.test(nl), "[nl-NL] voordelig not goedkoop");
  assert(/tegen lage kosten/i.test(nl), "[nl-NL] tegen lage kosten");
  assert(/AI-ondersteund/i.test(nl), "[nl-NL] AI-ondersteund");
  assert(/Wij banen de weg naar transparante, voordelige handel/.test(nl), "[nl-NL] 05.26 Pioneering wording");
  const nlBe = getLocaleStyleGuide("nl-BE");
  assert(/makelaar/i.test(nlBe) && /broker/i.test(nlBe), "[nl-BE] inherits broker/makelaar rule");

  section("G. DB rule channels (skipped if DB unreachable)");
  if (!(await dbReachable())) {
    console.log("  ⚠ SKIP: database not reachable.");
  } else {
    await assertGlossary("trading platform", "tradingplatform");
    await assertForbidden("nl-NL", "aandelenhandelsmakelaar");
    await assertForbidden("nl-BE", "aandelenhandelsmakelaar");
  }

  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("Failures:"); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((err) => { console.error("Test run failed:", err); process.exit(1); }).finally(() => prisma.$disconnect());
