/**
 * Pause the stale matching TEE machine so getRandomTeeIds only hits the live one.
 * LIVE  0xcC9c254C7aBF94A1654926B5fe4785861491Aff3  (after post-build)
 * STALE 0xd35Ee5Cc9e2a0fbbaFd3DCd754304ed3E9eEC4f0
 */
import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createPublicClient, createWalletClient, http, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2 } from "../lib/chain.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });
dotenv.config({ path: join(ROOT, "fce-matching-engine/.env") });
process.env.DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ??
  process.env.DEPLOYMENT_PRIVATE_KEY ??
  process.env.PERSONA_DEPLOYER_PRIVATE_KEY;

const DIAMOND = "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE" as Address;
const LIVE = "0xcC9c254C7aBF94A1654926B5fe4785861491Aff3" as Address;
const STALE = "0xd35Ee5Cc9e2a0fbbaFd3DCd754304ed3E9eEC4f0" as Address;
const ABI = parseAbi([
  "function getActiveTeeMachines(uint256 extensionId) view returns (address[] teeIds, string[] urls)",
  "function pause(address teeId)",
]);

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("missing deployer key");
  const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`);
  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: coston2, transport: http(rpc) });

  const before = await publicClient.readContract({
    address: DIAMOND,
    abi: ABI,
    functionName: "getActiveTeeMachines",
    args: [66187n],
  });
  console.log("active before", before[0].join(", "));

  const ids = before[0].map((a) => a.toLowerCase());
  if (!ids.includes(LIVE.toLowerCase())) {
    throw new Error(`live tee ${LIVE} is not active — do not pause`);
  }
  if (!ids.includes(STALE.toLowerCase())) {
    console.log("stale already inactive");
    return;
  }

  console.log(`pausing stale ${STALE} from ${account.address}`);
  const hash = await wallet.writeContract({
    address: DIAMOND,
    abi: ABI,
    functionName: "pause",
    args: [STALE],
    gas: 2_000_000n,
  });
  console.log("pause tx", hash);
  const rec = await publicClient.waitForTransactionReceipt({ hash });
  console.log("pause status", rec.status);
  if (rec.status !== "success") throw new Error("pause reverted");

  const after = await publicClient.readContract({
    address: DIAMOND,
    abi: ABI,
    functionName: "getActiveTeeMachines",
    args: [66187n],
  });
  console.log("active after", after[0].join(", ") || "(none)");
  if (after[0].some((a) => a.toLowerCase() === STALE.toLowerCase())) {
    throw new Error("stale still active after pause");
  }
  if (!after[0].some((a) => a.toLowerCase() === LIVE.toLowerCase())) {
    throw new Error("live tee missing after pause");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
