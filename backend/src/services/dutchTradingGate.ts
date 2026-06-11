/**
 * Runtime Dutch (nl-NL / nl-BE) trading-terminology gate. Mirrors the French
 * and Spanish gates.
 *
 * Mode via qualityGateConfig.nlTradingGateMode (env NL_TRADING_GATE):
 *   - "repair" (default): auto-fix the safe swaps (met→tegen lage kosten,
 *     AI-gestuurd→AI-ondersteund, goedkoop→voordelig); warn on the rest
 *     (makelaar, handelsplatform).
 *   - "warn": never mutate — only log findings.
 *   - "off": no-op.
 *
 * Scoped to nl-NL / nl-BE. Every action logs locale, source, output, rule, action.
 */
import {
  lintDutchTrading,
  repairDutchTrading,
  type NlTradingFinding,
  type NlTradingRepair,
} from "./dutchTradingLint";
import { qualityGateConfig } from "./qualityGateConfig";

const SCOPED_LOCALES = new Set(["nl-NL", "nl-BE"]);

export interface NlTradingGateOutcome {
  text: string;
  mode: "repair" | "warn" | "off";
  repairs: NlTradingRepair[];
  warnings: NlTradingFinding[];
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
  repairs: NlTradingRepair[],
  warnings: NlTradingFinding[],
): void {
  const lines: string[] = [
    `[nl-trading-gate] locale=${locale} mode=${mode} repairs=${repairs.length} warnings=${warnings.length}`,
    `  source: ${truncate(sourceText)}`,
    `  output: ${truncate(original)}`,
  ];
  if (repairs.length > 0 && finalText !== original) lines.push(`  result: ${truncate(finalText)}`);
  for (const r of repairs) lines.push(`    • REPAIRED [${r.rule}] "${r.before}" → "${r.after}"`);
  for (const w of warnings) lines.push(`    • WARN [${w.rule}] ${w.message} (…${w.excerpt})`);
  console.warn(lines.join("\n"));
}

export function applyDutchTradingGate(
  sourceText: string,
  translation: string,
  locale: string,
  opts: { silent?: boolean } = {},
): NlTradingGateOutcome {
  const mode = qualityGateConfig.nlTradingGateMode;
  if (mode === "off" || !SCOPED_LOCALES.has(locale)) {
    return { text: translation, mode, repairs: [], warnings: [] };
  }

  let text = translation;
  let repairs: NlTradingRepair[] = [];
  if (mode === "repair") {
    const r = repairDutchTrading(translation, { sourceText });
    text = r.text;
    repairs = r.repairs;
  }

  const warnings = lintDutchTrading(text, { sourceText });
  if (!opts.silent && (repairs.length > 0 || warnings.length > 0)) {
    logOutcome(locale, sourceText, translation, text, mode, repairs, warnings);
  }
  return { text, mode, repairs, warnings };
}
