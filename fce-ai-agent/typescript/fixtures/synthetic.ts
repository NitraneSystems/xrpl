import type { OutcomeEvent } from "../src/app/scoring.js";

/** Lead A — steady positive momentum, high Sharpe-ish path. */
export function syntheticMomentumLead(lead: string, now = 1_700_000_000): OutcomeEvent[] {
  const out: OutcomeEvent[] = [];
  // ~30 daily +0.4% with tiny noise → Sharpe roughly (0.004/0.0005)*sqrt(365) ≈ high
  for (let i = 0; i < 30; i++) {
    const noise = ((i % 5) - 2) * 2; // ±4 bps
    out.push({
      lead,
      timestamp: now - (29 - i) * 86400,
      pnlBps: 40 + noise,
      direction: "BUY",
      sizePct: 1000,
    });
  }
  return out;
}

/** Lead B — alternating / mean-reverting with larger drawdowns. */
export function syntheticMeanRevLead(lead: string, now = 1_700_000_000): OutcomeEvent[] {
  const out: OutcomeEvent[] = [];
  for (let i = 0; i < 30; i++) {
    const buy = i % 2 === 0;
    out.push({
      lead,
      timestamp: now - (29 - i) * 86400 + (i % 3) * 3600, // irregular gaps
      pnlBps: buy ? 120 : -90,
      direction: buy ? "BUY" : "SELL",
      sizePct: 500 + (i % 7) * 200,
    });
  }
  return out;
}

/**
 * Constant daily return r with near-zero variance → known Sharpe ≈ (r / eps) * √365.
 * Used in unit tests with controlled stdev.
 */
export function syntheticKnownSharpeSeries(
  lead: string,
  dailyReturnBps: number,
  dailyNoiseBps: number,
  days: number,
  now = 1_700_000_000
): OutcomeEvent[] {
  const out: OutcomeEvent[] = [];
  for (let i = 0; i < days; i++) {
    const noise = i % 2 === 0 ? dailyNoiseBps : -dailyNoiseBps;
    out.push({
      lead,
      timestamp: now - (days - 1 - i) * 86400,
      pnlBps: dailyReturnBps + noise,
      direction: "BUY",
      sizePct: 800,
    });
  }
  return out;
}
