/**
 * Compliance bundle executor — regression tests for the banned-phrase
 * matching fix (May-2026): whole-phrase, Unicode-aware boundaries instead of a
 * naive substring `includes`, so short banned phrases no longer false-positive
 * inside larger words.
 *
 * Pure — no DB, no LLM. Run: npm --workspace backend run test:compliance-executor
 */
import { executeBundleRules, matchWholePhrase, hasAnyDisclaimer } from "../compliance/engine/executor";
import type { LoadedBundle } from "../compliance/bundles/loader";
import type { RuleBundleContent } from "@mexem/shared";

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(c: boolean, name: string) {
  if (c) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.error(`  ✖ FAIL: ${name}`); }
}

function bundle(bannedPhrases: string[], extra: Partial<RuleBundleContent> = {}): LoadedBundle {
  const content: RuleBundleContent = {
    bannedPhrases,
    regexRules: [],
    requiredDisclaimers: [],
    promptContext: "",
    disclaimers: { riskWarning: "", pastPerformance: "" },
    ...extra,
  };
  return {
    id: 1, localeCode: "en-GB", jurisdiction: "GB", version: "test",
    content, contentHash: "x", sourceRefs: [], publishedAt: new Date(0).toISOString(),
  };
}

function bannedHits(text: string, phrases: string[]): string[] {
  return executeBundleRules(text, bundle(phrases)).matches
    .filter((m) => m.ruleType === "banned_phrase")
    .map((m) => m.evidence ?? "");
}

// ─── matchWholePhrase ────────────────────────────────────────────────
console.log("\n═══ matchWholePhrase: word boundaries ═══");
assert(matchWholePhrase("Open a window today", "win") === null, '"win" does NOT match inside "window"');
assert(matchWholePhrase("You can win now", "win") === "win", '"win" matches as a whole word');
assert(matchWholePhrase("ensure your measure", "sure") === null, '"sure" does NOT match inside "ensure"/"measure"');
assert(matchWholePhrase("Be sure of it", "sure") === "sure", '"sure" matches standalone');
// Accented / non-ASCII edges (the \b metachar fails here; \p{L} must be used).
assert(matchWholePhrase("le rendement annuel", "rendement") === "rendement", "accented-context whole word matches");
assert(matchWholePhrase("surrendement total", "rendement") === null, '"rendement" does NOT match inside "surrendement"');
assert(matchWholePhrase("garantie de capital", "garantie") === "garantie", "accented word 'garantie' matches");
// Case-insensitive, evidence preserves source casing.
assert(matchWholePhrase("GUARANTEED returns", "guaranteed") === "GUARANTEED", "case-insensitive; evidence keeps source case");
// Multi-word phrase.
assert(matchWholePhrase("offers a risk free profit", "risk free") === "risk free", "multi-word phrase matches");
// Phrase beginning with punctuation still matches (boundary only vs alphanumerics).
assert(matchWholePhrase("price is €0 today", "€0") === "€0", "punctuation-leading phrase still matches");

// ─── executeBundleRules: banned-phrase findings ──────────────────────
console.log("\n═══ executeBundleRules: banned phrases ═══");
assert(bannedHits("Open a window", ["win"]).length === 0, "no false-positive banned hit for 'win' in 'window'");
assert(bannedHits("You win", ["win"]).length === 1, "real banned hit for standalone 'win'");
{
  const r = executeBundleRules("Open a window", bundle(["win"]));
  assert(r.passed === true, "bundle passes when only a substring would have matched");
}
{
  const r = executeBundleRules("guaranteed profit", bundle(["guaranteed"]));
  assert(r.passed === false && r.matches[0]?.severity === "critical", "real banned phrase still flagged critical");
}

// ─── Required disclaimers: "any disclaimer satisfies" ────────────────
console.log("\n═══ executeBundleRules: required disclaimers (any disclaimer satisfies) ═══");
function discBundle(): LoadedBundle {
  return bundle([], {
    requiredDisclaimers: [{
      text: "Investing involves risk of loss. Past performance is not indicative of future results.",
      triggers: ["invest", "returns"],
    }],
  });
}
function disclaimerMissing(text: string): boolean {
  return executeBundleRules(text, discBundle()).matches.some((m) => m.ruleType === "required_disclaimer");
}
// Trigger present, NO disclaimer at all → flagged missing.
assert(disclaimerMissing("Invest now for great returns!") === true, "trigger + no disclaimer → flagged missing");
// Trigger present + the EXACT bundle disclaimer → not flagged.
assert(
  disclaimerMissing("Invest now. Investing involves risk of loss. Past performance is not indicative of future results.") === false,
  "exact canonical disclaimer → not flagged",
);
// Trigger present + a DIFFERENTLY-WORDED disclaimer → not flagged (the key fix).
assert(
  disclaimerMissing("Invest now. Your capital is at risk and you may lose money.") === false,
  "reworded risk disclaimer → not flagged",
);
// Trigger present + a translated disclaimer (FR) → not flagged.
assert(
  disclaimerMissing("Investissez. Investir comporte un risque de perte en capital.") === false,
  "translated (FR) disclaimer → not flagged",
);
// No trigger → never flagged regardless.
assert(disclaimerMissing("A neutral sentence about the platform.") === false, "no trigger → not flagged");

// ─── Whole-sentence context + exact reason ───────────────────────────
console.log("\n═══ context = full sentence + precise message ═══");
{
  const text = "Open an account today. You will win guaranteed profits. Trade now.";
  const r = executeBundleRules(text, bundle(["guaranteed profits"]));
  const m = r.matches.find((x) => x.ruleType === "banned_phrase");
  assert(m?.context === "You will win guaranteed profits.", `context is the full sentence (got: "${m?.context}")`);
  assert(m?.evidence === "guaranteed profits", "evidence is the exact fragment");
  assert(!!m && m.message.includes('"guaranteed profits"') && m.message.includes("You will win guaranteed profits."),
    "message names the exact phrase AND the sentence");
}
{
  // Required-disclaimer reason names the exact trigger + its sentence.
  const b = bundle([], { requiredDisclaimers: [{ text: "Capital at risk.", triggers: ["profit"] }] });
  const r = executeBundleRules("Make a profit fast. Sign up here.", b);
  const m = r.matches.find((x) => x.ruleType === "required_disclaimer");
  assert(!!m && m.message.includes('"profit"') && m.message.includes("Make a profit fast."),
    `disclaimer reason names trigger + sentence (got: "${m?.message}")`);
}

console.log("\n═══ hasAnyDisclaimer (multilingual) ═══");
assert(hasAnyDisclaimer("your capital is at risk") === true, "EN risk marker");
assert(hasAnyDisclaimer("risque de perte") === true, "FR risk/loss marker");
assert(hasAnyDisclaimer("uw kapitaal loopt risico") === true, "NL risk marker");
assert(hasAnyDisclaimer("riesgo de pérdida de capital") === true, "ES risk marker");
assert(hasAnyDisclaimer("Investments may lose value") === true, "EN 'may lose value' is a risk disclosure");
assert(hasAnyDisclaimer("vous pouvez perdre votre capital") === true, "FR 'perdre' marker");
assert(hasAnyDisclaimer("Το κεφάλαιό σας διατρέχει κίνδυνο") === true, "EL risk marker (κίνδυνο)");
assert(hasAnyDisclaimer("Ihr Kapital ist Risiken ausgesetzt") === true, "DE risk marker (Risiken)");
assert(hasAnyDisclaimer("Anlagen können zu Verlusten führen") === true, "DE loss marker (Verluste)");
assert(hasAnyDisclaimer("Ihr Kapital ist gefährdet.") === true, "DE risk marker (gefährdet)");
assert(hasAnyDisclaimer("Handeln Sie jetzt mit Aktien") === false, "DE non-disclaimer → false");
assert(hasAnyDisclaimer("κίνδυνος απώλειας κεφαλαίου") === true, "EL loss marker (απώλεια)");
assert(hasAnyDisclaimer("Κάντε trading σε μετοχές τώρα") === false, "EL non-disclaimer → false");
assert(hasAnyDisclaimer("Acquista azioni adesso") === false, "no disclaimer language → false");

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log("Failures:"); for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
