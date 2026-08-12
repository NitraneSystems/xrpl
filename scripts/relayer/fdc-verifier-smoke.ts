/**
 * Quick smoke: Flare-hosted FDC verifier accepts the public testnet API key.
 * Does NOT wait for voting rounds — only prepareRequest HTTP calls.
 */
import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { prepareWeb2JsonRequest } from "./fdc-web2json.ts";
import { prepareEvmTxRequest } from "./fdc.ts";
import { createPublicClient, http } from "viem";
import { coston2 } from "../lib/chain.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

async function main() {
  const key = process.env.FDC_VERIFIER_API_KEY ?? "00000000-0000-0000-0000-000000000000";
  const verifier = process.env.FDC_VERIFIER_URL ?? "https://fdc-verifiers-testnet.flare.network";
  console.log("=== FDC verifier smoke ===");
  console.log(`verifier: ${verifier}`);
  console.log(`api key:  ${key.slice(0, 8)}…${key.slice(-4)}`);

  // 1) Web2Json prepare (Phase 6 AI scores)
  const w2j = await prepareWeb2JsonRequest({
    url: `${(process.env.DEFILLAMA_API_BASE || "https://api.llama.fi").replace(/\/$/, "")}/v2/historicalChainTvl/Flare`,
    postProcessJq: ".|length",
    abiSignature: "uint256",
  });
  if (!w2j.abiEncodedRequest || w2j.abiEncodedRequest.length < 10) {
    throw new Error("Web2Json prepareRequest returned empty abiEncodedRequest");
  }
  console.log(`OK Web2Json prepareRequest (${w2j.abiEncodedRequest.length} chars)`);

  // 2) EVMTransaction prepare (Phase 5 settlement proofs) — use latest block tx if any
  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const client = createPublicClient({ chain: coston2, transport: http(rpc) });
  const block = await client.getBlock({ blockNumber: await client.getBlockNumber(), includeTransactions: true });
  const txHash =
    typeof block.transactions[0] === "string"
      ? block.transactions[0]
      : block.transactions[0]?.hash;
  if (!txHash) throw new Error("no txs in latest block for EVMTransaction prepare smoke");

  const evm = await prepareEvmTxRequest(txHash);
  if (!evm.abiEncodedRequest || evm.abiEncodedRequest.length < 10) {
    throw new Error("EVMTransaction prepareRequest returned empty abiEncodedRequest");
  }
  console.log(`OK EVMTransaction prepareRequest for ${txHash.slice(0, 14)}…`);

  console.log("\nPASS: public FDC verifier API key works for Mirror's prepareRequest paths.");
  console.log("Note: full attestation (request → voting → DA proof) still needs C2FLR gas + ~minutes per round.");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
