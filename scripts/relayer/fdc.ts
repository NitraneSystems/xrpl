import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2 } from "../lib/chain.ts";
import { AbiCoder } from "ethers";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const FLARE_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as Address;

const REGISTRY_ABI = parseAbi(["function getContractAddressByName(string) view returns (address)"]);
const FDC_HUB_ABI = parseAbi(["function requestAttestation(bytes data) payable"]);
const FDC_FEE_ABI = parseAbi(["function getRequestFee(bytes _data) view returns (uint256)"]);
const SYSTEMS_ABI = parseAbi([
  "function firstVotingRoundStartTs() view returns (uint64)",
  "function votingEpochDurationSeconds() view returns (uint64)",
]);
const RELAY_ABI = parseAbi(["function isFinalized(uint256 protocolId, uint256 votingRoundId) view returns (bool)"]);
const FDC_VERIF_ABI = parseAbi(["function fdcProtocolId() view returns (uint8)"]);

const RESPONSE_TUPLE =
  "tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, tuple(bytes32 transactionHash, uint16 requiredConfirmations, bool provideInput, bool listEvents, uint32[] logIndices) requestBody, tuple(uint64 blockNumber, uint64 timestamp, address sourceAddress, bool isDeployment, address receivingAddress, uint256 value, bytes input, uint8 status, tuple(uint32 logIndex, address emitterAddress, bytes32[] topics, bytes data, bool removed)[] events) responseBody)";

export function toUtf8Bytes32(s: string): Hex {
  let hex = "";
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(2, "0");
  return `0x${hex.padEnd(64, "0")}` as Hex;
}

export function loadConfig() {
  return JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
}

export function loadSenderAbi() {
  const artifact = JSON.parse(
    readFileSync(join(ROOT, "contracts/artifacts/src/InstructionSender.sol/InstructionSender.json"), "utf8")
  );
  return artifact.abi;
}

export function clientsFromEnv() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PERSONA_DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("Missing DEPLOYER_PRIVATE_KEY");
  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const account = privateKeyToAccount(pk as Hex);
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: coston2, transport: http(rpc) });
  return { account, publicClient, wallet, rpc };
}

export async function registryAddress(publicClient: ReturnType<typeof createPublicClient>, name: string) {
  return (await publicClient.readContract({
    address: FLARE_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByName",
    args: [name],
  })) as Address;
}

export async function prepareEvmTxRequest(transactionHash: string) {
  const verifierBase = (process.env.FDC_VERIFIER_URL ?? "https://fdc-verifiers-testnet.flare.network").replace(
    /\/$/,
    ""
  );
  const apiKey = process.env.FDC_VERIFIER_API_KEY || "00000000-0000-0000-0000-000000000000";
  const url = `${verifierBase}/verifier/flr/EVMTransaction/prepareRequest`;
  const body = {
    attestationType: toUtf8Bytes32("EVMTransaction"),
    sourceId: toUtf8Bytes32("testFLR"),
    requestBody: {
      transactionHash,
      requiredConfirmations: "1",
      provideInput: true,
      listEvents: true,
      logIndices: [],
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`prepareRequest failed ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return (await res.json()) as { abiEncodedRequest: Hex; status?: string };
}

export async function requestAttestation(
  publicClient: ReturnType<typeof createPublicClient>,
  wallet: ReturnType<typeof createWalletClient>,
  account: { address: Address } & Record<string, unknown>,
  abiEncodedRequest: Hex
) {
  const fdcHub = await registryAddress(publicClient, "FdcHub");
  const feeCfg = await registryAddress(publicClient, "FdcRequestFeeConfigurations");
  const fee = (await publicClient.readContract({
    address: feeCfg,
    abi: FDC_FEE_ABI,
    functionName: "getRequestFee",
    args: [abiEncodedRequest],
  })) as bigint;

  const hash = await wallet.writeContract({
    address: fdcHub,
    abi: FDC_HUB_ABI,
    functionName: "requestAttestation",
    args: [abiEncodedRequest],
    value: fee,
    gas: 1_000_000n,
    account: account as never,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`requestAttestation reverted tx=${hash}`);
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

  const systems = await registryAddress(publicClient, "FlareSystemsManager");
  const first = (await publicClient.readContract({
    address: systems,
    abi: SYSTEMS_ABI,
    functionName: "firstVotingRoundStartTs",
  })) as bigint;
  const duration = (await publicClient.readContract({
    address: systems,
    abi: SYSTEMS_ABI,
    functionName: "votingEpochDurationSeconds",
  })) as bigint;
  const roundId = Number((block.timestamp - first) / duration);
  return { hash, roundId, fee };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function asHex(v: unknown, fallback = "0x"): Hex {
  if (typeof v === "string" && v.startsWith("0x")) return v as Hex;
  if (typeof v === "string") return `0x${v}` as Hex;
  return fallback as Hex;
}

function asBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return BigInt(v);
  return 0n;
}

export function decodeEvmTxResponse(responseHex: string) {
  const coder = AbiCoder.defaultAbiCoder();
  const hex = responseHex.startsWith("0x") ? responseHex : `0x${responseHex}`;
  let raw: any;
  try {
    raw = coder.decode([RESPONSE_TUPLE], hex)[0];
  } catch {
    raw = coder.decode([RESPONSE_TUPLE], ("0x" + hex.slice(66)) as string)[0];
  }
  const rb = raw.requestBody ?? raw[4];
  const body = raw.responseBody ?? raw[5];
  const eventsIn = body.events ?? body[8] ?? [];
  const events = [...eventsIn].map((ev: any) => ({
    logIndex: Number(ev.logIndex ?? ev[0] ?? 0),
    emitterAddress: (ev.emitterAddress ?? ev[1]) as Address,
    topics: [...(ev.topics ?? ev[2] ?? [])] as Hex[],
    data: asHex(ev.data ?? ev[3], "0x"),
    removed: Boolean(ev.removed ?? ev[4] ?? false),
  }));
  return {
    attestationType: asHex(raw.attestationType ?? raw[0]),
    sourceId: asHex(raw.sourceId ?? raw[1]),
    votingRound: asBig(raw.votingRound ?? raw[2]),
    lowestUsedTimestamp: asBig(raw.lowestUsedTimestamp ?? raw[3]),
    requestBody: {
      transactionHash: asHex(rb.transactionHash ?? rb[0]),
      requiredConfirmations: Number(rb.requiredConfirmations ?? rb[1] ?? 1),
      provideInput: Boolean(rb.provideInput ?? rb[2]),
      listEvents: Boolean(rb.listEvents ?? rb[3]),
      logIndices: [...(rb.logIndices ?? rb[4] ?? [])].map((n: unknown) => Number(n)),
    },
    responseBody: {
      blockNumber: asBig(body.blockNumber ?? body[0]),
      timestamp: asBig(body.timestamp ?? body[1]),
      sourceAddress: (body.sourceAddress ?? body[2]) as Address,
      isDeployment: Boolean(body.isDeployment ?? body[3]),
      receivingAddress: (body.receivingAddress ?? body[4]) as Address,
      value: asBig(body.value ?? body[5]),
      input: asHex(body.input ?? body[6], "0x"),
      status: Number(body.status ?? body[7] ?? 0),
      events,
    },
  };
}

export async function waitForDaProof(
  publicClient: ReturnType<typeof createPublicClient>,
  abiEncodedRequest: Hex,
  roundId: number
): Promise<{ response_hex: string; proof: Hex[] }> {
  const daBase = (process.env.FDC_DA_LAYER_URL ?? "https://ctn2-data-availability.flare.network").replace(/\/$/, "");
  const url = `${daBase}/api/v1/fdc/proof-by-request-round-raw`;
  const relay = await registryAddress(publicClient, "Relay");
  const verif = await registryAddress(publicClient, "FdcVerification");
  const protocolId = (await publicClient.readContract({
    address: verif,
    abi: FDC_VERIF_ABI,
    functionName: "fdcProtocolId",
  })) as number;

  const deadline = Date.now() + 8 * 60 * 1000;
  while (!(await publicClient.readContract({
    address: relay,
    abi: RELAY_ABI,
    functionName: "isFinalized",
    args: [protocolId, BigInt(roundId)],
  }))) {
    if (Date.now() > deadline) throw new Error(`round ${roundId} not finalized in time`);
    console.log(`waiting for FDC round ${roundId} to finalize...`);
    await sleep(10_000);
  }

  const payload = { votingRoundId: roundId, requestBytes: abiEncodedRequest };
  let proof: { response_hex?: string; proof?: Hex[] } = {};
  for (let i = 0; i < 36; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    proof = (await res.json()) as { response_hex?: string; proof?: Hex[]; merkleProof?: Hex[] };
    if (proof.response_hex) break;
    console.log("waiting for DA layer proof...");
    await sleep(5_000);
  }
  if (!proof.response_hex) throw new Error("DA layer did not return response_hex");
  return { response_hex: proof.response_hex, proof: proof.proof ?? proof.merkleProof ?? [] };
}

export async function retrieveProof(
  publicClient: ReturnType<typeof createPublicClient>,
  abiEncodedRequest: Hex,
  roundId: number
) {
  const raw = await waitForDaProof(publicClient, abiEncodedRequest, roundId);
  return {
    merkleProof: raw.proof,
    data: decodeEvmTxResponse(raw.response_hex),
  };
}

export async function relaySwapProof(txHash: string) {
  const { publicClient, wallet, account } = clientsFromEnv();
  const prepared = await prepareEvmTxRequest(txHash);
  console.log("prepared FDC request");
  const submitted = await requestAttestation(publicClient, wallet, account, prepared.abiEncodedRequest);
  console.log(`attestation submitted round=${submitted.roundId} tx=${submitted.hash}`);
  const proof = await retrieveProof(publicClient, prepared.abiEncodedRequest, submitted.roundId);
  return { proof, roundId: submitted.roundId, account, publicClient, wallet };
}
