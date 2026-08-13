/**
 * Live matching FCE canary: /info → SAY_HELLO → MATCH_V1 (encrypted) → executeMatch.
 *
 *   EXT_PROXY_URL=https://<matching-trycloudflare> npx tsx relayer/matching-tee-canary.ts
 */
import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getAddress, parseAbi, type Address, type Hex } from "viem";
import { clientsFromEnv } from "./fdc.ts";
import { encryptSignal } from "../../frontend/src/lib/encrypt.ts";
import { encryptPubKeyFromInfo } from "../../frontend/src/lib/fcc.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });
dotenv.config({ path: join(ROOT, "fce-matching-engine/.env") });
process.env.DEPLOYER_PRIVATE_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ??
  process.env.DEPLOYMENT_PRIVATE_KEY ??
  process.env.PERSONA_DEPLOYER_PRIVATE_KEY;
process.env.FLARE_RPC_URL = process.env.FLARE_RPC_URL ?? process.env.CHAIN_URL;

const SENDER = "0xf082D53B50D08f0fdC06B0B4C6A1932DB589d91f" as Address;
const DIAMOND = "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE" as Address;
const FEE = 1_000_000n;
const LEAD = "0x37Ba335E06256B1D5A00Aa28dbfB7745018343Ee" as Address;
const FOLLOWER = "0x1aB90B97dF1A3A1743BbFE1fCd1C8833f444b77f" as Address;

const ABI = parseAbi([
  "function sendSayHello(bytes message) payable returns (bytes32 instructionId)",
  "function sendMirrorMatchStageB(bytes encryptedSignal) payable returns (bytes32 instructionId)",
]);

function jsonToHex(obj: unknown): Hex {
  return `0x${Buffer.from(JSON.stringify(obj), "utf8").toString("hex")}` as Hex;
}

function instructionIdFromReceipt(receipt: {
  logs: readonly { address: string; topics: readonly Hex[]; data: Hex }[];
}): Hex | null {
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== DIAMOND.toLowerCase()) continue;
    for (const t of l.topics.slice(1)) {
      if (BigInt(t) > 1_000_000n) return t;
    }
  }
  return null;
}

function decodeData(data: unknown): unknown {
  if (data == null) return null;
  const raw = typeof data === "string" ? data : JSON.stringify(data);
  try {
    const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
    return JSON.parse(Buffer.from(hex, "hex").toString("utf8"));
  } catch {
    return raw;
  }
}

async function fetchTeeResult(proxyUrl: string, instructionId: Hex) {
  const url = `${proxyUrl}/action/result/${instructionId}`;
  for (let i = 0; i < 40; i++) {
    const res = await fetch(url);
    if (res.ok) {
      const body = (await res.json()) as {
        result?: { status?: number; log?: string; data?: unknown };
      };
      const result = body.result ?? (body as { status?: number; log?: string; data?: unknown });
      const status = result.status;
      if (status === 1) return { status, data: result.data, log: result.log };
      if (status === 0) {
        throw new Error(`TEE status 0: ${result.log ?? JSON.stringify(result)}`);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timeout waiting for TEE result ${instructionId}`);
}

async function sendAndWait(
  label: string,
  hash: Hex,
  publicClient: ReturnType<typeof clientsFromEnv>["publicClient"],
  proxyUrl: string,
) {
  console.log(`${label} tx ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  const instructionId = instructionIdFromReceipt(receipt);
  if (!instructionId) throw new Error(`${label}: no instruction id`);
  console.log(`${label} instruction ${instructionId}`);
  const tee = await fetchTeeResult(proxyUrl, instructionId);
  const decoded = decodeData(tee.data);
  console.log(`${label} status=${tee.status} log=${tee.log} result=${JSON.stringify(decoded)}`);
  return { instructionId, decoded, hash };
}

async function main() {
  const proxyUrl = (
    process.env.EXT_PROXY_URL ||
    process.env.MATCHING_TEE_PROXY_URL ||
    ""
  ).replace(/\/$/, "");
  if (!proxyUrl) throw new Error("Set EXT_PROXY_URL to the matching tunnel");

  const infoRes = await fetch(`${proxyUrl}/info`);
  if (!infoRes.ok) throw new Error(`/info HTTP ${infoRes.status}`);
  const info = (await infoRes.json()) as Record<string, unknown>;
  const pub = encryptPubKeyFromInfo(info);
  if (!pub) throw new Error("/info has no secp256k1 publicKey");
  const machine = (info.machineData ?? {}) as { extensionId?: string };
  console.log(`proxy ${proxyUrl}`);
  console.log(`extensionId ${machine.extensionId ?? "?"}`);
  console.log(`encryptPubKey ${pub.slice(0, 18)}…`);

  const { publicClient, wallet, account } = clientsFromEnv();
  console.log(`from ${account.address}`);

  const helloHash = await wallet.writeContract({
    address: SENDER,
    abi: ABI,
    functionName: "sendSayHello",
    args: [jsonToHex({ name: "MirrorCanary" })],
    value: FEE,
    gas: 3_000_000n,
  });
  await sendAndWait("SAY_HELLO", helloHash as Hex, publicClient, proxyUrl);

  const encrypted = await encryptSignal(
    {
      asset: "FXRP",
      direction: "SELL",
      sizePct: 10,
      nonce: `canary-${Date.now()}`,
      recipient: FOLLOWER,
      lead: LEAD,
    },
    pub,
  );
  const matchHash = await wallet.writeContract({
    address: SENDER,
    abi: ABI,
    functionName: "sendMirrorMatchStageB",
    args: [encrypted],
    value: FEE,
    gas: 3_000_000n,
  });
  await sendAndWait("MATCH_V1", matchHash as Hex, publicClient, proxyUrl);
  console.log("OK matching TEE canary (SAY_HELLO + MATCH_V1). Frontend fill still needs the lead wallet.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
