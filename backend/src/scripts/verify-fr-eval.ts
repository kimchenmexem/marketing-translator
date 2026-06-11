/**
 * Verification harness (not a unit test): runs every source text from the
 * May-2026 French human eval through the REAL production translation path
 * (runTranslationJob → quality gate → French trading gate) for fr-FR, then
 * lints each output and shows it next to the reviewer-approved target.
 *
 * Run:
 *   QG_ENABLED=false NODE_OPTIONS="-r dotenv/config" \
 *     npx ts-node --transpile-only src/scripts/verify-fr-eval.ts
 *
 * QG_ENABLED=false keeps it to one LLM call per text; the deterministic FR
 * trading gate runs regardless, so the négociation→trading / le-trading
 * enforcement is fully exercised.
 */
import { runTranslationJob } from "../services/ai";
import { lintFrenchTrading } from "../services/frenchTradingLint";
import { lintSpanishTrading } from "../services/spanishTradingLint";
import { lintDutchTrading } from "../services/dutchTradingLint";
import { prisma } from "../db";
import type { LengthConstraint, LocaleCode } from "@mexem/shared";

/** Target locale — fr-FR (default) | fr-BE | es-ES | nl-NL | nl-BE. Set via TARGET_LOCALE env. */
const TARGET_LOCALE = (process.env.TARGET_LOCALE ?? "fr-FR") as LocaleCode;

/** Lint with the locale-appropriate linter. */
function lint(output: string, sourceText: string): Array<{ rule: string; message: string; excerpt: string }> {
  if (TARGET_LOCALE === "es-ES") return lintSpanishTrading(output, { sourceText });
  if (TARGET_LOCALE === "nl-NL" || TARGET_LOCALE === "nl-BE") return lintDutchTrading(output, { sourceText });
  return lintFrenchTrading(output, { sourceText });
}

interface Row {
  src: string;
  /** Reviewer-approved target (empty = original output was already acceptable). */
  want?: string;
}

const ROWS: Row[] = [
  { src: "Stock Market", want: "La Bourse" },
  { src: "Online Trading", want: "Trading en ligne" },
  { src: "Investment platform" },
  { src: "Invest Online" },
  { src: "Stock Trading", want: "Trading d'actions" },
  { src: "Buy Stocks", want: "Achetez des actions" },
  { src: "Invest in Stocks", want: "Investir en Bourse" },
  { src: "EU Broker", want: "Courtier européen" },
  { src: "Low cost european broker" },
  { src: "Low-cost stock trading broker", want: "Courtier en bourse à faible coût" },
  { src: "Cheapest broker for EU stocks", want: "Courtier le moins cher pour les actions européennes" },
  { src: "Affordable trading platforms in Europe", want: "Plateformes de trading abordables en Europe" },
  { src: "Affordable online trading", want: "Trading en ligne abordable" },
  { src: "One of the Best trading broker with low fees", want: "L'un des meilleurs courtiers en trading avec des frais réduits" },
  { src: "One of the Best trading platforms for EU investors", want: "L'une des meilleures plateformes de trading pour les investisseurs européens" },
  { src: "One of the Best brokers for ETFs in Europe" },
  { src: "One of the Best broker for international stocks" },
  { src: "Flat-fee trading broker", want: "Courtier de trading à frais fixes" },
  { src: "Cheapest alternative to Interactive Brokers", want: "Alternative la moins chère à Interactive Brokers" },
  { src: "One of the Best platform to trade ETFs in Europe", want: "L'une des meilleures plateformes pour trader des ETF en Europe" },
  { src: "How to trade stocks with low fees in Europe", want: "Comment trader des actions avec des frais réduits en Europe" },
  { src: "Low Cost EU Broker", want: "Courtier européen à faible coût" },
  { src: "Europe's Full Package Broker", want: "Le courtier tout-en-un de l'Europe" },
  { src: "Invest in the Stock Market", want: "Investissez dans le marché boursier" },
  { src: "Buy and sell stocks" },
  { src: "Stocks & trading online", want: "Actions & trading en ligne" },
  { src: "Invest in EU stocks - ETFs" },
  { src: "Expand Portfolio with Low fees" },
  { src: "Stocks and ETFs for investors" },
  { src: "Global Markets, One Platform!", want: "Marchés mondiaux, une seule plateforme !" },
  { src: "Invest in Your Future Now", want: "Investissez dans votre avenir dès maintenant" },
  { src: "AI-Powered Investing" },
  { src: "Investment Power in Your Hands", want: "Le pouvoir d'investir entre vos mains" },
  { src: "Fixed fees, zero surprises!" },
  { src: "Stable fees, clear cost.", want: "Des frais fixes, des coûts transparents." },
  { src: "Trade with fair fees.", want: "Tradez avec des frais équitables." },
  { src: "Consistent fee structure." },
  { src: "Trade EU. Stocks and ETFs at €1 with MEXEM. Start Saving Now! Explore more.", want: "Tradez des actions et des ETF européens à partir de 1 € avec MEXEM. Commencez à épargner dès maintenant ! Découvrez-en plus." },
  { src: "€1 EU Trades on MEXEM. Access 30K+ Global Products! Invest smartly.", want: "Tradez en Europe dès 1 € sur MEXEM. Accédez à plus de 30 000 produits mondiaux ! Investissez intelligemment." },
  { src: "EU Stocks & ETFs Just €1 at MEXEM. Join & save today!", want: "Actions et ETF européens à partir de 1 € chez MEXEM. Rejoignez-nous et épargnez dès aujourd'hui !" },
  { src: "From €1 Per Trade on EU Stocks and ETFs with MEXEM. Start Saving, Begin Today!" },
  { src: "€1 EU Stock Trades at MEXEM. Seamless Access to Global Markets. Act Now!" },
  { src: "Unlock transparent trading with fixed fees for US and EU stocks at MEXEM starting 2025!", want: "Découvrez le trading transparent avec des frais fixes pour les actions américaines et européennes chez MEXEM dès 2025 !" },
  { src: "Trade US and EU stocks at MEXEM with consistent fees in 2025 for a clearer cost outlook.", want: "Tradez des actions américaines et européennes chez MEXEM avec des frais constants en 2025 pour une meilleure visibilité des coûts." },
  { src: "Enjoy the flexibility of fractional and Terms & conditions apply*.", want: "Profitez de la flexibilité des actions fractionnées. Conditions générales applicables*." },
  { src: "Caution. Investing involves risk of loss.Third party fees and Terms & conditions apply*." },
  { src: "Choose your assets and set your own schedule, keeping your investments consistent over-time" },
  { src: "We offer you a gateway to worldwide trading, providing access to a wide range of Markets, Countries, and Currencies." },
  { src: "Trade global stocks, options, futures, bonds, ETFs and more from a single integrated account" },
  { src: "*Trading complex products such as options, futures, and warrants carries a high level of risk and may not be suitable for all investors" },
  { src: "Pioneering the path towards transparent, low-cost trading.", want: "Ouvrir la voie vers un trading transparent et à faible coût." },
  { src: "Investing in ETFs?" },
  { src: "Then you should know this.", want: "Dans ce cas, vous devriez savoir ceci :" },
  { src: "Meet MEXEM, your broker for  ETF trading.", want: "Découvrez MEXEM, votre courtier pour le trading d'ETF." },
  { src: "With MEXEM, you get up to two ETF buy orders per month with zero commission." },
  { src: "Yes, you heard me right — every month. Without commissions." },
  { src: "Build your ETF portfolio." },
  { src: "Adjust your positions." },
  { src: "Keep your trading costs under control." },
  { src: "Trade global ETFs." },
  { src: "Access fractional shares." },
  { src: "All from one powerful platform." },
  { src: "Upgrade to a MEXEM investing account" },
  { src: "and make your next ETF purchase count.", want: "et optimisez votre prochain achat d'ETF." },
  { src: "MEXEM. For investors who want it all." },
  { src: "Access 70+ commission-free ETPs from WisdomTree. Professional platform with transparent pricing." },
  { src: "Stop overpaying commission on ETP trades. Get professional tools, transparent fees, and expert support. Start investing today.", want: "Ne payez plus de commissions excessives sur les transactions d'ETP. Profitez d'outils professionnels, de frais transparents et d'un support d'experts. Commencez à investir dès aujourd'hui." },
  { src: "Join 50,000+ European investors using MEXEM's commission-free ETP offer. No hidden fees, no minimum deposits." },
  { src: "Trade ETPs like a pro. Access global markets, advanced tools, and tax-efficient investing solutions." },
  { src: "Elevate your ETP portfolio. Zero commission* trading with professional-grade tools and expert guidance." },
  { src: "Explore a diverse array of ETPs. Access a professional platform with clear costs." },
  { src: "Access global markets, advanced tools, and efficient investing solutions. Trade ETPs, with low fees." },
  { src: "Join MEXEM's €0 commission* ETP offer. Zero commission, pro tools." },
  { src: "Upgrade your ETP strategy. Benefit from professional tools, clear fees & dedicated support." },
  { src: "commission-free* ETP trading" },
  { src: "zero commission* ETP broker" },
  { src: "zero commission* ETP EU platform" },
  { src: "MEXEM commission-free ETPs" },
  { src: "ETP investing Europe" },
  { src: "ETP broker" },
  { src: "low cost ETP trading" },
  { src: "European dividend ETPs" },
];

const LENGTH: LengthConstraint = { mode: "max", maxChars: 2000 };

async function translateOne(src: string): Promise<string> {
  const out = await runTranslationJob({
    sourceText: src,
    sourceLanguage: "English",
    targetLocale: TARGET_LOCALE,
    textType: "ad",
    persona: "potential_investors",
    tone: "persuasive",
    lengthConstraint: LENGTH,
    outputCount: 1,
  });
  return out[0]?.outputText ?? "";
}

/** Run with bounded concurrency to be gentle on rate limits. */
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  console.log(`Translating ${ROWS.length} eval source texts → ${TARGET_LOCALE} (production path)…\n`);

  const outputs = await mapPool(ROWS, 5, async (row, i) => {
    try {
      const output = await translateOne(row.src);
      return { ok: true as const, output };
    } catch (err: any) {
      return { ok: false as const, output: `<ERROR: ${err?.message ?? err}>` };
    }
  });

  let lintClean = 0;
  let lintDirty = 0;
  let errored = 0;
  const problems: string[] = [];

  for (let i = 0; i < ROWS.length; i++) {
    const { src, want } = ROWS[i];
    const { ok, output } = outputs[i];
    if (!ok) {
      errored++;
      console.log(`\n#${i + 1} ✖ ERROR`);
      console.log(`  src:    ${src}`);
      console.log(`  ${output}`);
      problems.push(`#${i + 1} ERROR: ${src}`);
      continue;
    }

    const findings = lint(output, src);
    const clean = findings.length === 0;
    if (clean) lintClean++;
    else lintDirty++;

    console.log(`\n#${i + 1} ${clean ? "✓ clean" : "⚠ lint"}`);
    console.log(`  src:    ${src}`);
    console.log(`  out:    ${output}`);
    if (want) console.log(`  want:   ${want}`);
    for (const f of findings) {
      console.log(`    ⚠ [${f.rule}] ${f.message} (…${f.excerpt})`);
      problems.push(`#${i + 1} [${f.rule}] "${output}"`);
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Total: ${ROWS.length} | lint-clean: ${lintClean} | lint-flagged: ${lintDirty} | errors: ${errored}`);
  if (problems.length) {
    console.log(`\nFlagged outputs (need a look):`);
    for (const p of problems) console.log(`  - ${p}`);
  } else {
    console.log(`\nAll outputs are lint-clean for the French trading rules. ✓`);
  }
}

main()
  .catch((err) => { console.error("Harness failed:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
