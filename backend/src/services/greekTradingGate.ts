/**
 * Runtime Greek (el-GR) trading-terminology gate. Mirrors spanishTradingGate.
 *
 * Mode via qualityGateConfig.grTradingGateMode (env GR_TRADING_GATE):
 *   - "repair" (default): auto-fix the safe collocations (ETF/ETP invariant);
 *     warn on the rest (ΕΕ → ευρωπαϊκές, "trading σε μετοχές").
 *   - "warn": never mutate — only log findings.
 *   - "off": no-op.
 *
 * Scoped to el-GR. Every action logs locale, source, output, rule id, action.
 */
import {
  lintGreekTrading,
  repairGreekTrading,
  type ElTradingFinding,
  type ElTradingRepair,
} from "./greekTradingLint";
import { qualityGateConfig } from "./qualityGateConfig";

const SCOPED_LOCALES = new Set(["el-GR"]);

export interface ElTradingGateOutcome {
  text: string;
  mode: "repair" | "warn" | "off";
  repairs: ElTradingRepair[];
  warnings: ElTradingFinding[];
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
  repairs: ElTradingRepair[],
  warnings: ElTradingFinding[],
): void {
  const lines: string[] = [
    `[el-trading-gate] locale=${locale} mode=${mode} repairs=${repairs.length} warnings=${warnings.length}`,
    `  source: ${truncate(sourceText)}`,
    `  output: ${truncate(original)}`,
  ];
  if (repairs.length > 0 && finalText !== original) lines.push(`  result: ${truncate(finalText)}`);
  for (const r of repairs) lines.push(`    • REPAIRED [${r.rule}] "${r.before}" → "${r.after}"`);
  for (const w of warnings) lines.push(`    • WARN [${w.rule}] ${w.message} (…${w.excerpt})`);
  console.warn(lines.join("\n"));
}

export function applyGreekTradingGate(
  sourceText: string,
  translation: string,
  locale: string,
  opts: { silent?: boolean } = {},
): ElTradingGateOutcome {
  const mode = qualityGateConfig.grTradingGateMode;
  if (mode === "off" || !SCOPED_LOCALES.has(locale)) {
    return { text: translation, mode, repairs: [], warnings: [] };
  }

  let text = translation;
  let repairs: ElTradingRepair[] = [];
  if (mode === "repair") {
    const r = repairGreekTrading(translation, { sourceText });
    text = r.text;
    repairs = r.repairs;
  }

  const warnings = lintGreekTrading(text, { sourceText });
  if (!opts.silent && (repairs.length > 0 || warnings.length > 0)) {
    logOutcome(locale, sourceText, translation, text, mode, repairs, warnings);
  }
  return { text, mode, repairs, warnings };
}
