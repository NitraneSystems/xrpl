/**
 * Phase 9 — continuous position-health monitor against MockKineticPool.
 *
 * Env: HEALTH_MONITOR_INTERVAL_MS (default 60000), HEALTH_MONITOR_CYCLES (0 = forever)
 */
import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { createPublicClient, http, parseAbi, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2 } from "../lib/chain.ts";
import { assessHealth } from "../../fce-ai-agent/typescript/src/app/health.ts";
import { sendAlert } from "./alert-webhook.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

async function main() {
  const cfg = JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
  const accounts = JSON.parse(readFileSync(join(ROOT, "config/accounts.testnet.json"), "utf8"));
  const kinetic = getAddress(cfg.contracts.mockKineticPool) as Address;
  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const followerPk = process.env.PERSONA_FOLLOWER_EVM_1_PRIVATE_KEY as Hex | undefined;
  if (!followerPk) throw new Error("PERSONA_FOLLOWER_EVM_1_PRIVATE_KEY required");
  const follower = privateKeyToAccount(followerPk);
  const lead = getAddress(accounts.personas["lead-trader-1"].address);

  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const abi = parseAbi([
    "function getCollateralRatioBps(address user) view returns (uint256)",
    "function liquidationThresholdBps() view returns (uint256)",
  ]);

  const interval = Number(process.env.HEALTH_MONITOR_INTERVAL_MS ?? "60000");
  const maxCycles = Number(process.env.HEALTH_MONITOR_CYCLES ?? "0");
  console.log(`health-monitor kinetic=${kinetic} interval=${interval}ms`);

  let i = 0;
  for (;;) {
    const cr = (await publicClient.readContract({
      address: kinetic,
      abi,
      functionName: "getCollateralRatioBps",
      args: [follower.address],
    })) as bigint;
    const liq = (await publicClient.readContract({
      address: kinetic,
      abi,
      functionName: "liquidationThresholdBps",
    })) as bigint;
    const health = assessHealth({
      follower: follower.address,
      lead,
      collateralRatioBps: Number(cr),
      liquidateBps: Number(liq),
    });
    console.log(
      `[health-monitor] cycle=${i} follower=${follower.address} cr=${cr} status=${health.status}`,
    );
    if (health.status === "Liquidation Risk") {
      await sendAlert({
        type: "liquidation_risk",
        lead,
        follower: follower.address,
        message: `CR ${cr} below alert ${health.alertBps}`,
      });
    }
    i += 1;
    if (maxCycles > 0 && i >= maxCycles) break;
    await new Promise((r) => setTimeout(r, interval));
  }
  console.log("health-monitor done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
