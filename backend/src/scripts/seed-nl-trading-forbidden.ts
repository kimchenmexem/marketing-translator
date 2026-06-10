/**
 * Seed trading-context forbidden phrases for nl-NL and nl-BE.
 *
 * From the May-2026 nl-NL eval. The clearest error is "makelaar" (= real-estate
 * agent) for "broker". We register the specific dated/wrong collocations.
 *
 * Idempotent. Usage: npm --workspace backend run seed:nl-trading-forbidden
 */
import { prisma } from "../db";
import { upsertActiveForbiddenPhrase } from "../compliance/forbidden/service";

const LOCALES = ["nl-NL", "nl-BE"];

const PHRASES: Array<{ phrase: string; reason: string }> = [
  { phrase: "aandelenhandelsmakelaar", reason: "Use 'broker' — 'makelaar' means a real-estate agent." },
  { phrase: "effectenmakelaar", reason: "Use 'broker' — 'makelaar' sounds dated/real-estate." },
  { phrase: "Vooroplopen op de weg naar transparant beleggen tegen lage kosten.", reason: "Superseded — use 'Wij banen de weg naar transparante, voordelige handel.'" },
];

async function main() {
  console.log("Seeding nl-NL / nl-BE trading forbidden phrases...\n");
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  const actorId = admin?.id ?? null;
  if (actorId === null) console.log("  (no ADMIN user found — rows will have addedByUserId=null)\n");

  let created = 0, reactivated = 0, skipped = 0;
  for (const locale of LOCALES) {
    for (const e of PHRASES) {
      if (actorId === null) {
        const existing = await prisma.forbiddenPhrase.findUnique({
          where: { localeCode_phrase: { localeCode: locale, phrase: e.phrase } },
        });
        if (existing) {
          if (existing.active) skipped++;
          else { await prisma.forbiddenPhrase.update({ where: { id: existing.id }, data: { active: true, reason: e.reason } }); reactivated++; }
        } else {
          await prisma.forbiddenPhrase.create({ data: { phrase: e.phrase, localeCode: locale, reason: e.reason, active: true } });
          created++;
        }
      } else {
        const res = await upsertActiveForbiddenPhrase({ phrase: e.phrase, localeCode: locale, reason: e.reason, addedByUserId: actorId });
        if (res.created) created++; else if (res.reactivated) reactivated++; else skipped++;
      }
    }
    console.log(`  [${locale}] processed ${PHRASES.length} phrases`);
  }
  console.log(`\nDone. Created: ${created}, Reactivated: ${reactivated}, Skipped (already active): ${skipped}`);
}

main()
  .catch((err) => { console.error("Seed failed:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
