/**
 * Homepage translation rules — regression tests.
 *
 * Verifies that the approved "New Homepage" wordings for NL / IT / ES / FR
 * are persisted in the three rule channels the project already uses:
 *   - TranslationMemoryEntry (positive examples)
 *   - GlossaryTerm           (required terminology)
 *   - ForbiddenPhrase        (reviewer-rejected wordings)
 *
 * Plus a static check that the cross-locale "no CTA prefix" rule and the
 * locale-specific style guides surface the right reviewer guidance.
 *
 * Run with:
 *   npm --workspace backend run seed:homepage-translations
 *   npm --workspace backend run test:homepage-translations
 *
 * These are data-shape assertions — they do NOT call the LLM. The
 * actual generated translation is validated end-to-end via staging usage.
 */

import { prisma } from "../db";
import { getLocaleStyleGuide } from "../services/ai";
import { retrieveTranslationMemory } from "../services/translationMemoryRetrieval";

const TEXT_TYPE = "homepage";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.error(`  ✖ FAIL: ${name}`);
  }
}

function section(name: string) {
  console.log(`\n═══ ${name} ═══`);
}

async function assertTmTarget(locale: string, source: string, expectedTarget: string) {
  const row = await prisma.translationMemoryEntry.findFirst({
    where: { targetLocale: locale, textType: TEXT_TYPE, sourceText: source, targetText: expectedTarget },
    select: { id: true },
  });
  assert(row !== null, `[${locale}] TM: "${source.slice(0, 50)}…" → "${expectedTarget.slice(0, 50)}…"`);
}

async function assertGlossary(locale: string, source: string, expectedTarget: string) {
  const row = await prisma.glossaryTerm.findFirst({
    where: { localeCode: locale, sourceTerm: source },
    select: { targetTerm: true, required: true },
  });
  assert(
    row !== null && row.targetTerm === expectedTarget && row.required === true,
    `[${locale}] Glossary: ${source} → ${expectedTarget} (required)`,
  );
}

async function assertForbidden(locale: string, phrase: string) {
  const row = await prisma.forbiddenPhrase.findUnique({
    where: { localeCode_phrase: { localeCode: locale, phrase } },
    select: { active: true },
  });
  assert(row !== null && row.active === true, `[${locale}] Forbidden (active): "${phrase}"`);
}

async function main() {
  section("Fractional-trading wording across locales");
  // ES — 05.26 eval: "trading fraccionado" + tú register
  await assertTmTarget(
    "es-ES",
    "Enjoy the flexibility of fractional trading on most EU & US stocks.",
    "Disfruta de la flexibilidad del trading fraccionado en la mayoría de las acciones europeas y estadounidenses.",
  );
  await assertForbidden("es-ES", "negociación fraccionada");

  // IT — preferred "trading frazionato" + EN→IT EU/US wording
  await assertTmTarget(
    "it-IT",
    "Enjoy the flexibility of fractional trading on most EU & US stocks.",
    "Sfrutta la flessibilità del trading frazionato sulla maggior parte delle azioni europee e statunitensi.",
  );
  await assertForbidden("it-IT", "trading frazionale");
  await assertForbidden("it-IT", "azioni EU e US");
  await assertForbidden("it-IT", "Goditi la flessibilità");

  // FR — preferred "trading fractionné" + keep "EU et US"
  await assertTmTarget(
    "fr-FR",
    "Enjoy the flexibility of fractional trading on most EU & US stocks.",
    "Profitez de la flexibilité du trading fractionné sur la majorité des actions EU et US.",
  );
  await assertForbidden("fr-FR", "négociation fractionnée");
  await assertForbidden("fr-FR", "actions européennes et américaines");

  // NL — "fractioneel handelen"
  await assertTmTarget(
    "nl-NL",
    "Enjoy the flexibility of fractional trading on most EU & US stocks.",
    "Profiteer van de flexibiliteit van fractioneel handelen in de meeste EU- en Amerikaanse aandelen.",
  );

  section("FR capitalisation + ETF conventions");
  // Sentence-case for "Accédez aux marchés financiers mondiaux"
  await assertTmTarget("fr-FR", "Access Global Financial Markets", "Accédez aux marchés financiers mondiaux");
  // "Tradez des ETF sans commission" — singular ETF, "Tradez" not "Négociez"
  await assertTmTarget("fr-FR", "Trade ETFs with 0 commissions", "Tradez des ETF sans commission");
  await assertForbidden("fr-FR", "Négociez des ETF sans commission");
  // ETFs glossary → singular "ETF" in French
  await assertGlossary("fr-FR", "ETFs", "ETF");
  // Style guide mentions sentence case + ETF invariance
  const frStyle = getLocaleStyleGuide("fr-FR");
  assert(/sentence case|sentence-case/i.test(frStyle), "[fr-FR] style-guide explicitly mentions sentence case");
  assert(/ETF.*invariant/i.test(frStyle), "[fr-FR] style-guide notes ETF is invariant");
  // Stats card form
  await assertTmTarget("fr-FR", "170+ Markets", "170+ marchés");
  await assertForbidden("fr-FR", "Plus de 170 marchés");

  section("ES low-trading-fees + corporate overrides (05.26: tú + trading/operar)");
  await assertTmTarget("es-ES", "Low Trading Fees", "Comisiones de Trading Bajas");
  await assertForbidden("es-ES", "Tarifas de Negociación Bajas");
  // Corporate verb in tú register: "Pon a trabajar..."
  await assertTmTarget("es-ES", "PUT YOUR BUSINESS CAPITAL WORK", "PON A TRABAJAR TU CAPITAL EMPRESARIAL");
  await assertForbidden("es-ES", "PONGA A TRABAJAR SU CAPITAL EMPRESARIAL");
  await assertForbidden("es-ES", "HAGA TRABAJAR SU CAPITAL EMPRESARIAL");
  // Corporate paragraph in tú register
  await assertTmTarget(
    "es-ES",
    "Your business is making profits, but how you manage them is equally important. A corporate investment account offers a structured, tax-efficient way to allocate capital, while keeping access to global opportunities.",
    "Tu empresa genera beneficios, pero gestionarlos de forma eficiente es igual de importante. Una cuenta de inversión corporativa ofrece una forma estructurada y fiscalmente eficiente de asignar capital, manteniendo al mismo tiempo el acceso a oportunidades globales.",
  );
  await assertForbidden("es-ES", "la gestión de estos");

  section("IT column-E preferred terms + corporate paragraph");
  // Deterministic IT headline — exactly one approved homepage TM entry,
  // accented form "DI PIÙ", literal column-B target retired.
  await assertTmTarget("it-IT", "TRADERS WHO WANT IT ALL", "PER TRADER CHE VOGLIONO DI PIÙ");
  {
    const rows = await prisma.translationMemoryEntry.findMany({
      where: { targetLocale: "it-IT", textType: TEXT_TYPE, sourceText: "TRADERS WHO WANT IT ALL" },
      select: { id: true, targetText: true },
    });
    assert(
      rows.length === 1,
      `[it-IT] exactly one homepage TM entry for "TRADERS WHO WANT IT ALL" (found ${rows.length})`,
    );
    assert(
      rows.every((r) => r.targetText === "PER TRADER CHE VOGLIONO DI PIÙ"),
      `[it-IT] sole TM target is the accented column-E form (found ${rows.map((r) => r.targetText).join(" | ")})`,
    );
    // No legacy literal candidate
    const literal = rows.find((r) => r.targetText === "TRADER CHE VOGLIONO TUTTO");
    assert(literal === undefined, `[it-IT] retired literal "TRADER CHE VOGLIONO TUTTO" is absent as a TM candidate`);
    // No unaccented or apostrophe form
    const unaccented = rows.find((r) => /DI PIU['’]?$/.test(r.targetText));
    assert(unaccented === undefined, `[it-IT] no unaccented "DI PIU" or "DI PIU'" form leaks through`);
  }
  // Also verify retrieveTranslationMemory does not surface the literal —
  // simulates the runtime path the LLM would see. The retrieval skips
  // exact self-matches of the source, so we query with a slightly
  // adjusted source to force the entry to be a non-self candidate.
  {
    const probeSource = "TRADERS WHO WANT IT ALL (probe)";
    const examples = await retrieveTranslationMemory(probeSource, "it-IT", TEXT_TYPE, 10);
    const literalCandidate = examples.find((ex) => ex.targetText === "TRADER CHE VOGLIONO TUTTO");
    assert(
      literalCandidate === undefined,
      `[it-IT] retrieveTranslationMemory does not return literal "TRADER CHE VOGLIONO TUTTO" as a candidate`,
    );
  }
  // "Azioni frazionate" not "Frazionali"
  await assertTmTarget("it-IT", "Fractional Shares", "Azioni frazionate");
  await assertForbidden("it-IT", "Azioni Frazionali");
  // Corporate accounts CTA
  await assertTmTarget("it-IT", "Explore Corporate Accounts", "Scopri i Conti societari");
  await assertForbidden("it-IT", "Esplora Conti Aziendali");
  // Corporate paragraph preferred wording
  await assertTmTarget(
    "it-IT",
    "Your business is making profits, but how you manage them is equally important. A corporate investment account offers a structured, tax-efficient way to allocate capital, while keeping access to global opportunities.",
    "La tua società genera utili, ma il modo in cui vengono gestiti fa la differenza. Un conto societario di investimento offre una struttura efficiente per allocare la liquidità aziendale, mantenendo l'accesso alle opportunità dei mercati internazionali.",
  );
  await assertForbidden("it-IT", "Piattaforme di Trading Potenti");
  await assertForbidden("it-IT", "Commissioni di Trading Basse");

  section("Product glossary per language (every locale, every product)");
  const glossaryExpect: Record<string, Record<string, string>> = {
    "nl-NL": {
      STOCKS: "AANDELEN",
      ETFs: "ETF's",
      OPTIONS: "OPTIES",
      FUTURES: "FUTURES",
      "MUTUAL FUNDS": "BELEGGINGSFONDSEN",
      BONDS: "OBLIGATIES",
      METALS: "METAAL",
      WARRANTS: "WARRANTS",
      CURRENCIES: "VALUTA'S",
    },
    "it-IT": {
      STOCKS: "AZIONI",
      ETFs: "ETFs",
      OPTIONS: "OPZIONI",
      FUTURES: "FUTURES",
      "MUTUAL FUNDS": "FONDI COMUNI",
      BONDS: "OBBLIGAZIONI",
      METALS: "METALLI",
      WARRANTS: "WARRANT",
      CURRENCIES: "VALUTE",
    },
    "es-ES": {
      STOCKS: "ACCIONES",
      ETFs: "ETF",
      OPTIONS: "OPCIONES",
      FUTURES: "FUTUROS",
      "MUTUAL FUNDS": "FONDOS DE INVERSIÓN",
      BONDS: "BONOS",
      METALS: "METALES",
      WARRANTS: "WARRANTS",
      CURRENCIES: "DIVISAS",
    },
    "fr-FR": {
      STOCKS: "ACTIONS",
      ETFs: "ETF",
      OPTIONS: "OPTIONS",
      FUTURES: "CONTRATS À TERME",
      "MUTUAL FUNDS": "FONDS COMMUNS",
      BONDS: "OBLIGATIONS",
      METALS: "MÉTAUX",
      WARRANTS: "WARRANTS",
      CURRENCIES: "DEVISES",
    },
  };
  for (const [locale, terms] of Object.entries(glossaryExpect)) {
    for (const [src, tgt] of Object.entries(terms)) {
      await assertGlossary(locale, src, tgt);
    }
  }

  section("Legal / risk disclaimer wording");
  await assertTmTarget(
    "nl-NL",
    "*Trading complex products such as options, futures and warrants carries a high level of risk and may not be suitable for all investors.",
    "*Handelen in complexe producten zoals opties, futures en warrants brengt een hoog risico met zich mee en is mogelijk niet geschikt voor alle beleggers.",
  );
  await assertTmTarget(
    "it-IT",
    "*Trading complex products such as options, futures and warrants carries a high level of risk and may not be suitable for all investors.",
    "*La negoziazione di strumenti complessi come opzioni, futures e warrant comporta un livello elevato di rischio e potrebbe non essere adatta a tutti gli investitori.",
  );
  await assertTmTarget(
    "es-ES",
    "*Trading complex products such as options, futures and warrants carries a high level of risk and may not be suitable for all investors.",
    "*Operar con productos complejos como opciones, futuros y warrants conlleva un alto nivel de riesgo y puede no ser adecuado para todos los inversores.",
  );
  await assertTmTarget(
    "fr-FR",
    "*Trading complex products such as options, futures and warrants carries a high level of risk and may not be suitable for all investors.",
    "*Le trading de produits complexes tels que les options, les futures et les warrants comporte un niveau de risque élevé et peut ne pas convenir à tous les investisseurs.",
  );

  section("CTA prefix rule");
  await assertForbidden("es-ES", "CTA Todos los Productos");

  section("Style-guide assertions");
  const itStyle = getLocaleStyleGuide("it-IT");
  assert(/Commissioni di Trading contenute/.test(itStyle), "[it-IT] style-guide mentions 'Commissioni di Trading contenute'");
  assert(/Azioni frazionate/.test(itStyle), "[it-IT] style-guide mentions 'Azioni frazionate'");
  const esStyle = getLocaleStyleGuide("es-ES");
  assert(/operar/i.test(esStyle) && /negociaci[oó]n/i.test(esStyle), "[es-ES] style-guide uses 'operar' and bans 'negociación'");
  assert(/informal "t[úu]"|"t[úu]" \(/i.test(esStyle), "[es-ES] style-guide sets the informal 'tú' register");
  const nlStyle = getLocaleStyleGuide("nl-NL");
  assert(/Wij banen de weg naar transparante, voordelige handel/.test(nlStyle), "[nl-NL] style-guide carries the 05.26 'Pioneering' wording");
  assert(/NEVER "makelaar"/i.test(nlStyle) && /voordelig/i.test(nlStyle), "[nl-NL] style-guide: broker not makelaar + voordelig");

  // ─── Summary ──────────────────────────────────────────────────────
  console.log();
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main()
  .catch((err) => { console.error("Test run failed:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
