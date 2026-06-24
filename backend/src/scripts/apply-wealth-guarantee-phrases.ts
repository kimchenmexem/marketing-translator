/**
 * One-off: add get-rich / wealth-promise phrases to the EU "no_guarantees"
 * banned-phrase rule, then recompile + publish every locale bundle.
 *
 * Why a script (not just the seed): seed-eu-baseline is idempotent and does NOT
 * update an obligation that already has rules, so editing the seed alone won't
 * reach the DB. This merges the phrases into the live rule, then republishes.
 *
 * Reliable, deterministic detection of "MEXEM will make you a millionaire" and
 * the like — a hard rejection, not an LLM-only "review_required".
 *
 * Idempotent. Usage: npm --workspace backend run apply:wealth-phrases
 */
import { prisma } from "../db";
import { compileDraftBundle } from "../compliance/bundles/compiler";
import { publishBundle } from "../compliance/bundles/publisher";

const NEW_VERSION = "1.6.0";
const NEW_PHRASES = [
  "get rich", "get rich quick", "make you a millionaire", "become a millionaire",
  "make you rich", "become rich", "millionaire overnight", "double your money", "triple your money",
  "devenez millionnaire", "devenir riche", "doublez votre argent",
  "diventa milionario", "diventare ricco", "raddoppia i tuoi soldi",
  "hazte millonario", "vuélvete rico", "duplica tu dinero",
  "word miljonair", "word rijk", "verdubbel je geld",
  // Greek (stable phrases — inflected forms like "εκατομμυριούχο" are left to the LLM)
  "εγγυημένες αποδόσεις", "εγγυημένο κέρδος", "εγγυημένο εισόδημα",
  "χωρίς ρίσκο", "χωρίς κίνδυνο", "μηδενικό ρίσκο", "πλουτίστε",
];

const TARGETS: Array<{ localeCode: string; primary: string; overlays: string[] }> = [
  { localeCode: "it-IT", primary: "IT", overlays: ["CY"] },
  { localeCode: "fr-FR", primary: "FR", overlays: ["CY"] },
  { localeCode: "nl-NL", primary: "NL", overlays: ["CY"] },
  { localeCode: "nl-BE", primary: "BE", overlays: ["CY"] },
  { localeCode: "fr-BE", primary: "BE", overlays: ["CY"] },
  { localeCode: "es-ES", primary: "ES", overlays: ["CY"] },
  { localeCode: "en-GB", primary: "GB", overlays: ["CY"] },
  { localeCode: "el-GR", primary: "GR", overlays: ["CY"] },
];

async function main() {
  // 1. Merge the phrases into EVERY no_guarantees obligation (EU, GB, CY, …) so
  //    every locale's bundle picks them up — en-GB pulls from GB + CySEC, not EU.
  const obls = await prisma.complianceObligation.findMany({
    where: { category: "no_guarantees" },
    include: { rules: true },
  });
  if (obls.length === 0) throw new Error("No no_guarantees obligation found — run the baseline seeds first.");

  let totalAdded = 0;
  for (const obl of obls) {
    const rule = obl.rules.find((r) => r.ruleType === "banned_phrase");
    if (!rule) continue;
    const config = JSON.parse(rule.configJson || "{}");
    const existing: string[] = Array.isArray(config.phrases) ? config.phrases : [];
    const merged = [...existing];
    let added = 0;
    for (const p of NEW_PHRASES) {
      if (!merged.some((e) => e.toLowerCase() === p.toLowerCase())) { merged.push(p); added++; }
    }
    if (added > 0) {
      config.phrases = merged;
      await prisma.complianceRule.update({ where: { id: rule.id }, data: { configJson: JSON.stringify(config) } });
    }
    totalAdded += added;
    console.log(`  [${obl.jurisdiction}/no_guarantees] +${added} (total ${merged.length})`);
  }
  console.log(`Updated ${obls.length} no_guarantees obligations: +${totalAdded} phrases total.`);

  // 2. Recompile + publish every locale at NEW_VERSION.
  let published = 0, skipped = 0;
  for (const t of TARGETS) {
    const ex = await prisma.ruleBundle.findUnique({
      where: { localeCode_version: { localeCode: t.localeCode, version: NEW_VERSION } },
    });
    if (ex) { console.log(`  ${t.localeCode}: already at ${NEW_VERSION} — skipped`); skipped++; continue; }
    const c = await compileDraftBundle({
      localeCode: t.localeCode, jurisdiction: t.primary, overlays: t.overlays,
      version: NEW_VERSION, compiledBy: "wealth-guarantee-phrases",
    });
    await publishBundle(c.bundleId, "wealth-guarantee-phrases");
    console.log(`  ${t.localeCode}@${NEW_VERSION}: banned phrases now in bundle (rules=${c.ruleCount}) published`);
    published++;
  }
  console.log(`\nDone. Phrases added: ${totalAdded}, bundles published: ${published}, skipped: ${skipped}`);
}

main().catch((e) => { console.error("Failed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
