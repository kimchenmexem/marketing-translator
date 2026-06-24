/**
 * Manual ingestion of regulatory source documents.
 *
 * Reads files from <repo>/regulatory-sources/*.md (skip files starting with "_")
 * and stores each as a REAL SourceDocumentVersion — the actual regulation text,
 * not a stub summary. This is the reliable path while live scraping of the
 * regulator sites is blocked (EUR-Lex bot-protection, ESMA PDFs, FCA JS).
 *
 * File format (header, then a `---` line, then the full text):
 *   sourceCode: EUR_LEX
 *   externalRef: MiFID II (Directive 2014/65/EU)
 *   title: MiFID II — Article 24
 *   url: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32014L0065
 *   ---
 *   <full authoritative text of the relevant article(s)>
 *
 * Idempotent: a version whose content hash already exists is skipped.
 * Usage: npm --workspace backend run ingest:regulatory-docs
 */
import { prisma } from "../db";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const DIR = path.resolve(__dirname, "../../../regulatory-sources");

function parseFile(raw: string): { header: Record<string, string>; body: string } | null {
  const idx = raw.indexOf("\n---");
  if (idx === -1) return null;
  const headerBlock = raw.slice(0, idx);
  const body = raw.slice(raw.indexOf("\n", idx + 1) + 1).trim();
  const header: Record<string, string> = {};
  for (const line of headerBlock.split("\n")) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (m) header[m[1].trim()] = m[2].trim();
  }
  return { header, body };
}

async function main() {
  if (!fs.existsSync(DIR)) {
    console.log(`No regulatory-sources/ directory at ${DIR} — nothing to ingest. Create it and drop document files.`);
    return;
  }
  const files = fs.readdirSync(DIR).filter((f) => /\.(md|txt)$/i.test(f) && !f.startsWith("_"));
  if (files.length === 0) {
    console.log(`regulatory-sources/ has no document files yet (see _TEMPLATE.md).`);
    return;
  }

  let created = 0, skipped = 0, errors = 0;
  for (const file of files) {
    const parsed = parseFile(fs.readFileSync(path.join(DIR, file), "utf8"));
    if (!parsed || !parsed.header.sourceCode || !parsed.header.externalRef || !parsed.body) {
      console.error(`  ✖ ${file}: missing sourceCode / externalRef / body — skipped`);
      errors++;
      continue;
    }
    // Never ingest a scaffold placeholder as authoritative text.
    if (/AWAITING AUTHORITATIVE TEXT|DO NOT INGEST/i.test(parsed.body)) {
      console.warn(`  ⚠ ${file}: placeholder body (awaiting authoritative text) — skipped. Fill the verbatim text, then re-run.`);
      skipped++;
      continue;
    }
    const { sourceCode, externalRef, title, url } = parsed.header;
    const source = await prisma.regulatorySource.findUnique({ where: { code: sourceCode } });
    if (!source) {
      console.error(`  ✖ ${file}: source "${sourceCode}" not registered — run the source seed first`);
      errors++;
      continue;
    }
    const doc = await prisma.sourceDocument.upsert({
      where: { sourceId_externalRef: { sourceId: source.id, externalRef } },
      update: { title: title || externalRef, url: url || null },
      create: { sourceId: source.id, externalRef, title: title || externalRef, url: url || null },
    });
    const contentHash = crypto.createHash("sha256").update(parsed.body, "utf8").digest("hex");
    const existing = await prisma.sourceDocumentVersion.findUnique({
      where: { documentId_contentHash: { documentId: doc.id, contentHash } },
    });
    if (existing) { console.log(`  = ${sourceCode} / ${externalRef}: unchanged`); skipped++; continue; }
    await prisma.sourceDocumentVersion.create({
      data: {
        documentId: doc.id,
        versionLabel: parsed.header.versionLabel || `manual-${new Date().toISOString().slice(0, 10)}`,
        contentHash,
        rawContent: parsed.body,
        parsedText: parsed.body,
        fetchedBy: "manual:ingest-regulatory-docs",
      },
    });
    console.log(`  ✓ ${sourceCode} / ${externalRef}: version stored (${parsed.body.length} chars)`);
    created++;
  }
  console.log(`\nDone. Created: ${created}, Unchanged: ${skipped}, Errors: ${errors}`);
}

main().catch((e) => { console.error("Ingest failed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
