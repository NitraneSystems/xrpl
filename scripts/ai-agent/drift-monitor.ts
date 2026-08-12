/**
 * Phase 9 — continuous drift monitor loop (testnet stub).
 * Compares live classification against registered baseline each cycle; posts alerts webhook.
 *
 * Env: DRIFT_MONITOR_INTERVAL_MS (default 60000), DRIFT_MONITOR_CYCLES (0 = forever)
 */
import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { getAddress } from "viem";
import { detectDrift } from "../../fce-ai-agent/typescript/src/app/drift.ts";
import { syntheticMomentumLead, syntheticMeanRevLead } from "../../fce-ai-agent/typescript/src/app/synthetic.ts";
import { sendAlert } from "./alert-webhook.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

async function main() {
  const accounts = JSON.parse(readFileSync(join(ROOT, "config/accounts.testnet.json"), "utf8"));
  const leads = [
    getAddress(accounts.personas["lead-trader-1"].address),
    getAddress(accounts.personas["lead-trader-2"].address),
  ];
  const interval = Number(process.env.DRIFT_MONITOR_INTERVAL_MS ?? "60000");
  const maxCycles = Number(process.env.DRIFT_MONITOR_CYCLES ?? "0");
  const injectAt = Number(process.env.DRIFT_MONITOR_INJECT_AT ?? "-1");
  console.log(`drift-monitor interval=${interval}ms maxCycles=${maxCycles || "∞"}`);

  let i = 0;
  for (;;) {
    for (const lead of leads) {
      const events =
        injectAt >= 0 && i >= injectAt
          ? syntheticMeanRevLead(lead)
          : syntheticMomentumLead(lead, 1_700_000_000 + i);
      const result = detectDrift({
        lead,
        baselineStrategyType: 0,
        events,
        cycle: i,
      });
      console.log(
        `[drift-monitor] cycle=${i} lead=${lead} live=${result.live} drifted=${result.drifted}`,
      );
      if (result.drifted) {
        await sendAlert({
          type: "drift",
          lead,
          message: `Drift: baseline momentum → ${result.live} (conf ${result.confidence.toFixed(2)})`,
          meta: result as unknown as Record<string, unknown>,
        });
      }
    }
    i += 1;
    if (maxCycles > 0 && i >= maxCycles) break;
    await new Promise((r) => setTimeout(r, interval));
  }
  console.log("drift-monitor done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
