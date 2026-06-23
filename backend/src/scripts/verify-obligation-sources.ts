/**
 * Verify obligation citations against the ingested regulatory source text.
 *
 * For every approved obligation's sourceRef ({sourceCode, documentRef, quote}),
 * find the cited document's latest ingested version and check whether the quote
 * is actually substantiated by the real source text. Reports:
 *   - VERIFIED       — quote (or its key terms) found in the source text
 *   - NOT FOUND      — source text is present but the quote isn't substantiated
 *   - NO SOURCE TEXT — the document hasn't been ingested yet (stub/placeholder)
 *
 * So the moment real text is ingested (manual upload or a real fetcher), this
 * tells you exactly which obligations are backed by their source and which are
 * not. Usage: npm --workspace backend run verify:obligation-sources
 */
import { prisma } from "../db";

function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9àâäéèêëïîôöùûüçñ ]+/gi, " ").replace(/\s+/g, " ").trim();
}

/** Fraction of the quote's significant words (≥4 chars) present in the source text. */
function tokenOverlap(quote: string, sourceText: string): number {
  const src = norm(sourceText);
  const words = [...new Set(norm(quote).split(" ").filter((w) => w.length >= 4))];
  if (words.length === 0) return 0;
  const hit = words.filter((w) => src.includes(w)).length;
  return hit / words.length;
}

async function main() {
  const obls = await prisma.complianceObligation.findMany({
    where: { status: "approved" },
    select: { id: true, title: true, category: true, jurisdiction: true, sourceRefsJson: true },
    orderBy: [{ jurisdiction: "asc" }, { category: "asc" }],
  });

  let verified = 0, notFound = 0, noSource = 0, total = 0;
  const problems: string[] = [];

  for (const o of obls) {
    let refs: Array<{ sourceCode: string; documentRef?: string; quote?: string }> = [];
    try { refs = JSON.parse(o.sourceRefsJson); } catch { refs = []; }
    for (const ref of refs) {
      if (!ref.quote || ref.quote.trim().length === 0) continue; // nothing to verify
      total++;

      const source = await prisma.regulatorySource.findUnique({ where: { code: ref.sourceCode } });
      const docs = source
        ? await prisma.sourceDocument.findMany({
            where: { sourceId: source.id },
            include: { versions: { orderBy: { fetchedAt: "desc" }, take: 1 } },
          })
        : [];
      // Match the cited documentRef to a document (by externalRef token overlap).
      const wantRef = norm(ref.documentRef ?? "");
      const doc =
        docs.find((d) => wantRef && (norm(d.externalRef).includes(wantRef) || wantRef.includes(norm(d.externalRef)))) ??
        docs.find((d) => tokenOverlap(ref.documentRef ?? "", d.externalRef) >= 0.5);
      const version = doc?.versions[0];
      const versionText = version?.parsedText ?? "";
      // Only manually-ingested authoritative text counts as a real source. Stub
      // summaries (from the V1 adapters / seeds) echo the obligation's own quote,
      // so "matching" against them is circular — not a real verification.
      const isAuthoritative = (version?.fetchedBy ?? "").startsWith("manual:ingest-regulatory-docs");

      const label = `[${o.jurisdiction}/${o.category}] ${ref.sourceCode} ${ref.documentRef ?? ""}`;
      if (!versionText || !isAuthoritative) {
        noSource++;
        console.log(`  ⊘ NO AUTHORITATIVE SOURCE  ${label}${versionText ? " (only a stub summary)" : ""}`);
        continue;
      }
      const exact = norm(versionText).includes(norm(ref.quote));
      const overlap = tokenOverlap(ref.quote, versionText);
      if (exact || overlap >= 0.7) {
        verified++;
        console.log(`  ✓ VERIFIED        ${label}${exact ? " (exact)" : ` (${Math.round(overlap * 100)}% terms)`}`);
      } else {
        notFound++;
        problems.push(`${label} — quote not substantiated (${Math.round(overlap * 100)}% terms): "${(ref.quote || "").slice(0, 70)}…"`);
        console.log(`  ✖ NOT FOUND       ${label} (${Math.round(overlap * 100)}% terms)`);
      }
    }
  }

  const pct = (n: number) => (total === 0 ? "n/a" : `${Math.round((100 * n) / total)}%`);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Obligation citations: ${total}`);
  console.log(`  VERIFIED against source text:  ${verified} (${pct(verified)})`);
  console.log(`  NOT FOUND in source text:      ${notFound} (${pct(notFound)})`);
  console.log(`  NO AUTHORITATIVE SOURCE yet:    ${noSource} (${pct(noSource)})`);
  if (problems.length) {
    console.log(`\nCitations needing review (source present but quote not substantiated):`);
    for (const p of problems) console.log(`  - ${p}`);
  }
  if (noSource > 0) {
    console.log(`\n${noSource} citation(s) have no ingested source text. Add the document(s) under`);
    console.log(`regulatory-sources/ and run: npm --workspace backend run ingest:regulatory-docs`);
  }
}

main().catch((e) => { console.error("Verify failed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
