/**
 * Seed trading-context forbidden phrases for fr-FR and fr-BE.
 *
 * From the May-2026 human eval: "négociation/négocier" must never be used for
 * stock-market trading in French. Rather than banning the bare word
 * "négociation" (which would also kill legitimate "negotiation" copy), we
 * register the specific trading-context COLLOCATIONS. Each phrase below only
 * ever occurs in stock-market copy, so the ban stays scoped to trading and
 * genuine negotiation wording is untouched.
 *
 * These rows are injected into the translation prompt by
 * listActiveForbiddenPhrasesForLocale() → formatForbiddenPhrasesBlock().
 *
 * Idempotent: existing active rows are skipped; deactivated rows are
 * reactivated. Safe to re-run.
 *
 * Usage:
 *   npm --workspace backend run seed:fr-trading-forbidden
 */
import { prisma } from "../db";
import { upsertActiveForbiddenPhrase } from "../compliance/forbidden/service";

const LOCALES = ["fr-FR", "fr-BE"];

const PHRASES: Array<{ phrase: string; reason: string }> = [
  { phrase: "négociation en ligne", reason: "Trading context: use 'trading en ligne'. 'Négociation' is never used for the stock market in French." },
  { phrase: "négociation d'actions", reason: "Trading context: use 'trading d'actions'." },
  { phrase: "plateforme de négociation", reason: "Trading context: use 'plateforme de trading'." },
  { phrase: "plateformes de négociation", reason: "Trading context: use 'plateformes de trading'." },
  { phrase: "courtier en négociation", reason: "Trading context: use 'courtier de trading' / 'courtier en trading'." },
  { phrase: "négocier des ETF", reason: "Trading context: use 'trader des ETF'." },
  { phrase: "négocier des actions", reason: "Trading context: use 'trader des actions'." },
  { phrase: "Négociez des actions", reason: "Trading context: use 'Tradez des actions'." },
  { phrase: "Négociez des ETF", reason: "Trading context: use 'Tradez des ETF'." },
  { phrase: "négociation transparente", reason: "Trading context: use 'trading transparent' (and 'le trading', masculine)." },
  { phrase: "la trading", reason: "'le trading' is masculine — never 'la trading'." },
  // "to trade" must be "trader/Tradez", never "échanger/Échangez" (= exchange/swap).
  { phrase: "Échangez des actions", reason: "Trade context: use 'Tradez des actions' — 'échanger' means exchange/swap, not trade." },
  { phrase: "Échangez des ETF", reason: "Trade context: use 'Tradez des ETF'." },
  { phrase: "échanger des actions", reason: "Trade context: use 'trader des actions'." },
  { phrase: "échanger des ETF", reason: "Trade context: use 'trader des ETF'." },
  // "broker" must be translated to "courtier" (except the brand "Interactive Brokers").
  { phrase: "broker d'ETP", reason: "Translate 'broker' → 'courtier' ('courtier d'ETP')." },
];

async function main() {
  console.log("Seeding fr-FR / fr-BE trading forbidden phrases...\n");

  // Attribute rows to the first ADMIN user when one exists (keeps the audit
  // trail honest); otherwise leave addedByUserId null.
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  const actorId = admin?.id ?? null;
  if (actorId === null) {
    console.log("  (no ADMIN user found — ForbiddenPhrase rows will have addedByUserId=null)\n");
  }

  let created = 0;
  let reactivated = 0;
  let skipped = 0;

  for (const locale of LOCALES) {
    for (const e of PHRASES) {
      if (actorId === null) {
        const existing = await prisma.forbiddenPhrase.findUnique({
          where: { localeCode_phrase: { localeCode: locale, phrase: e.phrase } },
        });
        if (existing) {
          if (existing.active) {
            skipped++;
          } else {
            await prisma.forbiddenPhrase.update({
              where: { id: existing.id },
              data: { active: true, reason: e.reason },
            });
            reactivated++;
          }
        } else {
          await prisma.forbiddenPhrase.create({
            data: { phrase: e.phrase, localeCode: locale, reason: e.reason, active: true },
          });
          created++;
        }
      } else {
        const res = await upsertActiveForbiddenPhrase({
          phrase: e.phrase,
          localeCode: locale,
          reason: e.reason,
          addedByUserId: actorId,
        });
        if (res.created) created++;
        else if (res.reactivated) reactivated++;
        else skipped++;
      }
    }
    console.log(`  [${locale}] processed ${PHRASES.length} phrases`);
  }

  console.log(`\nDone. Created: ${created}, Reactivated: ${reactivated}, Skipped (already active): ${skipped}`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
