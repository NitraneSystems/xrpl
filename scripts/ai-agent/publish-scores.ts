import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createPublicClient, createWalletClient, http, parseAbi, getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2 } from "../lib/chain.ts";
import { readFileSync } from "fs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

const LB_ABI = parseAbi([
  "function updateScore(address lead, uint8 score, bytes32 attestationId)",
  "function getScore(address lead) view returns ((uint8 score, bytes32 attestationId, uint256 updatedAt))",
  "function getRankedLeads() view returns (address[])",
]);

export async function publishScore(opts: {
  lead: Address;
  score: number;
  attestationId: Hex;
}) {
  const pk = process.env.PERSONA_AI_AGENT_SIGNER_PRIVATE_KEY;
  if (!pk) throw new Error("Missing PERSONA_AI_AGENT_SIGNER_PRIVATE_KEY");
  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const cfg = JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
  const lb = getAddress(cfg.contracts.mirrorLeaderboard) as Address;
  const account = privateKeyToAccount(pk as Hex);
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: coston2, transport: http(rpc) });

  if (opts.score < 0 || opts.score > 100) throw new Error("score out of range");

  const hash = await wallet.writeContract({
    address: lb,
    abi: LB_ABI,
    functionName: "updateScore",
    args: [opts.lead, opts.score, opts.attestationId],
    gas: 500_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`updateScore reverted ${hash}`);
  return { hash, leaderboard: lb };
}

async function main() {
  const lead = (process.argv[2] ?? process.env.LEAD) as Address | undefined;
  const score = Number(process.argv[3] ?? process.env.SCORE ?? "0");
  const attestationId = (process.argv[4] ?? process.env.ATTESTATION_ID) as Hex | undefined;
  if (!lead || !attestationId) {
    throw new Error("Usage: tsx ai-agent/publish-scores.ts <lead> <score> <attestationId>");
  }
  const r = await publishScore({ lead: getAddress(lead), score, attestationId });
  console.log(`published score=${score} lead=${lead} tx=${r.hash}`);
}

if (process.argv[1]?.includes("publish-scores")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
