import { describe, it, expect, beforeEach } from "vitest";
import { detectDrift, resetDriftHistory, countFalsePositives } from "../app/drift.js";
import { syntheticMomentumLead, syntheticMeanRevLead } from "../app/synthetic.js";
import { assessHealth } from "../app/health.js";

describe("drift detector", () => {
  beforeEach(() => resetDriftHistory());

  it("flags when pattern switches from momentum baseline to mean-reversion", () => {
    const lead = "0xlead";
    const baseline = 0; // momentum
    const switched = syntheticMeanRevLead(lead);
    const r = detectDrift({
      lead,
      baselineStrategyType: baseline,
      events: switched,
      cycle: 1,
      threshold: 0.55,
    });
    expect(r.drifted).toBe(true);
    expect(r.live).toBe("mean-reversion");
  });

  it("stays silent across 50 stable momentum cycles (no false positives)", () => {
    const lead = "0xstable";
    const baseline = 0;
    const results = [];
    for (let c = 0; c < 50; c++) {
      const events = syntheticMomentumLead(lead, 1_700_000_000 + c);
      results.push(
        detectDrift({
          lead,
          baselineStrategyType: baseline,
          events,
          cycle: c,
          threshold: 0.55,
        }),
      );
    }
    expect(countFalsePositives(results)).toBe(0);
  });

  it("does not flag low-confidence noise below threshold", () => {
    const lead = "0xnoise";
    // Short alternating series → low confidence mean-rev / mixed
    const events = syntheticMeanRevLead(lead).slice(0, 2);
    const r = detectDrift({
      lead,
      baselineStrategyType: 0,
      events,
      cycle: 0,
      threshold: 0.95,
    });
    // With very high threshold, confidence may be insufficient
    if (r.confidence < 0.95) expect(r.drifted).toBe(false);
  });
});

describe("health assessor", () => {
  it("alerts before liquidation threshold", () => {
    const h = assessHealth({
      follower: "0xf",
      lead: "0xl",
      collateralRatioBps: 12000,
      alertBps: 13000,
      liquidateBps: 11000,
      borrowBalance: 100n,
      supplyBalance: 120n,
    });
    expect(h.status).toBe("Liquidation Risk");
    expect(h.needsTopUp).toBe(true);
    expect(h.suggestedTopUp).toBeGreaterThan(0n);
  });

  it("marks healthy above alert line", () => {
    const h = assessHealth({
      follower: "0xf",
      lead: "0xl",
      collateralRatioBps: 20000,
      alertBps: 13000,
      liquidateBps: 11000,
    });
    expect(h.status).toBe("Healthy");
    expect(h.needsTopUp).toBe(false);
  });
});
