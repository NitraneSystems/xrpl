import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getAddress, type Address } from "viem";
import { loadConfig, loadSenderAbi, relaySwapProof } from "./fdc.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

function arg(name: string) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env[name.toUpperCase().replace(/-/g, "_")];
}

async function main() {
  const txHash = arg("tx") ?? arg("tx-hash") ?? process.env.TX_HASH;
  const fillIdRaw = arg("fill-id") ?? process.env.FILL_ID;
  if (!txHash) throw new Error("Usage: tsx relayer/fdc-proof-relayer.ts --tx <hash> --fill-id <n>");
  if (fillIdRaw === undefined) throw new Error("Missing --fill-id");

  const cfg = loadConfig();
  const senderAddr = getAddress(cfg.contracts.instructionSender) as Address;
  const { proof, publicClient, wallet } = await relaySwapProof(txHash);
  const abi = loadSenderAbi();
  const fillId = BigInt(fillIdRaw);

  const hash = await wallet.writeContract({
    address: senderAddr,
    abi,
    functionName: "applyFdcSettlement",
    args: [fillId, proof],
    gas: 2_000_000n,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`applyFdcSettlement fill=${fillId} proofTx=${txHash} settleTx=${hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
