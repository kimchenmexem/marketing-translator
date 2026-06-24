/**
 * Live cross-locale verification — translate one source into EVERY supported
 * locale through the real production pipeline (runTranslationJob, incl. the
 * per-language quality gates) and check each output is non-empty and looks
 * like the target language.
 *
 * Run: NODE_OPTIONS="-r dotenv/config" npx ts-node --transpile-only src/scripts/verify-all-locales.ts
 */
import { runTranslationJob } from "../services/ai";
import type { LocaleCode, LengthConstraint } from "@mexem/shared";
import { prisma } from "../db";

const SOURCE = "Open a free account and trade European stocks and ETFs from €1 with MEXEM. Your capital is at risk.";

// Per-locale acceptance: at least one expected marker word (case-insensitive),
// or Greek script for el-GR. Heuristic but catches "wrong language" output.
const CHECK: Record<LocaleCode, { markers?: RegExp; script?: RegExp; note: string }> = {
  "it-IT": { markers: /\b(azioni|gratuito|conto|rischio)\b/i, note: "Italian" },
  "fr-FR": { markers: /\b(actions|gratuit|compte|risque)\b/i, note: "French (FR)" },
  "fr-BE": { markers: /\b(actions|gratuit|compte|risque)\b/i, note: "French (BE)" },
  "nl-NL": { markers: /\b(aandelen|gratis|rekening|risico)\b/i, note: "Dutch (NL)" },
  "nl-BE": { markers: /\b(aandelen|gratis|rekening|risico)\b/i, note: "Dutch (BE)" },
  "es-ES": { markers: /\b(acciones|gratis|gratuita|cuenta|riesgo)\b/i, note: "Spanish" },
  "en-GB": { markers: /\b(account|stocks|capital|risk)\b/i, note: "English (UK)" },
  "el-GR": { script: /[Ͱ-Ͽ]/, note: "Greek" },
  "de-DE": { markers: /\b(Aktien|kostenlos|Konto|Risiko|gebührenfrei|provisionsfrei)\b/i, note: "German" },
};

const LOCALES = Object.keys(CHECK) as LocaleCode[];

async function one(locale: LocaleCode): Promise<{ locale: string; ok: boolean; out: string; why: string }> {
  try {
    const r = await runTranslationJob({
      sourceText: SOURCE, sourceLanguage: "English", targetLocale: locale,
      textType: "ad", persona: "potential_investors", tone: "persuasive",
      lengthConstraint: { mode: "max", maxChars: 2000 } as LengthConstraint, outputCount: 1,
    });
    const out = (r[0]?.outputText ?? "").trim();
    const c = CHECK[locale];
    let ok = out.length > 0;
    let why = "";
    if (!ok) why = "empty output";
    else if (c.script) { ok = c.script.test(out); why = ok ? "Greek script ✓" : "no Greek script"; }
    else if (c.markers) { ok = c.markers.test(out); why = ok ? "marker word ✓" : "no expected marker"; }
    if (locale !== "en-GB" && out.toLowerCase() === SOURCE.toLowerCase()) { ok = false; why = "untranslated (== source)"; }
    return { locale, ok, out, why };
  } catch (e: any) {
    return { locale, ok: false, out: "", why: "ERROR: " + (e?.message ?? e) };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k]); }
  }));
  return res;
}

(async () => {
  console.log(`Translating one source → ${LOCALES.length} locales (production path)…\n`);
  const results = await pool(LOCALES, 4, one);
  let pass = 0;
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✖"} ${r.locale.padEnd(6)} [${CHECK[r.locale as LocaleCode].note.padEnd(12)}] ${r.why}`);
    console.log(`     ${r.out.slice(0, 110)}${r.out.length > 110 ? "…" : ""}`);
    if (r.ok) pass++;
  }
  console.log(`\n${pass}/${results.length} locales produced valid target-language output.`);
  await prisma.$disconnect();
  if (pass !== results.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
