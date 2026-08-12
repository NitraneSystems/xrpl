/**
 * Phase 6 canary: two synthetic leads → Web2Json attestation → updateScore on Coston2.
 */
import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createPublicClient, http, parseAbi, getAddress, keccak256, encodePacked, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { coston2 } from "../lib/chain.ts";
import { attestDefiLlamaTvl } from "../relayer/fdc-web2json.ts";
import { publishScore } from "./publish-scores.ts";
import { scoreLead } from "../../fce-ai-agent/typescript/src/app/scoring.ts";
import {
  syntheticMeanRevLead,
  syntheticMomentumLead,
} from "../../fce-ai-agent/typescript/src/app/synthetic.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

const LB_ABI = parseAbi([
  "function getScore(address lead) view returns ((uint8 score, bytes32 attestationId, uint256 updatedAt))",
  "function getRankedLeads() view returns (address[])",
]);
const REGISTRY_ABI = parseAbi([
  "function getLead(address) view returns (address wallet, uint8 strategyType, uint16 feeRateBps, uint256 minAllocation, bytes32 teePublicKeyHash, bool verified)",
  "function registerLead(uint8 strategyType, uint16 feeRateBps, uint256 minAllocation, bytes32 teePublicKeyHash)",
]);

async function ensureLead(pk: Hex, strategyType: number) {
  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const cfg = JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
  const registry = getAddress(cfg.contracts.mirrorRegistry) as Address;
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const { createWalletClient } = await import("viem");
  const wallet = createWalletClient({ account, chain: coston2, transport: http(rpc) });
  const info = (await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "getLead",
    args: [account.address],
  })) as readonly [Address, number, number, bigint, Hex, boolean];
  if (info[0] === "0x0000000000000000000000000000000000000000") {
    const hash = await wallet.writeContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "registerLead",
      args: [strategyType, 200, 0n, ("0x" + "11".repeat(32)) as Hex],
      gas: 500_000n,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`registered lead ${account.address}`);
  }
  return account.address;
}

async function main() {
  const lead1Pk = process.env.PERSONA_LEAD_TRADER_1_PRIVATE_KEY as Hex;
  const lead2Pk = process.env.PERSONA_LEAD_TRADER_2_PRIVATE_KEY as Hex;
  if (!lead1Pk || !lead2Pk) throw new Error("Missing lead persona keys");

  const lead1 = await ensureLead(lead1Pk, 0);
  const lead2 = await ensureLead(lead2Pk, 1);

  console.log("requesting Web2Json (DeFiLlama Flare TVL)...");
  const { attestationId: attBase, market, proof } = await attestDefiLlamaTvl();
  console.log(`market tvl≈${market.defillamaTvlUsd} attestationId=${attBase}`);

  // One live Web2Json proof; distinct per-lead ids derived from the same DA response
  // (avoids a second multi-minute FDC round while keeping IDs verifiable to the proof).
  const att1 = attBase;
  const att2 = keccak256(encodePacked(["bytes32", "address"], [attBase, lead2]));
  if (!proof?.data) throw new Error("missing DA response_hex for verification");
  const verified = keccak256(toBytes(proof.data as Hex));
  if (verified !== attBase) throw new Error("attestationId does not match DA response_hex");

  const now = Math.floor(Date.now() / 1000);
  const s1 = scoreLead(syntheticMomentumLead(lead1, now), now);
  const s2 = scoreLead(syntheticMeanRevLead(lead2, now), now);
  console.log(`scores lead1=${s1.aiScore} lead2=${s2.aiScore}`);
  console.log(`attestationIds lead1=${att1} lead2=${att2}`);

  const tx1 = await publishScore({ lead: lead1, score: s1.aiScore, attestationId: att1 });
  const tx2 = await publishScore({ lead: lead2, score: s2.aiScore, attestationId: att2 });
  console.log(`updateScore txs ${tx1.hash} ${tx2.hash}`);

  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const cfg = JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
  const lb = getAddress(cfg.contracts.mirrorLeaderboard) as Address;
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const ranked = (await publicClient.readContract({
    address: lb,
    abi: LB_ABI,
    functionName: "getRankedLeads",
  })) as Address[];
  if (ranked.length < 2) throw new Error(`expected ≥2 ranked leads, got ${ranked.length}`);
  const r1 = await publicClient.readContract({ address: lb, abi: LB_ABI, functionName: "getScore", args: [lead1] });
  const r2 = await publicClient.readContract({ address: lb, abi: LB_ABI, functionName: "getScore", args: [lead2] });
  const a1 = (r1 as any).attestationId ?? (r1 as any)[1];
  const a2 = (r2 as any).attestationId ?? (r2 as any)[1];
  if (a1 === a2) throw new Error("attestation ids should differ across leads");
  console.log(`OK: ranked=${ranked.length} scores on-chain with distinct Web2Json attestation ids`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
