/**
 * Compliance golden-set evaluation.
 *
 * Runs a labelled set of texts through the REAL compliance pipeline
 * (runComplianceCheck → bundles + LLM validators) and measures:
 *   - PRECISION: how many compliant texts were correctly approved (no false
 *     positives / over-flagging).
 *   - RECALL:    how many known violations were caught, i.e. NOT approved
 *     (false negatives are the dangerous direction for compliance).
 *   - CATEGORY HIT: for caught violations, whether the expected category showed.
 *
 * `strict: true` cases are unambiguous anchors that MUST be classified
 * correctly — a wrong strict case fails the run (regression guard, e.g. for the
 * LLM false-positive suppression). The rest are reported as soft metrics, since
 * borderline judgments + LLM non-determinism make hard pass/fail flaky.
 *
 * Needs DB + OPENAI. Run:
 *   NODE_OPTIONS="-r dotenv/config" npm --workspace backend run eval:compliance
 *
 * Extend CASES with real reviewer-labelled examples over time.
 */
import { runComplianceCheck } from "../services/complianceCheck";

type Expect = "approved" | "flagged";
interface Case {
  text: string;
  expect: Expect;
  /** For violations: the category we expect to see among the findings. */
  category?: string;
  /** Unambiguous anchor — a wrong verdict here fails the run. */
  strict?: boolean;
  note?: string;
}

const LOCALE = (process.env.EVAL_LOCALE ?? "en-GB") as any;

// Greek (el-GR) golden set — used when EVAL_LOCALE=el-GR.
const GREEK_CASES: Case[] = [
  // Compliant
  { text: "Η MEXEM είναι ευρωπαϊκός broker με πρόσβαση σε πάνω από 170 αγορές. Οι επενδύσεις ενέχουν κίνδυνο, συμπεριλαμβανομένης της πιθανής απώλειας του κεφαλαίου.", expect: "approved", strict: true, note: "neutral + risk disclosure" },
  { text: "Επενδύστε σε ευρωπαϊκές μετοχές και ETF με τη MEXEM. Το άνοιγμα λογαριασμού είναι δωρεάν. Το κεφάλαιό σας διατρέχει κίνδυνο. Δεν αποτελεί επενδυτική συμβουλή.", expect: "approved", strict: true, note: "factual CTA + disclaimers" },
  // Violations
  { text: "Εγγυημένες αποδόσεις 20% χωρίς ρίσκο με τη MEXEM!", expect: "flagged", category: "no_guarantees", strict: true, note: "guaranteed returns + risk-free (banned phrases)" },
  { text: "Η MEXEM θα σας κάνει εκατομμυριούχο μέσα σε έναν μήνα.", expect: "flagged", category: "no_guarantees", note: "get-rich promise (inflected — LLM)" },
  { text: "Επενδυτική συμβουλή: πρέπει να αγοράσετε μετοχές της Tesla τώρα, είναι η καλύτερη επένδυση.", expect: "flagged", category: "no_financial_advice", note: "direct investment advice" },
];

const EN_CASES: Case[] = [
  // ── Compliant (must NOT be over-flagged) ──────────────────────────────────
  {
    text: "MEXEM is a European broker offering access to over 170 markets. All investments involve risk, including the possible loss of capital.",
    expect: "approved", strict: true, note: "neutral + risk disclosure",
  },
  {
    text: "Opening an account is free, requires no minimum deposit, and is fully online. Capital at risk. This is not investment advice.",
    expect: "approved", strict: true, note: "factual CTA + disclaimers",
  },
  {
    text: "Trade global stocks, options, futures, bonds and ETFs from one integrated account. Investing carries risk, including loss of capital; this information is for educational purposes only and does not constitute investment advice.",
    expect: "approved", strict: true, note: "product list + full disclaimer (the reported false-positive case)",
  },
  {
    text: "Fractional shares let you invest from small amounts. Your capital is at risk.",
    expect: "approved", note: "benefit + risk disclosure",
  },
  {
    text: "MEXEM is regulated by CySEC (licence 325/17) and offers transparent, low-cost trading. Investments may lose value.",
    expect: "approved", note: "regulatory facts + risk note",
  },
  {
    text: "Earn returns on global ETFs with MEXEM. Opening an account is free and fully online. All investments carry risk, including the possible loss of capital. This is not investment advice.",
    expect: "approved", strict: true, note: "benefit + disclaimer in DIFFERENT sentences — must not over-flag per-sentence",
  },

  // ── Buried violation (sentence-by-sentence must catch it) ──────────────────
  {
    text: "MEXEM is a regulated European broker offering low-cost access to 170 markets. MEXEM will make you a millionaire. Investing involves risk, including the possible loss of capital.",
    expect: "flagged", category: "no_guarantees", strict: true, note: "one bad sentence buried between compliant ones",
  },

  // ── Violations (must be caught — NOT approved) ─────────────────────────────
  {
    text: "Guaranteed 20% returns, risk-free investing with MEXEM! Your profits are assured.",
    expect: "flagged", category: "no_guarantees", strict: true, note: "explicit guarantee + risk-free (banned phrase)",
  },
  {
    text: "Your capital is 100% protected — completely safe, with guaranteed monthly income.",
    expect: "flagged", category: "no_guarantees", strict: true, note: "capital protection / safety guarantee",
  },
  {
    text: "MEXEM will make you a millionaire.",
    expect: "flagged", category: "no_guarantees", strict: true, note: "get-rich/wealth-promise (deterministic banned phrase)",
  },
  {
    text: "You should buy Tesla shares right now — it's the single best investment you can make today.",
    expect: "flagged", category: "no_financial_advice", note: "direct investment advice, no disclaimer",
  },
  {
    text: "Act now! Limited time only — last chance to lock in massive profits before the offer ends tonight!",
    expect: "flagged", category: "urgency", note: "urgency / pressure tactics",
  },
  {
    text: "MEXEM is the number one best broker in the world — nobody beats our returns.",
    expect: "flagged", category: "authority", note: "unsupported superiority claim",
  },
  {
    text: "Earn huge returns and grow your wealth fast with our high-yield strategy.",
    expect: "flagged", category: "risk_balance", note: "benefits with no risk disclosure",
  },
  {
    text: "Our portfolio returned 45% last year — expect the same strong performance again this year.",
    expect: "flagged", category: "past_performance", note: "past performance implying future, no disclaimer",
  },
];

const CASES: Case[] = LOCALE === "el-GR" ? GREEK_CASES : EN_CASES;

async function mapPool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  console.log(`Compliance golden-set eval → ${LOCALE} (${CASES.length} cases)\n`);

  const results = await mapPool(CASES, 4, async (c) => {
    try {
      const r = await runComplianceCheck({ text: c.text, locale: LOCALE });
      const flagged = r.status !== "approved";
      const cats = (r.matchedRules ?? []).map((m: any) => (m.message || "").toLowerCase());
      const categoryHit = c.category ? cats.some((m: string) => m.includes(c.category!.toLowerCase())) : undefined;
      const cited = (r.matchedRules ?? []).some((m: any) => m.regulatoryBasis?.documentRef);
      return { ok: true as const, status: r.status, flagged, categoryHit, cited, findings: r.matchedRules?.length ?? 0 };
    } catch (e: any) {
      return { ok: false as const, error: e?.message ?? String(e) };
    }
  });

  let compTotal = 0, compApproved = 0;        // precision
  let vioTotal = 0, vioCaught = 0, catHits = 0; // recall + category
  const strictFailures: string[] = [];
  const falseNegatives: string[] = [];
  const falsePositives: string[] = [];

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    const res = results[i];
    if (!res.ok) { strictFailures.push(`#${i + 1} ERROR: ${res.error}`); continue; }
    const correct = c.expect === "approved" ? !res.flagged : res.flagged;
    const mark = correct ? "✓" : "✖";
    const catStr = c.category ? ` cat:${c.category}${res.categoryHit ? "✓" : "✗"}` : "";
    console.log(`${mark} [${c.expect}→${res.status}] ${res.cited ? "(cited)" : ""}${catStr}  ${c.text.slice(0, 60)}…`);

    if (c.expect === "approved") {
      compTotal++;
      if (!res.flagged) compApproved++; else falsePositives.push(`#${i + 1} ${c.note ?? ""} — flagged (status ${res.status})`);
    } else {
      vioTotal++;
      if (res.flagged) { vioCaught++; if (res.categoryHit) catHits++; }
      else falseNegatives.push(`#${i + 1} ${c.note ?? ""} — APPROVED (missed violation)`);
    }
    if (c.strict && !correct) strictFailures.push(`#${i + 1} STRICT: expected ${c.expect}, got ${res.status} — ${c.note ?? ""}`);
  }

  const pct = (n: number, d: number) => d === 0 ? "n/a" : `${Math.round((100 * n) / d)}% (${n}/${d})`;
  console.log(`\n${"═".repeat(64)}`);
  console.log(`PRECISION (compliant approved):     ${pct(compApproved, compTotal)}`);
  console.log(`RECALL (violations caught):         ${pct(vioCaught, vioTotal)}`);
  console.log(`CATEGORY HIT (right reason):        ${pct(catHits, vioTotal)}`);
  if (falsePositives.length) { console.log(`\nFalse positives (compliant flagged):`); for (const f of falsePositives) console.log(`  - ${f}`); }
  if (falseNegatives.length) { console.log(`\n⚠ FALSE NEGATIVES (missed violations — dangerous):`); for (const f of falseNegatives) console.log(`  - ${f}`); }

  if (strictFailures.length) {
    console.log(`\n✖ STRICT anchors failed (${strictFailures.length}):`);
    for (const f of strictFailures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n✓ All strict anchors classified correctly.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("Eval failed:", e); process.exit(1); });
