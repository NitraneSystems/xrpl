/**
 * Drift canary: inject strategy switch mid-run; assert flag; run 50 stable cycles.
 */
import { detectDrift, resetDriftHistory, countFalsePositives } from "../../fce-ai-agent/typescript/src/app/drift.ts";
import { syntheticMomentumLead, syntheticMeanRevLead } from "../../fce-ai-agent/typescript/src/app/synthetic.ts";
import { sendAlert } from "./alert-webhook.ts";

async function main() {
  resetDriftHistory();
  const lead = "0xDriftLead000000000000000000000000000001";

  // Stable cycles
  const stable = [];
  for (let c = 0; c < 50; c++) {
    stable.push(
      detectDrift({
        lead,
        baselineStrategyType: 0,
        events: syntheticMomentumLead(lead, 1_700_000_000 + c),
        cycle: c,
      }),
    );
  }
  const fp = countFalsePositives(stable);
  if (fp !== 0) throw new Error(`expected 0 false positives, got ${fp}`);

  // Inject switch
  const injected = detectDrift({
    lead,
    baselineStrategyType: 0,
    events: syntheticMeanRevLead(lead),
    cycle: 50,
  });
  if (!injected.drifted) throw new Error("expected drift flag after pattern switch");

  await sendAlert({
    type: "drift",
    lead,
    message: `Drift detected: baseline momentum → ${injected.live} (confidence ${injected.confidence.toFixed(2)})`,
    meta: injected,
  });

  console.log(
    JSON.stringify(
      { ok: true, falsePositives: fp, injected: { live: injected.live, drifted: injected.drifted } },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
