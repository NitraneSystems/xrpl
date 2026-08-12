/**
 * Strategy classifier — MVP 3 categories from signal pattern features.
 * Deterministic (no LLM): momentum | mean-reversion | yield-arb.
 */

import type { OutcomeEvent } from "./scoring.js";

export type StrategyClass = "momentum" | "mean-reversion" | "yield-arb";

export type Classification = {
  strategy: StrategyClass;
  confidence: number; // 0–1
  features: {
    directionAutocorr: number;
    sizeCv: number;
    meanAbsPnlBps: number;
  };
};

function directionSeries(events: OutcomeEvent[]): number[] {
  return events.map((e) => (e.direction === "SELL" ? -1 : 1));
}

/** Lag-1 autocorrelation of direction (+1 / -1). */
export function directionAutocorr(events: OutcomeEvent[]): number {
  const d = directionSeries(events);
  if (d.length < 3) return 0;
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < d.length; i++) {
    den += (d[i]! - mean) ** 2;
  }
  for (let i = 1; i < d.length; i++) {
    num += (d[i]! - mean) * (d[i - 1]! - mean);
  }
  if (den === 0) return 0;
  return num / den;
}

export function classifyLead(events: OutcomeEvent[]): Classification {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const directions = sorted.map((e) => (e.direction === "SELL" ? -1 : 1));
  const allSameDirection =
    directions.length > 0 && directions.every((d) => d === directions[0]);
  const autocorr = directionAutocorr(sorted);
  const sizes = sorted.map((e) => e.sizePct ?? 0).filter((s) => s > 0);
  const meanSize = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  const sizeVar =
    sizes.length > 1
      ? sizes.reduce((a, b) => a + (b - meanSize) ** 2, 0) / sizes.length
      : 0;
  const sizeCv = meanSize > 0 ? Math.sqrt(sizeVar) / meanSize : 1;
  const meanAbsPnl =
    sorted.length === 0
      ? 0
      : sorted.reduce((a, e) => a + Math.abs(e.pnlBps), 0) / sorted.length;

  let strategy: StrategyClass;
  let confidence: number;

  if (allSameDirection && sorted.length >= 3) {
    strategy = "momentum";
    confidence = 0.9;
  } else if (autocorr >= 0.25) {
    strategy = "momentum";
    confidence = clamp01(autocorr);
  } else if (autocorr <= -0.15) {
    strategy = "mean-reversion";
    confidence = clamp01(-autocorr);
  } else if (sizeCv < 0.25 && meanAbsPnl < 80 && sorted.length >= 5) {
    strategy = "yield-arb";
    confidence = clamp01(1 - sizeCv);
  } else {
    strategy = meanAbsPnl >= 100 ? "momentum" : "mean-reversion";
    confidence = 0.35;
  }

  return {
    strategy,
    confidence,
    features: {
      directionAutocorr: autocorr,
      sizeCv,
      meanAbsPnlBps: meanAbsPnl,
    },
  };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Map classifier label to MirrorRegistry strategyType uint8. */
export function strategyTypeCode(s: StrategyClass): number {
  switch (s) {
    case "momentum":
      return 0;
    case "mean-reversion":
      return 1;
    case "yield-arb":
      return 2;
  }
}
