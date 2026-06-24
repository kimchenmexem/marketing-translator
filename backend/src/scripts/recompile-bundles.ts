/**
 * Recompile + publish every locale bundle at a bumped version.
 *
 * Run after a change to the bundle COMPILER (e.g. richer promptContext, new
 * obligationRefs) so the published bundles the runtime reads pick it up. Mirrors
 * the v1.2.0 composition (locale primary jurisdiction + EU auto-baseline +
 * CySEC overlay). Idempotent: skips a locale already at NEW_VERSION.
 *
 * Usage: npm --workspace backend run recompile:bundles
 */
import { prisma } from "../db";
import { compileDraftBundle } from "../compliance/bundles/compiler";
import { publishBundle } from "../compliance/bundles/publisher";

const NEW_VERSION = "1.9.0";
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
  console.log(`Recompiling every locale bundle → v${NEW_VERSION} (regulatory-grounding update)…\n`);
  let published = 0, skipped = 0;
  for (const t of TARGETS) {
    const existing = await prisma.ruleBundle.findUnique({
      where: { localeCode_version: { localeCode: t.localeCode, version: NEW_VERSION } },
    });
    if (existing) {
      console.log(`  ${t.localeCode}: already at ${NEW_VERSION} — skipped`);
      skipped++;
      continue;
    }
    const c = await compileDraftBundle({
      localeCode: t.localeCode,
      jurisdiction: t.primary,
      overlays: t.overlays,
      version: NEW_VERSION,
      compiledBy: "recompile-regulatory-grounding",
    });
    const pub = await publishBundle(c.bundleId, "recompile-regulatory-grounding");
    console.log(`  ${t.localeCode}@${NEW_VERSION}: rules=${c.ruleCount} obligations=${c.obligationCount} jurisdictions=[${c.jurisdictionsApplied.join(", ")}] published (superseded ${pub.supersededBundleId ?? "none"})`);
    published++;
  }
  console.log(`\nDone. Published: ${published}, Skipped: ${skipped}`);
}

main()
  .catch((err) => { console.error("Recompile failed:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
