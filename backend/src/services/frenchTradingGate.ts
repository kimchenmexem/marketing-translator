/**
 * Runtime French trading-terminology gate.
 *
 * Wraps the deterministic linter/repairer (frenchTradingLint.ts) for use inside
 * the quality-gate pipeline. Scoped to fr-FR / fr-BE only.
 *
 * Behaviour (qualityGateConfig.frTradingGateMode, env FR_TRADING_GATE):
 *   - "repair" (default): auto-fix the clearly-unsafe collocations
 *     (négociation→trading, la trading→le trading, …); warn on the rest.
 *   - "warn": never mutate — only surface findings (safe-first deploy).
 *   - "off": no-op.
 *
 * Conservatism guarantees (inherited from frenchTradingLint):
 *   - genuine "negotiation" source text is never touched;
 *   - only the enumerated unambiguous patterns are auto-repaired — a bare
 *     "négociation" with no safe rewrite is WARNED, not blindly replaced.
 *
 * Every action is logged with locale, source, output, rule id, and the action
 * taken (REPAIRED / WARN).
 */
import {
  lintFrenchTrading,
  repairFrenchTrading,
  type FrTradingFinding,
  type FrTradingRepair,
} from "./frenchTradingLint";
import { qualityGateConfig } from "./qualityGateConfig";

const SCOPED_LOCALES = new Set(["fr-FR", "fr-BE"]);

export interface FrTradingGateOutcome {
  /** Text after any auto-repair (unchanged in warn/off mode). */
  text: string;
  /** Effective mode for this call. */
  mode: "repair" | "warn" | "off";
  /** Repairs that were applied (empty in warn/off mode). */
  repairs: FrTradingRepair[];
  /** Remaining findings that were NOT auto-mutated. */
  warnings: FrTradingFinding[];
}

function truncate(s: string, n = 160): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function logOutcome(
  locale: string,
  sourceText: string,
  original: string,
  finalText: string,
  mode: "repair" | "warn",
  repairs: FrTradingRepair[],
  warnings: FrTradingFinding[],
): void {
  const lines: string[] = [
    `[fr-trading-gate] locale=${locale} mode=${mode} repairs=${repairs.length} warnings=${warnings.length}`,
    `  source: ${truncate(sourceText)}`,
    `  output: ${truncate(original)}`,
  ];
  if (repairs.length > 0 && finalText !== original) {
    lines.push(`  result: ${truncate(finalText)}`);
  }
  for (const r of repairs) {
    lines.push(`    • REPAIRED [${r.rule}] "${r.before}" → "${r.after}"`);
  }
  for (const w of warnings) {
    lines.push(`    • WARN [${w.rule}] ${w.message} (…${w.excerpt})`);
  }
  console.warn(lines.join("\n"));
}

/**
 * Apply the gate to a single translation. Pure except for logging.
 * Reads the mode from qualityGateConfig at call time (so it can be toggled).
 */
export function applyFrenchTradingGate(
  sourceText: string,
  translation: string,
  locale: string,
  opts: { silent?: boolean } = {},
): FrTradingGateOutcome {
  const mode = qualityGateConfig.frTradingGateMode;

  if (mode === "off" || !SCOPED_LOCALES.has(locale)) {
    return { text: translation, mode, repairs: [], warnings: [] };
  }

  let text = translation;
  let repairs: FrTradingRepair[] = [];

  if (mode === "repair") {
    const r = repairFrenchTrading(translation, { sourceText });
    text = r.text;
    repairs = r.repairs;
  }

  // Re-lint the (possibly repaired) text. Whatever remains is ambiguous or had
  // no safe rewrite — we warn rather than mutate.
  const warnings = lintFrenchTrading(text, { sourceText });

  if (!opts.silent && (repairs.length > 0 || warnings.length > 0)) {
    logOutcome(locale, sourceText, translation, text, mode, repairs, warnings);
  }

  return { text, mode, repairs, warnings };
}
