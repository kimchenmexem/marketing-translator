/**
 * Live RESULTS-QUALITY check — translate one source into every locale through
 * the production pipeline, then assert each OUTPUT meets concrete brand /
 * compliance rules (not just "is it the right language"):
 *   • translated (non-empty; differs from the English source for non-en)
 *   • carries a risk disclaimer (source says "Your capital is at risk")
 *   • ETF/ETP invariant — no plural "ETFs"/"ETPs"
 *   • the deterministic locale linter is clean (fr / es / nl / el)
 *   • not a refusal / meta reply
 *
 * Run: npm --workspace backend run verify:translation-quality
 */
import { runTranslationJob } from "../services/ai";
import { lintFrenchTrading } from "../services/frenchTradingLint";
import { lintSpanishTrading } from "../services/spanishTradingLint";
import { lintDutchTrading } from "../services/dutchTradingLint";
import { lintGreekTrading } from "../services/greekTradingLint";
import { hasAnyDisclaimer } from "../compliance/engine/executor";
import type { LocaleCode, LengthConstraint } from "@mexem/shared";
import { prisma } from "../db";

const SOURCE = "Open a free account and trade European stocks and ETFs from €1 with MEXEM. Your capital is at risk.";
const LOCALES: LocaleCode[] = ["it-IT", "fr-FR", "fr-BE", "nl-NL", "nl-BE", "es-ES", "en-GB", "el-GR"];
const REFUSAL = /\b(i'?m sorry|i cannot|as an ai|je suis (là|desolé)|lo siento|het spijt me|mi dispiace|λυπάμαι)\b/i;

function localeLint(locale: LocaleCode, out: string): string[] {
  if (locale === "fr-FR" || locale === "fr-BE") return lintFrenchTrading(out, { sourceText: SOURCE }).map(f => f.rule);
  if (locale === "es-ES") return lintSpanishTrading(out, { sourceText: SOURCE }).map(f => f.rule);
  if (locale === "nl-NL" || locale === "nl-BE") return lintDutchTrading(out, { sourceText: SOURCE }).map(f => f.rule);
  if (locale === "el-GR") return lintGreekTrading(out, { sourceText: SOURCE }).map(f => f.rule);
  return [];
}

async function check(locale: LocaleCode) {
  const r = await runTranslationJob({
    sourceText: SOURCE, sourceLanguage: "English", targetLocale: locale,
    textType: "ad", persona: "potential_investors", tone: "persuasive",
    lengthConstraint: { mode: "max", maxChars: 2000 } as LengthConstraint, outputCount: 1,
  });
  const out = (r[0]?.outputText ?? "").trim();
  const fails: string[] = [];
  if (!out) fails.push("empty");
  if (locale !== "en-GB" && out.toLowerCase() === SOURCE.toLowerCase()) fails.push("untranslated");
  if (!hasAnyDisclaimer(out)) fails.push("no risk disclaimer");
  // ETF/ETP are invariant in the EU target languages, but English legitimately
  // pluralises ("ETFs"), so this brand rule does not apply to en-GB.
  if (locale !== "en-GB" && /\bET[FP]s\b/.test(out)) fails.push("ETF/ETP pluralised");
  if (REFUSAL.test(out)) fails.push("refusal/meta");
  const lint = localeLint(locale, out);
  if (lint.length) fails.push("lint:" + lint.join(","));
  return { locale, out, fails };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k]); }
  }));
  return res;
}

(async () => {
  console.log(`Results-quality check across ${LOCALES.length} locales…\n`);
  const results = await pool(LOCALES, 4, check);
  let pass = 0;
  for (const r of results) {
    const ok = r.fails.length === 0;
    if (ok) pass++;
    console.log(`${ok ? "✓" : "✖"} ${r.locale.padEnd(6)} ${ok ? "all checks pass" : "FAIL → " + r.fails.join("; ")}`);
    console.log(`     ${r.out.slice(0, 110)}${r.out.length > 110 ? "…" : ""}`);
  }
  console.log(`\n${pass}/${results.length} locales passed every results-quality check.`);
  await prisma.$disconnect();
  if (pass !== results.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
