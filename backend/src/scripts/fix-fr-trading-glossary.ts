/**
 * One-off, idempotent fix for French trading glossary terms.
 *
 * Why this exists: seed-glossary.ts SKIPS rows that already exist, so editing
 * the seed file does NOT update a glossary row already in the DB. This script
 * repairs existing fr-FR / fr-BE glossary rows whose target term still uses
 * "négociation/négocier" for stock-market trading, replacing it with the
 * approved "trading/trader" terminology (per the May-2026 human eval).
 *
 * SAFE BY DESIGN:
 *   - Only touches localeCode fr-FR / fr-BE.
 *   - Only touches rows whose sourceTerm is in a trading / stock / ETF / ETP /
 *     broker / platform / investment context (TRADING_SOURCE). Genuine
 *     "negotiation" terminology is therefore left untouched.
 *   - No-op for rows that are already correct (no write, counted as unchanged).
 *   - DRY RUN by default: prints before/after and writes NOTHING. Pass --apply
 *     (or APPLY=1) to actually persist.
 *
 * Usage:
 *   npm --workspace backend run fix:fr-trading-glossary            # dry run
 *   npm --workspace backend run fix:fr-trading-glossary -- --apply # write
 */
import { prisma } from "../db";

const LOCALES = ["fr-FR", "fr-BE"];

// A glossary row is in scope only if its (English) sourceTerm clearly belongs
// to the trading / stock-market domain.
const TRADING_SOURCE =
  /\b(trad(?:e|es|ing|er)|stock|stocks|share|shares|equit\w*|etf|etp|broker|platform|invest\w*|market\w*)\b/i;

/** Replace `re` with `replacement`, capitalising the replacement when the
 *  matched text started with an uppercase letter ("Négociation" → "Trading"). */
function replacePreservingCase(text: string, re: RegExp, replacement: string): string {
  return text.replace(re, (match) => {
    const first = match.charAt(0);
    if (first === first.toUpperCase() && first !== first.toLowerCase()) {
      return replacement.charAt(0).toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });
}

function applyTradingTerminology(text: string): string {
  let out = text;
  out = replacePreservingCase(out, /n[ée]gociations?/gi, "trading");
  out = replacePreservingCase(out, /n[ée]gociez/gi, "tradez");
  out = replacePreservingCase(out, /n[ée]gocier/gi, "trader");
  // Gender fix in case a replacement produced "la trading" from "la négociation".
  out = out.replace(/\b(L)a(\s+trading)\b/g, "$1e$2");
  out = out.replace(/\bla(\s+trading)\b/g, "le$1");
  out = out.replace(/\b(U)ne(\s+trading)\b/g, "$1n$2");
  out = out.replace(/\bune(\s+trading)\b/g, "un$1");
  return out;
}

async function main() {
  const dryRun = !(process.argv.includes("--apply") || process.env.APPLY === "1");
  console.log(
    dryRun
      ? "DRY RUN — no changes will be written. Re-run with --apply to persist.\n"
      : "APPLY MODE — writing changes to the database.\n",
  );

  const rows = await prisma.glossaryTerm.findMany({
    where: { localeCode: { in: LOCALES } },
    select: { id: true, localeCode: true, sourceTerm: true, targetTerm: true },
    orderBy: [{ localeCode: "asc" }, { sourceTerm: "asc" }],
  });

  let changed = 0;
  let unchanged = 0;
  let outOfScope = 0;

  for (const row of rows) {
    if (!TRADING_SOURCE.test(row.sourceTerm)) {
      outOfScope++;
      continue;
    }
    if (!/n[ée]goci/i.test(row.targetTerm)) {
      unchanged++; // in scope but already free of "négociation"
      continue;
    }
    const corrected = applyTradingTerminology(row.targetTerm);
    if (corrected === row.targetTerm) {
      unchanged++;
      continue;
    }

    changed++;
    console.log(`[${row.localeCode}] "${row.sourceTerm}"`);
    console.log(`    before: ${row.targetTerm}`);
    console.log(`    after:  ${corrected}`);

    if (!dryRun) {
      await prisma.glossaryTerm.update({ where: { id: row.id }, data: { targetTerm: corrected } });
    }
  }

  console.log(
    `\n${dryRun ? "[dry-run] would change" : "changed"}: ${changed}` +
      `; unchanged (already correct): ${unchanged}` +
      `; out-of-scope sourceTerm: ${outOfScope}`,
  );
  if (dryRun && changed > 0) console.log("\nRe-run with --apply to persist these changes.");
  if (changed === 0) console.log("Nothing to fix — French trading glossary is already clean.");
}

main()
  .catch((err) => {
    console.error("Fix failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
