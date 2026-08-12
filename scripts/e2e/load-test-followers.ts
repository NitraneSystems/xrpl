/**
 * Phase 11 — multi-follower Stage B fan-out load test (1 lead + 5 followers).
 * Not run in PR CI by default; invoke via `npm run e2e:load-followers`.
 */
import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import { HDNodeWallet, Mnemonic } from "ethers";
import { getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { handleMirrorMatchStageB } from "../../fce-matching-engine/typescript/src/app/handlers.ts";
import { bytesToHex, hexToBytes } from "../../fce-matching-engine/typescript/src/base/encoding.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

function jsonMsg(obj: unknown): string {
  return bytesToHex(Buffer.from(JSON.stringify(obj), "utf-8"));
}

function resolveFollowerAddress(envKey: string, mnemonicIndex: number): string {
  const pk = process.env[envKey] as Hex | undefined;
  if (pk) return getAddress(privateKeyToAccount(pk).address);

  const phrase = process.env.TESTNET_MNEMONIC?.trim();
  if (!phrase) {
    throw new Error(`Missing ${envKey} and TESTNET_MNEMONIC for follower derivation`);
  }
  const w = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(phrase), `m/44'/60'/0'/0/${mnemonicIndex}`);
  return getAddress(w.address);
}

async function main() {
  const cfg = JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
  const accounts = JSON.parse(readFileSync(join(ROOT, "config/accounts.testnet.json"), "utf8"));

  process.env.FCE_PLAINTEXT_DECRYPT_FALLBACK = "1";
  delete process.env.SIGN_PORT;
  process.env.MIRROR_MOCK_VENUES = "true";
  process.env.MOCK_ENOSYS_CDP_ADDRESS =
    process.env.MOCK_ENOSYS_CDP_ADDRESS ?? cfg.contracts.mockEnosysCDP;
  process.env.MOCK_FIRELIGHT_STRATEGY_ADDRESS =
    process.env.MOCK_FIRELIGHT_STRATEGY_ADDRESS ?? cfg.contracts.mockFirelightStrategy;
  process.env.MOCK_SPARKDEX_ROUTER_ADDRESS =
    process.env.MOCK_SPARKDEX_ROUTER_ADDRESS ?? cfg.contracts.mockSparkDexRouter;
  process.env.FLARE_RPC_URL =
    process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";

  const lead = getAddress(accounts.personas["lead-trader-1"].address);

  // Indices: provision maps follower-evm-1..3 → 3..5; 4/5 → 9/10 (see generate-personas.ts)
  const followers = [
    { address: resolveFollowerAddress("PERSONA_FOLLOWER_EVM_1_PRIVATE_KEY", 3), allocationBps: 1000 },
    { address: resolveFollowerAddress("PERSONA_FOLLOWER_EVM_2_PRIVATE_KEY", 4), allocationBps: 1500 },
    { address: resolveFollowerAddress("PERSONA_FOLLOWER_EVM_3_PRIVATE_KEY", 5), allocationBps: 2000 },
    { address: resolveFollowerAddress("PERSONA_FOLLOWER_EVM_4_PRIVATE_KEY", 9), allocationBps: 2500 },
    { address: resolveFollowerAddress("PERSONA_FOLLOWER_EVM_5_PRIVATE_KEY", 10), allocationBps: 3000 },
  ];

  if (followers.length < 5) throw new Error("Need ≥5 followers");

  console.log("=== e2e:load-followers (Stage B fan-out) ===");
  console.log(`lead=${lead}`);
  for (const f of followers) {
    console.log(`  follower ${f.address} alloc=${f.allocationBps}bps`);
  }

  const r = await handleMirrorMatchStageB(
    jsonMsg({
      venue: "enosys-cdp",
      sizePct: 1000,
      lead,
      followers,
    }),
  );

  if (r[1] !== 1) {
    throw new Error(`Stage B failed: ${r[2]}`);
  }

  const payload = JSON.parse(Buffer.from(hexToBytes(r[0]!)).toString("utf-8")) as {
    fanOut?: boolean;
    instructions?: Array<{ recipient: string; to: string; data: string; amountIn: string }>;
    venue?: string;
  };

  if (!payload.fanOut) throw new Error("expected fanOut:true payload");
  if (!payload.instructions || payload.instructions.length !== 5) {
    throw new Error(`expected 5 sized instructions, got ${payload.instructions?.length ?? 0}`);
  }
  if (payload.venue !== "enosys-cdp") throw new Error(`unexpected venue ${payload.venue}`);

  const amounts = payload.instructions.map((i) => BigInt(i.amountIn));
  // Varying allocations → distinct notionals (1000:1500:2000:2500:3000)
  const unique = new Set(amounts.map(String));
  if (unique.size !== 5) {
    throw new Error(`expected 5 distinct amountIn values from varying allocations, got ${unique.size}`);
  }

  console.log("OK: 5 follower instruction payloads with varying allocations");
  console.log(`venue=${payload.venue} to=${payload.instructions[0]!.to}`);
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
