/**
 * Seed homepage / marketing translation rules — NL / IT / ES / FR.
 *
 * Maps the approved "New Homepage" wording onto the project's existing
 * three rule channels — translation memory (positive examples), glossary
 * (required terminology) and ForbiddenPhrase (negative examples). No
 * parallel rule system is introduced.
 *
 * Channels:
 *   1. TranslationMemoryEntry  — source→target homepage fragments under
 *      textType="homepage", surfaced as few-shot examples by
 *      retrieveTranslationMemory().
 *   2. GlossaryTerm            — product / financial terms with
 *      required=true so buildGlossaryPrompt() always injects them.
 *   3. ForbiddenPhrase         — reviewer-rejected wordings the prompt
 *      builder must instruct the model never to emit.
 *
 * Idempotent. TM + glossary rows are looked up by their natural key
 * (sourceText + targetLocale + textType, or sourceTerm + localeCode) and
 * skipped when present. ForbiddenPhrase upserts via the existing service.
 *
 * IT headline note: "TRADERS WHO WANT IT ALL" maps deterministically to
 * "PER TRADER CHE VOGLIONO DI PIÙ" (column E, accented form). The
 * literal column-B target "TRADER CHE VOGLIONO TUTTO" was previously
 * seeded as a secondary candidate but has been retired — the sweep step
 * below removes any stale homepage TM rows whose target isn't in the
 * approved list for the (source, locale) pair.
 *
 * Run: npm --workspace backend run seed:homepage-translations
 */

import { prisma } from "../db";
import { upsertActiveForbiddenPhrase } from "../compliance/forbidden/service";

type Locale = "nl-NL" | "it-IT" | "es-ES" | "fr-FR";

const TEXT_TYPE = "homepage";
const SOURCE_LANGUAGE = "English";

/** Allow a single source phrase to map to several approved targets
 *  (e.g. IT "TRADERS WHO WANT IT ALL" → B + E). The retrieval surface
 *  doesn't currently rank by priority, but ordering the seed makes the
 *  preferred entry the most recent — TM retrieval orders by createdAt
 *  desc, so the preferred form is shown first to the model. */
interface TmEntry {
  source: string;
  /** Approved target(s). The first item is the preferred form. */
  targets: string[];
}

interface GlossaryEntry {
  source: string;
  target: string;
  /** Optional note carried onto the row. */
  notes?: string;
}

interface LocaleBundle {
  tm: TmEntry[];
  glossary: GlossaryEntry[];
  forbidden: Array<{ phrase: string; reason: string }>;
}

// ─── Dutch (Netherlands) ──────────────────────────────────────────────
const NL: LocaleBundle = {
  tm: [
    { source: "TRADERS WHO WANT IT ALL", targets: ["HANDELAARS DIE ALLES WILLEN"] },
    { source: "Powerful Trading Platforms", targets: ["Krachtige tradingplatformen"] },
    {
      source: "Pioneering the path towards transparent, low-cost trading.",
      targets: ["Wij banen de weg naar transparante, voordelige handel."],
    },
    { source: "Trade ETFs with 0 commissions", targets: ["Handel in ETF's zonder commissies"] },
    {
      source: "Enjoy the flexibility of fractional trading on most EU & US stocks.",
      targets: [
        "Profiteer van de flexibiliteit van fractioneel handelen in de meeste EU- en Amerikaanse aandelen.",
        "Geniet van de flexibiliteit van fractioneel handelen in de meeste EU- en Amerikaanse aandelen.",
      ],
    },
    {
      source: "Caution. Investing involves risk of loss. Third party fees and Terms & conditions apply*.",
      targets: ["Let op. Beleggen brengt risico's met zich mee. Derdenkosten en Algemene voorwaarden van toepassing*."],
    },
    { source: "Global Investing", targets: ["Wereldwijd Beleggen"] },
    {
      source: "Trade across 170 markets in 40 countries and 29 currencies.",
      targets: ["Handel op 170 markten in 40 landen en 29 valuta's."],
    },
    { source: "Fractional Shares", targets: ["Fractionele Aandelen"] },
    { source: "Choose your account type", targets: ["Kies uw Accounttype"] },
    {
      source: "Individual, joint, corporate, advisor, junior and more!",
      targets: ["Individueel, gezamenlijk, zakelijk, adviseur, junior en meer!"],
    },
    { source: "Multilingual Support", targets: ["Meertalige Ondersteuning"] },
    {
      source: "Receive support in 10+ languages tailored to your needs.",
      targets: ["Ontvang ondersteuning in meer dan 10 talen, afgestemd op uw behoeften."],
    },
    { source: "Investing Savings plan", targets: ["Beleggingsspaarplan"] },
    {
      source: "Choose your assets and set your own schedule, keeping your investments consistent over-time",
      targets: ["Kies uw activa en stel uw eigen schema op, zodat uw beleggingen consistent blijven."],
    },
    { source: "Low Trading Fees", targets: ["Lage Handelskosten"] },
    { source: "Access Global Financial Markets", targets: ["Toegang tot Wereldwijde Financiële Markten"] },
    {
      source: "We offer you a gateway to worldwide trading, granting access to a wide range of markets, countries and currencies.",
      targets: ["Wij bieden u een toegangspoort tot wereldwijde handel, met toegang tot een breed scala aan markten, landen en valuta's."],
    },
    { source: "170+ Markets", targets: ["170+ Markten"] },
    { source: "40+ Countries", targets: ["40+ Landen"] },
    { source: "29+ Currencies", targets: ["29+ Valuta's"] },
    { source: "EXPLORE OUR PRODUCTS", targets: ["ONTDEK ONZE PRODUCTEN"] },
    {
      source: "Trade global stocks, options, futures, bonds, ETFs and more from one integrated account.",
      targets: ["Handel in wereldwijde aandelen, opties, futures, obligaties, ETF's en meer vanuit één geïntegreerde rekening."],
    },
    {
      source: "*Trading complex products such as options, futures and warrants carries a high level of risk and may not be suitable for all investors.",
      targets: ["*Handelen in complexe producten zoals opties, futures en warrants brengt een hoog risico met zich mee en is mogelijk niet geschikt voor alle beleggers."],
    },
    { source: "All Products", targets: ["Alle Producten"] },
    { source: "PUT YOUR BUSINESS CAPITAL WORK", targets: ["ZET UW BEDRIJFSKAPITAAL AAN HET WERK"] },
    {
      source: "Your business is making profits, but how you manage them is equally important. A corporate investment account offers a structured, tax-efficient way to allocate capital, while keeping access to global opportunities.",
      targets: ["Uw bedrijf maakt winst, maar hoe u dat beheert is net zo belangrijk. Een zakelijke beleggingsrekening biedt een gestructureerde, fiscaal efficiënte manier om kapitaal toe te wijzen, terwijl u toegang houdt tot wereldwijde kansen."],
    },
    { source: "Explore Corporate Accounts", targets: ["Ontdek Zakelijke Rekeningen"] },
  ],
  glossary: [
    { source: "STOCKS", target: "AANDELEN" },
    { source: "ETFs", target: "ETF's" },
    { source: "OPTIONS", target: "OPTIES" },
    { source: "FUTURES", target: "FUTURES" },
    { source: "MUTUAL FUNDS", target: "BELEGGINGSFONDSEN" },
    { source: "MUTUAL FUNS", target: "BELEGGINGSFONDSEN", notes: "Source typo of MUTUAL FUNDS — same target." },
    { source: "BONDS", target: "OBLIGATIES" },
    { source: "METALS", target: "METAAL" },
    { source: "WARRANTS", target: "WARRANTS" },
    { source: "CURRENCIES", target: "VALUTA'S" },
  ],
  forbidden: [
    { phrase: "Vooroplopen op de weg naar transparant beleggen tegen lage kosten.", reason: "Superseded by 05.26 eval — use 'Wij banen de weg naar transparante, voordelige handel.'" },
  ],
};

// ─── Italian ─────────────────────────────────────────────────────────
const IT: LocaleBundle = {
  tm: [
    // Deterministic homepage target — only the accented column-E form.
    // The literal column-B target "TRADER CHE VOGLIONO TUTTO" is retired
    // and actively removed by the sweep step in seedTm().
    { source: "TRADERS WHO WANT IT ALL", targets: ["PER TRADER CHE VOGLIONO DI PIÙ"] },
    { source: "Powerful Trading Platforms", targets: ["Piattaforme di trading evolute"] },
    {
      source: "Pioneering the path towards transparent, low-cost trading.",
      targets: ["Verso un modello di trading trasparente, a costi contenuti.", "Verso un modello di trading trasparente e a costi contenuti."],
    },
    { source: "Trade ETFs with 0 commissions", targets: ["Negozia ETF a zero commissioni"] },
    {
      source: "Enjoy the flexibility of fractional trading on most EU & US stocks.",
      targets: ["Sfrutta la flessibilità del trading frazionato sulla maggior parte delle azioni europee e statunitensi."],
    },
    {
      source: "Caution. Investing involves risk of loss. Third party fees and Terms & conditions apply*.",
      targets: ["Attenzione. Investire comporta il rischio di perdita del capitale. Possono applicarsi commissioni di terzi e termini e condizioni specifici*"],
    },
    { source: "Global Investing", targets: ["Investimenti Globali"] },
    {
      source: "Trade across 170 markets in 40 countries and 29 currencies.",
      targets: ["Opera su oltre 170 mercati in 40 Paesi e 29 valute."],
    },
    { source: "Fractional Shares", targets: ["Azioni frazionate"] },
    { source: "Choose your account type", targets: ["Scegli il tipo di conto"] },
    {
      source: "Individual, joint, corporate, advisor, junior and more!",
      targets: ["Individuale, cointestato, societario, advisor, junior e altre soluzioni."],
    },
    { source: "Multilingual Support", targets: ["Assistenza multilingua"] },
    {
      source: "Receive support in 10+ languages tailored to your needs.",
      targets: [
        "Ricevi assistenza in oltre 10 lingue, con un supporto pensato per le tue esigenze.",
        "Supporto disponibile in oltre 10 lingue, su misura per le tue esigenze.",
      ],
    },
    { source: "Investing Savings plan", targets: ["Piano di accumulo per investimenti", "Piano di accumulo"] },
    {
      source: "Choose your assets and set your own schedule, keeping your investments consistent over-time",
      targets: ["Seleziona gli strumenti e imposta la cadenza che preferisci, mantenendo costanti i tuoi investimenti nel tempo."],
    },
    { source: "Low Trading Fees", targets: ["Commissioni di Trading contenute"] },
    { source: "Access Global Financial Markets", targets: ["Accedi ai Mercati Finanziari Globali"] },
    {
      source: "We offer you a gateway to worldwide trading, granting access to a wide range of markets, countries and currencies.",
      targets: ["Una porta d'accesso ai mercati di tutto il mondo, con un'ampia gamma di Paesi, valute e strumenti."],
    },
    { source: "170+ Markets", targets: ["Oltre 170 Mercati"] },
    { source: "40+ Countries", targets: ["Oltre 40 Paesi"] },
    { source: "29+ Currencies", targets: ["Oltre 29 Valute"] },
    { source: "EXPLORE OUR PRODUCTS", targets: ["SCOPRI I NOSTRI PRODOTTI"] },
    {
      source: "Trade global stocks, options, futures, bonds, ETFs and more from one integrated account.",
      targets: ["Negozia azioni, opzioni, futures, obbligazioni, ETF e altri strumenti dei mercati internazionali da un unico conto integrato."],
    },
    {
      source: "*Trading complex products such as options, futures and warrants carries a high level of risk and may not be suitable for all investors.",
      targets: ["*La negoziazione di strumenti complessi come opzioni, futures e warrant comporta un livello elevato di rischio e potrebbe non essere adatta a tutti gli investitori."],
    },
    { source: "All Products", targets: ["Tutti i Prodotti"] },
    { source: "PUT YOUR BUSINESS CAPITAL WORK", targets: ["METTI AL LAVORO IL CAPITALE DELLA TUA AZIENDA"] },
    {
      source: "Your business is making profits, but how you manage them is equally important. A corporate investment account offers a structured, tax-efficient way to allocate capital, while keeping access to global opportunities.",
      targets: ["La tua società genera utili, ma il modo in cui vengono gestiti fa la differenza. Un conto societario di investimento offre una struttura efficiente per allocare la liquidità aziendale, mantenendo l'accesso alle opportunità dei mercati internazionali."],
    },
    { source: "Explore Corporate Accounts", targets: ["Scopri i Conti societari"] },
  ],
  glossary: [
    { source: "STOCKS", target: "AZIONI" },
    { source: "ETFs", target: "ETFs" },
    { source: "OPTIONS", target: "OPZIONI" },
    { source: "FUTURES", target: "FUTURES" },
    { source: "MUTUAL FUNDS", target: "FONDI COMUNI" },
    { source: "MUTUAL FUNS", target: "FONDI COMUNI", notes: "Source typo of MUTUAL FUNDS — same target." },
    { source: "BONDS", target: "OBBLIGAZIONI" },
    { source: "METALS", target: "METALLI" },
    { source: "WARRANTS", target: "WARRANT" },
    { source: "CURRENCIES", target: "VALUTE" },
  ],
  forbidden: [
    { phrase: "Piattaforme di Trading Potenti", reason: "Reviewer rejected — too literal." },
    { phrase: "Apri la strada verso un trading trasparente e a basso costo.", reason: "Reviewer rejected — too literal." },
    { phrase: "Goditi la flessibilità", reason: "Reviewer rejected register — use 'Sfrutta la flessibilità'." },
    { phrase: "trading frazionale", reason: "Wrong term — use 'trading frazionato'." },
    { phrase: "azioni EU e US", reason: "Reviewer rejected — write 'azioni europee e statunitensi' in the fractional-trading sentence." },
    { phrase: "Azioni Frazionali", reason: "Reviewer rejected — use 'Azioni frazionate'." },
    { phrase: "Commissioni di Trading Basse", reason: "Reviewer rejected — use 'Commissioni di Trading contenute'." },
    { phrase: "Esplora Conti Aziendali", reason: "Reviewer rejected — use 'Scopri i Conti societari'." },
  ],
};

// ─── Spanish (Spain) ─────────────────────────────────────────────────
const ES: LocaleBundle = {
  tm: [
    { source: "TRADERS WHO WANT IT ALL", targets: ["TRADERS QUE LO QUIEREN TODO"] },
    { source: "Powerful Trading Platforms", targets: ["Plataformas de Inversión Potentes"] },
    {
      source: "Pioneering the path towards transparent, low-cost trading.",
      targets: ["Abriendo camino hacia un trading transparente y de bajo coste."],
    },
    { source: "Trade ETFs with 0 commissions", targets: ["Opera con ETF sin comisiones"] },
    {
      source: "Enjoy the flexibility of fractional trading on most EU & US stocks.",
      targets: ["Disfruta de la flexibilidad del trading fraccionado en la mayoría de las acciones europeas y estadounidenses."],
    },
    {
      source: "Caution. Investing involves risk of loss. Third party fees and Terms & conditions apply*.",
      targets: ["Aviso. Invertir implica riesgo de pérdida. Se aplican comisiones de terceros y términos y condiciones*."],
    },
    { source: "Global Investing", targets: ["Inversión Global"] },
    {
      source: "Trade across 170 markets in 40 countries and 29 currencies.",
      targets: ["Opera en 170 mercados de 40 países y en 29 divisas."],
    },
    { source: "Fractional Shares", targets: ["Acciones Fraccionadas"] },
    { source: "Choose your account type", targets: ["Elige tu tipo de cuenta"] },
    {
      source: "Individual, joint, corporate, advisor, junior and more!",
      targets: ["Individual, conjunta, corporativa, asesor, junior y más."],
    },
    { source: "Multilingual Support", targets: ["Soporte Multilingüe"] },
    {
      source: "Receive support in 10+ languages tailored to your needs.",
      targets: ["Recibe asistencia en más de 10 idiomas adaptada a tus necesidades."],
    },
    { source: "Investing Savings plan", targets: ["Plan de Ahorro de Inversión"] },
    {
      source: "Choose your assets and set your own schedule, keeping your investments consistent over-time",
      targets: ["Elige tus activos y establece tu propio calendario, manteniendo tus inversiones constantes a lo largo del tiempo."],
    },
    { source: "Low Trading Fees", targets: ["Comisiones de Trading Bajas"] },
    { source: "Access Global Financial Markets", targets: ["Accede a los Mercados Financieros Globales"] },
    {
      source: "We offer you a gateway to worldwide trading, granting access to a wide range of markets, countries and currencies.",
      targets: ["Te ofrecemos una puerta de entrada al trading internacional, brindándote acceso a una amplia gama de mercados, países y divisas."],
    },
    { source: "170+ Markets", targets: ["Más de 170 Mercados"] },
    { source: "40+ Countries", targets: ["Más de 40 Países"] },
    { source: "29+ Currencies", targets: ["Más de 29 Divisas"] },
    { source: "EXPLORE OUR PRODUCTS", targets: ["DESCUBRE NUESTROS PRODUCTOS"] },
    {
      source: "Trade global stocks, options, futures, bonds, ETFs and more from one integrated account.",
      targets: ["Opera en acciones globales, opciones, futuros, bonos, ETF y más desde una sola cuenta integrada."],
    },
    {
      source: "*Trading complex products such as options, futures and warrants carries a high level of risk and may not be suitable for all investors.",
      targets: ["*Operar con productos complejos como opciones, futuros y warrants conlleva un alto nivel de riesgo y puede no ser adecuado para todos los inversores."],
    },
    { source: "All Products", targets: ["Todos los Productos"] },
    { source: "PUT YOUR BUSINESS CAPITAL WORK", targets: ["PON A TRABAJAR TU CAPITAL EMPRESARIAL"] },
    {
      source: "Your business is making profits, but how you manage them is equally important. A corporate investment account offers a structured, tax-efficient way to allocate capital, while keeping access to global opportunities.",
      targets: ["Tu empresa genera beneficios, pero gestionarlos de forma eficiente es igual de importante. Una cuenta de inversión corporativa ofrece una forma estructurada y fiscalmente eficiente de asignar capital, manteniendo al mismo tiempo el acceso a oportunidades globales."],
    },
    { source: "Explore Corporate Accounts", targets: ["Explora Cuentas Corporativas"] },
  ],
  glossary: [
    { source: "STOCKS", target: "ACCIONES" },
    { source: "ETFs", target: "ETF" },
    { source: "OPTIONS", target: "OPCIONES" },
    { source: "FUTURES", target: "FUTUROS" },
    { source: "MUTUAL FUNDS", target: "FONDOS DE INVERSIÓN" },
    { source: "MUTUAL FUNS", target: "FONDOS DE INVERSIÓN", notes: "Source typo of MUTUAL FUNDS — same target." },
    { source: "BONDS", target: "BONOS" },
    { source: "METALS", target: "METALES" },
    { source: "WARRANTS", target: "WARRANTS" },
    { source: "CURRENCIES", target: "DIVISAS" },
  ],
  forbidden: [
    // Pre-05.26 wordings now superseded (tú register + trading/operar terminology).
    { phrase: "Tarifas de Negociación Bajas", reason: "Superseded — use 'Comisiones de Trading Bajas' (comisiones, not tarifas; trading, not negociación)." },
    { phrase: "Bajas Tarifas de Negociación", reason: "Wrong order + old terminology." },
    { phrase: "Negocie ETFs sin comisiones", reason: "Use 'Opera con ETF sin comisiones' (operar; ETF invariant; tú)." },
    { phrase: "negociación transparente", reason: "Use 'trading transparente'." },
    { phrase: "PONGA A TRABAJAR SU CAPITAL EMPRESARIAL", reason: "Register is now tú — use 'PON A TRABAJAR TU CAPITAL EMPRESARIAL'." },
    { phrase: "HAGA TRABAJAR SU CAPITAL EMPRESARIAL", reason: "Reviewer rejected; register is tú — use 'PON A TRABAJAR TU CAPITAL EMPRESARIAL'." },
    { phrase: "Haga trabajar su capital empresarial", reason: "Reviewer rejected; register is tú." },
    { phrase: "la gestión de estos", reason: "Reviewer rejected — too stiff; rephrase as 'gestionarlos de forma eficiente'." },
    { phrase: "negociación fraccionada", reason: "Use 'trading fraccionado'." },
    { phrase: "CTA Todos los Productos", reason: "'CTA' is metadata, never user-visible. Output just 'Todos los Productos'." },
  ],
};

// ─── French (France) ─────────────────────────────────────────────────
const FR: LocaleBundle = {
  tm: [
    { source: "TRADERS WHO WANT IT ALL", targets: ["POUR LES TRADERS QUI VEULENT TOUT"] },
    { source: "Powerful Trading Platforms", targets: ["Plateformes Puissantes"] },
    {
      source: "Pioneering the path towards transparent, low-cost trading.",
      targets: ["À l’avant-garde d’un trading transparent et à faibles coûts."],
    },
    { source: "Trade ETFs with 0 commissions", targets: ["Tradez des ETF sans commission"] },
    {
      source: "Enjoy the flexibility of fractional trading on most EU & US stocks.",
      targets: ["Profitez de la flexibilité du trading fractionné sur la majorité des actions EU et US."],
    },
    {
      source: "Caution. Investing involves risk of loss. Third party fees and Terms & conditions apply*.",
      targets: ["Attention: Le capital investi présente un risque de perte. Des frais de tiers et des conditions générales s’appliquent*."],
    },
    { source: "Global Investing", targets: ["Investissement international"] },
    {
      source: "Trade across 170 markets in 40 countries and 29 currencies.",
      targets: ["Accédez à 170 marchés dans 40 pays et 29 devises."],
    },
    { source: "Fractional Shares", targets: ["Actions fractionnées"] },
    { source: "Choose your account type", targets: ["Choisissez votre type de compte"] },
    {
      source: "Individual, joint, corporate, advisor, junior and more!",
      targets: ["Individuel, joint, entreprise, conseiller, junior et plus encore !"],
    },
    { source: "Multilingual Support", targets: ["Support multilingue"] },
    {
      source: "Receive support in 10+ languages tailored to your needs.",
      targets: ["Bénéficiez d’un support disponible en plus de 10 langues, adapté à vos besoins."],
    },
    { source: "Investing Savings plan", targets: ["Investissement programmé"] },
    {
      source: "Choose your assets and set your own schedule, keeping your investments consistent over-time",
      targets: ["Choisissez vos actifs et définissez votre propre rythme pour investir régulièrement dans le temps."],
    },
    { source: "Low Trading Fees", targets: ["Trading à frais réduits"] },
    { source: "Access Global Financial Markets", targets: ["Accédez aux marchés financiers mondiaux"] },
    {
      source: "We offer you a gateway to worldwide trading, granting access to a wide range of markets, countries and currencies.",
      targets: ["Nous vous ouvrons les portes du trading mondial avec un accès à un large choix de marchés, pays et devises."],
    },
    { source: "170+ Markets", targets: ["170+ marchés"] },
    { source: "40+ Countries", targets: ["40+ pays"] },
    { source: "29+ Currencies", targets: ["29+ devises"] },
    { source: "EXPLORE OUR PRODUCTS", targets: ["DÉCOUVREZ NOS PRODUITS"] },
    {
      source: "Trade global stocks, options, futures, bonds, ETFs and more from one integrated account.",
      targets: ["Tradez des actions, options, contrats à terme, obligations, ETF et plus encore depuis un seul compte intégré."],
    },
    {
      source: "*Trading complex products such as options, futures and warrants carries a high level of risk and may not be suitable for all investors.",
      targets: ["*Le trading de produits complexes tels que les options, les futures et les warrants comporte un niveau de risque élevé et peut ne pas convenir à tous les investisseurs."],
    },
    { source: "All Products", targets: ["Tous les produits"] },
    { source: "PUT YOUR BUSINESS CAPITAL WORK", targets: ["FAITES TRAVAILLER LE CAPITAL DE VOTRE ENTREPRISE"] },
    {
      source: "Your business is making profits, but how you manage them is equally important. A corporate investment account offers a structured, tax-efficient way to allocate capital, while keeping access to global opportunities.",
      targets: ["Votre entreprise génère des bénéfices, mais la manière dont ils sont gérés est tout aussi importante. Un compte d’investissement entreprise offre une manière structurée et efficace sur le plan fiscal d'allouer du capital tout en conservant un accès à des opportunités mondiales."],
    },
    { source: "Explore Corporate Accounts", targets: ["Découvrez les comptes entreprises"] },
  ],
  glossary: [
    { source: "STOCKS", target: "ACTIONS" },
    { source: "ETFs", target: "ETF", notes: "FR convention — singular invariant 'ETF'." },
    { source: "OPTIONS", target: "OPTIONS" },
    { source: "FUTURES", target: "CONTRATS À TERME" },
    { source: "MUTUAL FUNDS", target: "FONDS COMMUNS" },
    { source: "MUTUAL FUNS", target: "FONDS COMMUNS", notes: "Source typo of MUTUAL FUNDS — same target." },
    { source: "BONDS", target: "OBLIGATIONS" },
    { source: "METALS", target: "MÉTAUX" },
    { source: "WARRANTS", target: "WARRANTS" },
    { source: "CURRENCIES", target: "DEVISES" },
  ],
  forbidden: [
    { phrase: "TRADERS QUI VEULENT TOUT", reason: "Reviewer rejected — use 'POUR LES TRADERS QUI VEULENT TOUT'." },
    { phrase: "Des plateformes de négociation puissantes", reason: "Reviewer rejected — use 'Plateformes Puissantes'." },
    { phrase: "Ouvrez la voie vers une négociation transparente et à faible coût.", reason: "Reviewer rejected — use 'À l’avant-garde d’un trading transparent...'." },
    { phrase: "Négociez des ETF sans commission", reason: "Reviewer preferred 'Tradez des ETF...' in this homepage line." },
    { phrase: "négociation fractionnée", reason: "Reviewer rejected — use 'trading fractionné'." },
    { phrase: "actions européennes et américaines", reason: "Approved homepage line keeps 'EU et US'." },
    { phrase: "Investissement global", reason: "Reviewer preferred 'Investissement international' for the homepage block." },
    { phrase: "Assistance multilingue", reason: "Reviewer preferred 'Support multilingue' on the homepage." },
    { phrase: "Plan d'épargne en investissement", reason: "Reviewer preferred 'Investissement programmé'." },
    { phrase: "Frais de négociation réduits", reason: "Reviewer preferred 'Trading à frais réduits'." },
    { phrase: "porte d'entrée vers la négociation mondiale", reason: "Reviewer rejected — too literal." },
    { phrase: "Plus de 170 marchés", reason: "Homepage stats keep the '170+' form, not 'Plus de 170'." },
    { phrase: "FAITES TRAVAILLER VOTRE CAPITAL D'ENTREPRISE", reason: "Reviewer rejected — use 'FAITES TRAVAILLER LE CAPITAL DE VOTRE ENTREPRISE'." },
    { phrase: "Découvrez les Comptes d'Entreprise", reason: "Reviewer rejected — use sentence case 'Découvrez les comptes entreprises'." },
  ],
};

const ALL: Record<Locale, LocaleBundle> = {
  "nl-NL": NL,
  "it-IT": IT,
  "es-ES": ES,
  "fr-FR": FR,
};

// ─── Seeders ─────────────────────────────────────────────────────────

async function seedTm(locale: Locale, entries: TmEntry[]): Promise<{ created: number; skipped: number; pruned: number }> {
  let created = 0;
  let skipped = 0;
  let pruned = 0;
  for (const e of entries) {
    const approved = new Set(e.targets);

    // Insert any missing approved target.
    for (const target of e.targets) {
      const existing = await prisma.translationMemoryEntry.findFirst({
        where: {
          sourceText: e.source,
          targetText: target,
          targetLocale: locale,
          textType: TEXT_TYPE,
        },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.translationMemoryEntry.create({
        data: {
          sourceText: e.source,
          targetText: target,
          sourceLanguage: SOURCE_LANGUAGE,
          targetLocale: locale,
          textType: TEXT_TYPE,
        },
      });
      created++;
    }

    // Sweep: hard-delete any TM rows for this exact (source, locale,
    // textType) whose targetText isn't in the approved list. This is what
    // makes the seed authoritative across reruns — retired targets like
    // "TRADER CHE VOGLIONO TUTTO" disappear instead of lingering as
    // few-shot candidates the LLM might pick up.
    const stale = await prisma.translationMemoryEntry.findMany({
      where: {
        sourceText: e.source,
        targetLocale: locale,
        textType: TEXT_TYPE,
      },
      select: { id: true, targetText: true },
    });
    for (const row of stale) {
      if (!approved.has(row.targetText)) {
        await prisma.translationMemoryEntry.delete({ where: { id: row.id } });
        pruned++;
      }
    }
  }
  return { created, skipped, pruned };
}

async function seedGlossary(locale: Locale, entries: GlossaryEntry[]): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const e of entries) {
    const existing = await prisma.glossaryTerm.findFirst({
      where: { sourceTerm: e.source, localeCode: locale },
      select: { id: true, targetTerm: true },
    });
    if (existing) {
      if (existing.targetTerm !== e.target) {
        // Only update if reviewer-approved target has changed.
        await prisma.glossaryTerm.update({
          where: { id: existing.id },
          data: { targetTerm: e.target, required: true, notes: e.notes ?? null },
        });
        created++;
      } else {
        skipped++;
      }
      continue;
    }
    await prisma.glossaryTerm.create({
      data: {
        sourceTerm: e.source,
        targetTerm: e.target,
        localeCode: locale,
        required: true,
        forbidden: false,
        notes: e.notes ?? null,
      },
    });
    created++;
  }
  return { created, skipped };
}

async function seedForbidden(locale: Locale, entries: Array<{ phrase: string; reason: string }>, addedByUserId: number | null) {
  let created = 0;
  let reactivated = 0;
  let skipped = 0;
  for (const e of entries) {
    if (addedByUserId === null) {
      // No user attribution available — direct upsert, leaving addedByUserId null.
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
        continue;
      }
      await prisma.forbiddenPhrase.create({
        data: { phrase: e.phrase, localeCode: locale, reason: e.reason, active: true },
      });
      created++;
    } else {
      const res = await upsertActiveForbiddenPhrase({
        phrase: e.phrase,
        localeCode: locale,
        reason: e.reason,
        addedByUserId,
      });
      if (res.created) created++;
      else if (res.reactivated) reactivated++;
      else skipped++;
    }
  }
  return { created, reactivated, skipped };
}

async function main() {
  console.log("Seeding homepage translation rules (NL / IT / ES / FR)...\n");

  // Attribute these rows to the first ADMIN user if one exists; otherwise
  // leave addedByUserId null. The audit narrative makes more sense when
  // there's a real actor.
  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  const actorId = adminUser?.id ?? null;
  if (actorId === null) {
    console.log("  (no ADMIN user found — ForbiddenPhrase rows will have addedByUserId=null)\n");
  }

  const totals = { tmCreated: 0, tmSkipped: 0, tmPruned: 0, glossaryCreated: 0, glossarySkipped: 0, fbCreated: 0, fbReactivated: 0, fbSkipped: 0 };

  for (const locale of Object.keys(ALL) as Locale[]) {
    const bundle = ALL[locale];
    console.log(`── ${locale} ─────────────────────────────────`);
    const tm = await seedTm(locale, bundle.tm);
    const gl = await seedGlossary(locale, bundle.glossary);
    const fb = await seedForbidden(locale, bundle.forbidden, actorId);
    console.log(`   TM:       ${tm.created} created, ${tm.skipped} skipped, ${tm.pruned} pruned`);
    console.log(`   Glossary: ${gl.created} created/updated, ${gl.skipped} unchanged`);
    console.log(`   Forbidden:${fb.created} created, ${fb.reactivated} reactivated, ${fb.skipped} unchanged`);
    totals.tmCreated += tm.created;
    totals.tmSkipped += tm.skipped;
    totals.tmPruned += tm.pruned;
    totals.glossaryCreated += gl.created;
    totals.glossarySkipped += gl.skipped;
    totals.fbCreated += fb.created;
    totals.fbReactivated += fb.reactivated;
    totals.fbSkipped += fb.skipped;
  }

  console.log();
  console.log("═══ Summary ═══");
  console.log(`TM entries (textType=${TEXT_TYPE}): ${totals.tmCreated} new, ${totals.tmSkipped} already present, ${totals.tmPruned} pruned (retired targets)`);
  console.log(`Glossary terms:                     ${totals.glossaryCreated} new/updated, ${totals.glossarySkipped} unchanged`);
  console.log(`ForbiddenPhrases:                   ${totals.fbCreated} new, ${totals.fbReactivated} reactivated, ${totals.fbSkipped} unchanged`);
}

main()
  .catch((err) => { console.error("Seed failed:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
