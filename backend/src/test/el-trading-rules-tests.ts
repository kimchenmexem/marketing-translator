/**
 * Greek (el-GR) trading-terminology rules — regression tests.
 *
 * Derived from the confident, objective el-GR refinements (grammar/orthography
 * + cross-locale consistency). Layers:
 *   A. Linter behaviour (pure).
 *   B. Auto-repair (pure) — safe collocations only (ETF/ETP invariant).
 *   C. Gate scoping/modes (pure).
 *   D. Style-guide content (pure).
 *
 * Run:
 *   npm --workspace backend run test:el-trading-rules
 */
import { prisma } from "../db";
import { getLocaleStyleGuide } from "../services/ai";
import { lintGreekTrading, repairGreekTrading } from "../services/greekTradingLint";
import { applyGreekTradingGate } from "../services/greekTradingGate";
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
  const f = lintGreekTrading(badOutput, { sourceText: source });
  assert(f.some((x) => x.rule === rule), `flags ${rule}: "${badOutput.slice(0, 48)}…"  (got: ${f.map((x) => x.rule).join(",") || "none"})`);
}
function expectClean(source: string, goodOutput: string) {
  const f = lintGreekTrading(goodOutput, { sourceText: source });
  assert(f.length === 0, `clean: "${goodOutput.slice(0, 48)}…"  (got: ${f.map((x) => x.rule).join(",") || "none"})`);
}
function expectRepair(source: string, bad: string, expected: string) {
  const { text } = repairGreekTrading(bad, { sourceText: source });
  assert(text === expected, `repair: "${bad}" → "${text}" (expected "${expected}")`);
}

async function main() {
  // ── A. Linter regression ──────────────────────────────────────────────────
  section("A. ETF / ETP invariant (no plural)");
  expectFlagged("etf-etp-invariant", "Trade ETFs", "Κάντε trading σε ETFs από 1 €");
  expectClean("Trade ETFs", "Κάντε trading σε ETF από 1 €");
  expectFlagged("etf-etp-invariant", "commission-free ETPs", "ETPs χωρίς προμήθειες");

  section("B. EU spelled out (not 'ΕΕ')");
  expectFlagged("eu-spelled-out", "Trade EU stocks", "Κάντε trading σε μετοχές της ΕΕ");
  expectClean("Trade EU stocks", "Κάντε trading σε ευρωπαϊκές μετοχές");

  section("C. 'trading' takes preposition 'σε'");
  expectFlagged("trading-preposition", "Trade stocks", "Κάντε trading μετοχές");
  expectClean("Trade stocks", "Κάντε trading σε μετοχές");

  section("D. refusal");
  expectFlagged("refusal", "Then you should know this.", "Λυπάμαι, δεν μπορώ να βοηθήσω με αυτό.");
  expectClean("Then you should know this.", "Τότε πρέπει να το γνωρίζετε αυτό.");

  // ── B. Auto-repair ─────────────────────────────────────────────────────────
  section("E. auto-repair (ETF/ETP invariant only)");
  expectRepair("Trade ETFs", "Κάντε trading σε ETFs από 1 €", "Κάντε trading σε ETF από 1 €");
  expectRepair("commission-free ETPs", "ETPs χωρίς προμήθειες", "ETP χωρίς προμήθειες");
  {
    // ΕΕ → ευρωπαϊκές is NOT blind-repaired (Greek adjective agreement) — left to warn.
    const r = repairGreekTrading("Κάντε trading σε μετοχές της ΕΕ", { sourceText: "Trade EU stocks" });
    assert(r.repairs.length === 0, "ΕΕ → ευρωπαϊκές is not auto-repaired (left as warning)");
    // missing-preposition is NOT blind-repaired either.
    const p = repairGreekTrading("Κάντε trading μετοχές", { sourceText: "Trade stocks" });
    assert(p.repairs.length === 0, "missing preposition is not auto-repaired (left as warning)");
  }

  // ── C. Gate scoping/modes ───────────────────────────────────────────────────
  section("F. runtime gate: scoping + modes");
  const saved = qualityGateConfig.grTradingGateMode;
  try {
    qualityGateConfig.grTradingGateMode = "repair";
    const el = applyGreekTradingGate("Trade ETFs", "Κάντε trading σε ETFs", "el-GR");
    assert(el.text === "Κάντε trading σε ETF" && el.repairs.length === 1, "[repair] el-GR auto-repaired ETFs→ETF");
    const es = applyGreekTradingGate("Trade ETFs", "Opera con ETFs europeos", "es-ES");
    assert(es.text === "Opera con ETFs europeos" && es.repairs.length === 0, "[repair] non-EL locale untouched");
    qualityGateConfig.grTradingGateMode = "warn";
    const w = applyGreekTradingGate("Trade ETFs", "Κάντε trading σε ETFs", "el-GR");
    assert(w.text === "Κάντε trading σε ETFs" && w.repairs.length === 0 && w.warnings.length > 0, "[warn] never mutates, warns");
    qualityGateConfig.grTradingGateMode = "off";
    const off = applyGreekTradingGate("Trade ETFs", "Κάντε trading σε ETFs", "el-GR");
    assert(off.text === "Κάντε trading σε ETFs" && off.warnings.length === 0, "[off] no-op");
  } finally {
    qualityGateConfig.grTradingGateMode = saved;
  }

  // ── D. Style-guide content ──────────────────────────────────────────────────
  section("G. style-guide content (el-GR)");
  const el = getLocaleStyleGuide("el-GR");
  assert(/ETF/i.test(el) && /invariant/i.test(el), "[el-GR] ETF/ETP invariant documented");
  assert(/ευρωπαϊκές/i.test(el), "[el-GR] spell out ευρωπαϊκές (not ΕΕ)");
  assert(/σε μετοχές/i.test(el), "[el-GR] trading σε μετοχές preposition");
  assert(/κεφάλαιό/i.test(el), "[el-GR] enclitic double-accent κεφάλαιό σας");

  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("Failures:"); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
}

main().catch((err) => { console.error("Test run failed:", err); process.exit(1); }).finally(() => prisma.$disconnect());
