/** Quality gate configuration — all tuneable via env vars */
export const qualityGateConfig = {
  /** Model used for the quality reviewer LLM call */
  reviewModel: process.env.QG_REVIEW_MODEL ?? "gpt-4o-mini",
  /** Model used for the repair LLM call */
  repairModel: process.env.QG_REPAIR_MODEL ?? "gpt-4o-mini",
  /** Minimum score (0–1) for a translation to pass without repair */
  minPassingScore: parseFloat(process.env.QG_MIN_PASSING_SCORE ?? "0.75"),
  /** Enable the automatic repair pass */
  repairEnabled: process.env.QG_REPAIR_ENABLED !== "false",
  /** Enable fallback regeneration when repair fails */
  regenerationEnabled: process.env.QG_REGENERATION_ENABLED !== "false",
  /** Enable the entire quality gate (kill-switch) */
  enabled: process.env.QG_ENABLED !== "false",
  /**
   * French (fr-FR / fr-BE) trading-terminology gate:
   *   "repair" (default) — deterministically fix the clearly-unsafe collocations
   *                        (négociation→trading, la trading→le trading, …) and
   *                        warn on ambiguous cases.
   *   "warn"             — never mutate; only log findings (safe-first deploy).
   *   "off"              — disable entirely.
   */
  frTradingGateMode: ((): "repair" | "warn" | "off" => {
    const v = (process.env.FR_TRADING_GATE ?? "repair").toLowerCase();
    return v === "warn" || v === "off" ? v : "repair";
  })(),
  /** Spanish (es-ES) trading-terminology gate — same modes as the French one. */
  spTradingGateMode: ((): "repair" | "warn" | "off" => {
    const v = (process.env.SP_TRADING_GATE ?? "repair").toLowerCase();
    return v === "warn" || v === "off" ? v : "repair";
  })(),
  /** Dutch (nl-NL / nl-BE) trading-terminology gate — same modes. */
  nlTradingGateMode: ((): "repair" | "warn" | "off" => {
    const v = (process.env.NL_TRADING_GATE ?? "repair").toLowerCase();
    return v === "warn" || v === "off" ? v : "repair";
  })(),
  /** Greek (el-GR) trading-terminology gate — same modes. */
  grTradingGateMode: ((): "repair" | "warn" | "off" => {
    const v = (process.env.GR_TRADING_GATE ?? "repair").toLowerCase();
    return v === "warn" || v === "off" ? v : "repair";
  })(),
  /** Max tokens for the review call */
  reviewMaxTokens: 800,
  /** Max tokens for the repair call */
  repairMaxTokens: 800,
};
