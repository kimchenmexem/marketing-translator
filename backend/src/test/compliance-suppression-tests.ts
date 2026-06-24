/**
 * Compliance LLM false-positive suppression — regression test.
 *
 * Built from a real over-flagging case (June 2026): a fully compliant MEXEM
 * article that carries the required risk disclaimer + "not advice" disclaimer +
 * CySEC licence, yet the LLM reviewers flagged 6 concerns — every one of them
 * flagging the disclaimer language itself, or a "missing disclosure" category
 * on text that does disclose.
 *
 * Pure — no DB, no LLM. Run: npm --workspace backend run test:compliance-suppression
 */
import { suppressLlmFinding } from "../services/complianceCheck";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.error(`  ✖ FAIL: ${name}`); }
}

// The compliant article (disclaimer sentences are what matters here).
const ARTICLE = `Where MEXEM Stands Today. MEXEM remains regulated by CySEC and keeps fees competitive.
Risk disclaimer: All investments involve risk, including the possible loss of capital. The information in
this article is for educational and informational purposes only and does not constitute investment advice.
MEXEM Ltd is regulated by the Cyprus Securities and Exchange Commission (CySEC), licence number 325/17.`;

console.log("\n═══ The 6 findings from the real case must ALL be suppressed ═══");
assert(suppressLlmFinding("no_guarantees", undefined, ARTICLE), "1. no_guarantees (no quote) on disclosing text → suppressed");
assert(suppressLlmFinding("risk_balance", "including the possible loss of capital", ARTICLE), "2. risk_balance quoting the disclaimer → suppressed");
assert(suppressLlmFinding("no_guarantees", "risk, including the possible loss", ARTICLE), "3. no_guarantees quoting the disclaimer → suppressed");
assert(suppressLlmFinding("risk_balance", "investments involve risk", ARTICLE), "4. risk_balance quoting 'investments involve risk' → suppressed");
assert(suppressLlmFinding("past_performance", undefined, ARTICLE), "5. past_performance (no quote) on disclosing text → suppressed");
assert(suppressLlmFinding("no_financial_advice", "does not constitute investment advice", ARTICLE), "6. no_financial_advice quoting the not-advice disclaimer → suppressed");

// A no_guarantees finding whose quote has NO guarantee language is a misfire
// when the text discloses risk (the "fully paid shares to work" case).
assert(suppressLlmFinding("no_guarantees", "fully paid shares to work", ARTICLE), "7. no_guarantees quoting a benign phrase (no guarantee language) → suppressed");

console.log("\n═══ Real violations must NOT be suppressed ═══");
const PROMO = "Earn guaranteed 20% returns with MEXEM. Profits assured every month!";
assert(!suppressLlmFinding("no_guarantees", "guaranteed 20% returns", PROMO), "guarantee claim (no disclaimer) → kept");
assert(!suppressLlmFinding("risk_balance", "guaranteed 20% returns", PROMO), "benefits w/o any risk disclosure → kept");
assert(!suppressLlmFinding("no_financial_advice", "you should buy MEXEM shares now", "Buy MEXEM shares now — our top pick!"), "advice w/o a not-advice disclaimer → kept");
// Greek: a not-advice finding on text carrying the Greek not-advice disclaimer → suppressed.
const EL_ARTICLE = "Επενδύστε σε ευρωπαϊκές μετοχές με τη MEXEM. Το κεφάλαιό σας διατρέχει κίνδυνο. Δεν αποτελεί επενδυτική συμβουλή.";
assert(suppressLlmFinding("no_financial_advice", "Επενδύστε σε μετοχές", EL_ARTICLE), "EL not-advice disclaimer present → suppressed");
assert(!suppressLlmFinding("no_financial_advice", "αγοράστε μετοχές Tesla", "Πρέπει να αγοράσετε μετοχές της Tesla τώρα."), "EL advice w/o not-advice disclaimer → kept");
// A guarantee claim is NOT excused merely because a risk disclaimer also appears.
assert(
  !suppressLlmFinding("no_guarantees", "guaranteed returns", "Guaranteed returns! (Capital at risk.)"),
  "quoted guarantee claim is kept even when a disclaimer is also present",
);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log("Failures:"); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
