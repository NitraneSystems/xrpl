import type { OutcomeEvent } from "./scoring.js";

/** Lead A — steady positive momentum, high Sharpe-ish path. */
export function syntheticMomentumLead(lead: string, now = 1_700_000_000): OutcomeEvent[] {
  const out: OutcomeEvent[] = [];
  for (let i = 0; i < 30; i++) {
    const noise = ((i % 5) - 2) * 2;
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

/** Lead B — alternating / mean-reverting with larger drawdowns and irregular cadence. */
export function syntheticMeanRevLead(lead: string, now = 1_700_000_000): OutcomeEvent[] {
  const out: OutcomeEvent[] = [];
  for (let i = 0; i < 30; i++) {
    const buy = i % 2 === 0;
    out.push({
      lead,
      timestamp: now - (29 - i) * 86400 + (i % 5) * 12_000, // irregular gaps
      pnlBps: buy ? 200 : -180,
      direction: buy ? "BUY" : "SELL",
      sizePct: 300 + (i % 11) * 250,
    });
  }
  return out;
}

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
