/**
 * Runtime Spanish (es-ES) trading-terminology gate. Mirrors frenchTradingGate.
 *
 * Mode via qualityGateConfig.spTradingGateMode (env SP_TRADING_GATE):
 *   - "repair" (default): auto-fix the safe collocations (ETF/ETP invariant,
 *     negociación en línea → trading en línea, …); warn on the rest.
 *   - "warn": never mutate — only log findings.
 *   - "off": no-op.
 *
 * Scoped to es-ES. Every action logs locale, source, output, rule id, action.
 */
import {
  lintSpanishTrading,
  repairSpanishTrading,
  type SpTradingFinding,
  type SpTradingRepair,
} from "./spanishTradingLint";
import { qualityGateConfig } from "./qualityGateConfig";

const SCOPED_LOCALES = new Set(["es-ES"]);

export interface SpTradingGateOutcome {
  text: string;
  mode: "repair" | "warn" | "off";
  repairs: SpTradingRepair[];
  warnings: SpTradingFinding[];
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
  repairs: SpTradingRepair[],
  warnings: SpTradingFinding[],
): void {
  const lines: string[] = [
    `[es-trading-gate] locale=${locale} mode=${mode} repairs=${repairs.length} warnings=${warnings.length}`,
    `  source: ${truncate(sourceText)}`,
    `  output: ${truncate(original)}`,
  ];
  if (repairs.length > 0 && finalText !== original) lines.push(`  result: ${truncate(finalText)}`);
  for (const r of repairs) lines.push(`    • REPAIRED [${r.rule}] "${r.before}" → "${r.after}"`);
  for (const w of warnings) lines.push(`    • WARN [${w.rule}] ${w.message} (…${w.excerpt})`);
  console.warn(lines.join("\n"));
}

export function applySpanishTradingGate(
  sourceText: string,
  translation: string,
  locale: string,
  opts: { silent?: boolean } = {},
): SpTradingGateOutcome {
  const mode = qualityGateConfig.spTradingGateMode;
  if (mode === "off" || !SCOPED_LOCALES.has(locale)) {
    return { text: translation, mode, repairs: [], warnings: [] };
  }

  let text = translation;
  let repairs: SpTradingRepair[] = [];
  if (mode === "repair") {
    const r = repairSpanishTrading(translation, { sourceText });
    text = r.text;
    repairs = r.repairs;
  }

  const warnings = lintSpanishTrading(text, { sourceText });
  if (!opts.silent && (repairs.length > 0 || warnings.length > 0)) {
    logOutcome(locale, sourceText, translation, text, mode, repairs, warnings);
  }
  return { text, mode, repairs, warnings };
}
