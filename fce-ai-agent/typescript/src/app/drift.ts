/**
 * Drift detector — compare live classification vs registered baseline strategyType.
 */
import { classifyLead, strategyTypeCode, type StrategyClass } from "./classify.js";
import type { OutcomeEvent } from "./scoring.js";

export type DriftResult = {
  lead: string;
  baseline: number;
  live: StrategyClass;
  liveCode: number;
  confidence: number;
  drifted: boolean;
  cycle: number;
  threshold: number;
};

const history: DriftResult[] = [];

export function driftConfidenceThreshold(): number {
  const n = Number(process.env.DRIFT_CONFIDENCE_THRESHOLD ?? "0.55");
  return Number.isFinite(n) ? n : 0.55;
}

export function detectDrift(opts: {
  lead: string;
  baselineStrategyType: number;
  events: OutcomeEvent[];
  cycle: number;
  threshold?: number;
}): DriftResult {
  const threshold = opts.threshold ?? driftConfidenceThreshold();
  const classification = classifyLead(opts.events);
  const liveCode = strategyTypeCode(classification.strategy);
  const drifted =
    liveCode !== opts.baselineStrategyType && classification.confidence >= threshold;

  const result: DriftResult = {
    lead: opts.lead,
    baseline: opts.baselineStrategyType,
    live: classification.strategy,
    liveCode,
    confidence: classification.confidence,
    drifted,
    cycle: opts.cycle,
    threshold,
  };
  history.push(result);
  return result;
}

export function getDriftHistory(): DriftResult[] {
  return [...history];
}

export function resetDriftHistory(): void {
  history.length = 0;
}

export function countFalsePositives(results: DriftResult[]): number {
  return results.filter((r) => r.drifted).length;
}
