/**
 * Seed trading-context forbidden phrases for es-ES.
 *
 * From the May-2026 es-ES eval: "negociación/negociar" must not be used for
 * retail trading copy (use "trading" / "operar"). We register the specific
 * trading-context collocations (not the bare word) so genuine "negotiation"
 * copy is untouched.
 *
 * Idempotent: existing active rows are skipped; deactivated rows are
 * reactivated. Safe to re-run.
 *
 * Usage: npm --workspace backend run seed:es-trading-forbidden
 */
import { prisma } from "../db";
import { upsertActiveForbiddenPhrase } from "../compliance/forbidden/service";

const LOCALE = "es-ES";

const PHRASES: Array<{ phrase: string; reason: string }> = [
  { phrase: "negociación en línea", reason: "Trading context: use 'trading en línea'." },
  { phrase: "negociación de acciones", reason: "Trading context: use 'operar en acciones'." },
  { phrase: "plataforma de negociación", reason: "Trading context: use 'plataforma de inversión'." },
  { phrase: "negociación transparente", reason: "Trading context: use 'trading transparente'." },
  { phrase: "negociación fraccionada", reason: "Use 'trading fraccionado'." },
];

async function main() {
  console.log("Seeding es-ES trading forbidden phrases...\n");
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  const actorId = admin?.id ?? null;
  if (actorId === null) console.log("  (no ADMIN user found — rows will have addedByUserId=null)\n");

  let created = 0, reactivated = 0, skipped = 0;
  for (const e of PHRASES) {
    if (actorId === null) {
      const existing = await prisma.forbiddenPhrase.findUnique({
        where: { localeCode_phrase: { localeCode: LOCALE, phrase: e.phrase } },
      });
      if (existing) {
        if (existing.active) skipped++;
        else { await prisma.forbiddenPhrase.update({ where: { id: existing.id }, data: { active: true, reason: e.reason } }); reactivated++; }
      } else {
        await prisma.forbiddenPhrase.create({ data: { phrase: e.phrase, localeCode: LOCALE, reason: e.reason, active: true } });
        created++;
      }
    } else {
      const res = await upsertActiveForbiddenPhrase({ phrase: e.phrase, localeCode: LOCALE, reason: e.reason, addedByUserId: actorId });
      if (res.created) created++; else if (res.reactivated) reactivated++; else skipped++;
    }
  }
  console.log(`Done. Created: ${created}, Reactivated: ${reactivated}, Skipped (already active): ${skipped}`);
}

main()
  .catch((err) => { console.error("Seed failed:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
