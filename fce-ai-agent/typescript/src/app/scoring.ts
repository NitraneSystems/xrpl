/**
 * Performance scoring for Mirror AI Agent FCE.
 *
 * Composite AI Score (0–100) weights (PRD §7):
 *   40% Sharpe-equivalent, 25% max drawdown, 20% consistency, 15% data completeness.
 *
 * Sharpe annualization: daily returns use √365. For unequal bars, treat each
 * return as one period and annualize with √(periodsPerYear) where periodsPerYear
 * defaults to 365 when timestamps span ≥1 day average spacing.
 */

export type OutcomeEvent = {
  lead: string;
  timestamp: number; // unix seconds
  pnlBps: number; // period return in basis points (100 = 1%)
  direction?: "BUY" | "SELL";
  sizePct?: number;
};

export type ScoreBreakdown = {
  sharpe: number;
  maxDrawdown: number; // 0–1 fraction of peak
  consistency: number; // 0–1
  dataCompleteness: number; // 0–1
  aiScore: number; // 0–100 integer
};

const WEIGHT_SHARPE = 0.4;
const WEIGHT_DRAWDOWN = 0.25;
const WEIGHT_CONSISTENCY = 0.2;
const WEIGHT_COMPLETENESS = 0.15;

/** Convert a series of period returns (decimal) into Sharpe-equivalent. */
export function sharpeEquivalent(returns: number[], periodsPerYear = 365): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return mean > 0 ? 10 : 0;
  return (mean / stdev) * Math.sqrt(periodsPerYear);
}

/** Max drawdown as a fraction of peak equity (0 = none, 1 = total wipe). */
export function maxDrawdown(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

/**
 * Consistency 0–1 from cadence regularity.
 * Perfect regular spacing → 1; high CV of gaps → approaches 0.
 */
export function consistencyScore(timestamps: number[]): number {
  if (timestamps.length < 3) return timestamps.length === 0 ? 0 : 0.3;
  const sorted = [...timestamps].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = sorted[i]! - sorted[i - 1]!;
    if (g > 0) gaps.push(g);
  }
  if (gaps.length === 0) return 0;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (mean === 0) return 0;
  const variance = gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(1, 1 - cv));
}

/** Data completeness 0–1: more events over ≥30d window → higher. */
export function dataCompleteness(events: OutcomeEvent[], nowSec = Math.floor(Date.now() / 1000)): number {
  if (events.length === 0) return 0;
  const window = 30 * 24 * 3600;
  const inWindow = events.filter((e) => e.timestamp >= nowSec - window);
  // Target ~1 event/day for full credit
  const ratio = inWindow.length / 30;
  return Math.max(0, Math.min(1, ratio));
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Map Sharpe to 0–1 (0 → 0, 2 → ~1, capped). */
function normalizeSharpe(s: number): number {
  return clamp01(s / 2);
}

/** Map drawdown to 0–1 score (lower drawdown → higher score). */
function normalizeDrawdown(mdd: number): number {
  return clamp01(1 - mdd);
}

export function scoreFromReturns(
  returns: number[],
  timestamps: number[],
  eventCountForCompleteness: number,
  nowSec?: number
): ScoreBreakdown {
  const sharpe = sharpeEquivalent(returns);
  const mdd = maxDrawdown(returns);
  const consistency = consistencyScore(timestamps);
  const fauxEvents: OutcomeEvent[] = Array.from({ length: eventCountForCompleteness }, (_, i) => ({
    lead: "0x0",
    timestamp: (timestamps[i] ?? timestamps[0] ?? nowSec ?? 0) - i * 86400,
    pnlBps: 0,
  }));
  const completeness = dataCompleteness(fauxEvents.length ? fauxEvents : [], nowSec);

  const aiScore = Math.round(
    100 *
      (WEIGHT_SHARPE * normalizeSharpe(sharpe) +
        WEIGHT_DRAWDOWN * normalizeDrawdown(mdd) +
        WEIGHT_CONSISTENCY * consistency +
        WEIGHT_COMPLETENESS * completeness)
  );

  return {
    sharpe,
    maxDrawdown: mdd,
    consistency,
    dataCompleteness: completeness,
    aiScore: Math.max(0, Math.min(100, aiScore)),
  };
}

export function scoreLead(events: OutcomeEvent[], nowSec?: number): ScoreBreakdown {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const returns = sorted.map((e) => e.pnlBps / 10_000);
  const timestamps = sorted.map((e) => e.timestamp);
  const sharpe = sharpeEquivalent(returns);
  const mdd = maxDrawdown(returns);
  const consistency = consistencyScore(timestamps);
  const completeness = dataCompleteness(sorted, nowSec);

  const aiScore = Math.round(
    100 *
      (WEIGHT_SHARPE * normalizeSharpe(sharpe) +
        WEIGHT_DRAWDOWN * normalizeDrawdown(mdd) +
        WEIGHT_CONSISTENCY * consistency +
        WEIGHT_COMPLETENESS * completeness)
  );

  return {
    sharpe,
    maxDrawdown: mdd,
    consistency,
    dataCompleteness: completeness,
    aiScore: Math.max(0, Math.min(100, aiScore)),
  };
}
