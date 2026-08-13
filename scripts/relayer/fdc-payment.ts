/**
 * FDC Payment attestation helpers (testXRP) for Flare Smart Accounts.
 */
import {
  clientsFromEnv,
  requestAttestation,
  waitForDaProof,
  toUtf8Bytes32,
  registryAddress,
} from "./fdc.ts";
import { type Hex, type Address, parseAbi, createPublicClient, http } from "viem";
import { coston2 } from "../lib/chain.ts";
import { decodeAbiParameters, hexToBytes } from "viem";

export type PaymentPrepareResult = {
  abiEncodedRequest: Hex;
  status?: string;
};

/**
 * Prepare a Payment attestation for an XRPL testnet payment.
 * Verifier path: /verifier/xrp/Payment/prepareRequest (testXRP source).
 */
export async function preparePaymentRequest(opts: {
  transactionId: string;
  inUtxo?: number | string;
  utxo?: number | string;
}): Promise<PaymentPrepareResult> {
  const verifierBase = (process.env.FDC_VERIFIER_URL ?? "https://fdc-verifiers-testnet.flare.network").replace(
    /\/$/,
    "",
  );
  const apiKey = process.env.FDC_VERIFIER_API_KEY || "00000000-0000-0000-0000-000000000000";
  const endpoint = `${verifierBase}/verifier/xrp/Payment/prepareRequest`;
  const txId = opts.transactionId.startsWith("0x") ? opts.transactionId : `0x${opts.transactionId}`;
  const request = {
    attestationType: toUtf8Bytes32("Payment"),
    sourceId: toUtf8Bytes32("testXRP"),
    requestBody: {
      transactionId: txId,
      inUtxo: String(opts.inUtxo ?? 0),
      utxo: String(opts.utxo ?? 0),
    },
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(`Payment prepareRequest failed ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as PaymentPrepareResult;
}

export type PaymentProof = {
  merkleProof: Hex[];
  data: {
    attestationType: Hex;
    sourceId: Hex;
    votingRound: bigint;
    lowestUsedTimestamp: bigint;
    requestBody: {
      transactionId: Hex;
      inUtxo: bigint;
      utxo: bigint;
    };
    responseBody: Record<string, unknown>;
  };
  responseHex: Hex;
  roundId: number;
  abiEncodedRequest: Hex;
};

const PAYMENT_RESPONSE_ABI = [
  {
    type: "tuple",
    components: [
      { name: "attestationType", type: "bytes32" },
      { name: "sourceId", type: "bytes32" },
      { name: "votingRound", type: "uint64" },
      { name: "lowestUsedTimestamp", type: "uint64" },
      {
        name: "requestBody",
        type: "tuple",
        components: [
          { name: "transactionId", type: "bytes32" },
          { name: "inUtxo", type: "uint256" },
          { name: "utxo", type: "uint256" },
        ],
      },
      {
        name: "responseBody",
        type: "tuple",
        components: [
          { name: "blockNumber", type: "uint64" },
          { name: "blockTimestamp", type: "uint64" },
          { name: "sourceAddressHash", type: "bytes32" },
          { name: "sourceAddressesRoot", type: "bytes32" },
          { name: "receivingAddressHash", type: "bytes32" },
          { name: "intendedReceivingAddressHash", type: "bytes32" },
          { name: "spentAmount", type: "int256" },
          { name: "intendedSpentAmount", type: "int256" },
          { name: "receivedAmount", type: "int256" },
          { name: "intendedReceivedAmount", type: "int256" },
          { name: "standardPaymentReference", type: "bytes32" },
          { name: "oneToOne", type: "bool" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

export function decodePaymentResponse(responseHex: string) {
  const hex = (responseHex.startsWith("0x") ? responseHex : `0x${responseHex}`) as Hex;
  try {
    return decodeAbiParameters(PAYMENT_RESPONSE_ABI, hex)[0];
  } catch {
    return decodeAbiParameters(PAYMENT_RESPONSE_ABI, (`0x${hex.slice(66)}`) as Hex)[0];
  }
}

/** Full Payment cycle: prepare → requestAttestation → DA proof. */
export async function attestXrplPayment(transactionId: string): Promise<PaymentProof> {
  const { publicClient, wallet, account } = clientsFromEnv();
  // Retry prepare until XRPL tx is visible to the verifier
  let prepared: PaymentPrepareResult | null = null;
  let lastErr = "";
  for (let i = 0; i < 12; i++) {
    prepared = await preparePaymentRequest({ transactionId });
    if (prepared.abiEncodedRequest) break;
    lastErr = JSON.stringify(prepared);
    console.log(`Payment prepare not ready (${i + 1}/12): ${lastErr}`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  if (!prepared?.abiEncodedRequest) {
    throw new Error(`Payment prepare missing abiEncodedRequest: ${lastErr}`);
  }
  const submitted = await requestAttestation(publicClient, wallet, account, prepared.abiEncodedRequest);
  const raw = await waitForDaProof(publicClient, prepared.abiEncodedRequest, submitted.roundId);
  const decoded = decodePaymentResponse(raw.response_hex);
  const merkleProof = (raw.proof ?? []) as Hex[];
  return {
    merkleProof,
    data: decoded as PaymentProof["data"],
    responseHex: (raw.response_hex.startsWith("0x") ? raw.response_hex : `0x${raw.response_hex}`) as Hex,
    roundId: submitted.roundId,
    abiEncodedRequest: prepared.abiEncodedRequest,
  };
}

export async function resolveMasterAccountController(): Promise<Address> {
  if (process.env.MASTER_ACCOUNT_CONTROLLER) {
    return process.env.MASTER_ACCOUNT_CONTROLLER as Address;
  }
  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  return (await registryAddress(publicClient, "MasterAccountController")) as Address;
}

/** IPayment.Proof — single tuple, not double-wrapped. Extra parens make viem read merkleProof on undefined. */
export const EXECUTE_INSTRUCTION_ABI = [
  "function executeInstruction((bytes32[] merkleProof,(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp,(bytes32 transactionId,uint256 inUtxo,uint256 utxo) requestBody,(uint64 blockNumber,uint64 blockTimestamp,bytes32 sourceAddressHash,bytes32 sourceAddressesRoot,bytes32 receivingAddressHash,bytes32 intendedReceivingAddressHash,int256 spentAmount,int256 intendedSpentAmount,int256 receivedAmount,int256 intendedReceivedAmount,bytes32 standardPaymentReference,bool oneToOne,uint8 status) responseBody) data) _proof, string _xrplAddress) payable",
] as const;

export const MASTER_ACCOUNT_ABI = parseAbi([
  "function getPersonalAccount(string _xrplOwner) view returns (address)",
  ...EXECUTE_INSTRUCTION_ABI,
  "function isTransactionIdUsed(bytes32 _transactionId) view returns (bool)",
  "function getInstructionFee(uint256 _instructionId) view returns (uint256)",
  "function getDefaultInstructionFee() view returns (uint256)",
]);

function pick(obj: any, key: string, idx: number) {
  if (obj == null) return undefined;
  if (obj[key] !== undefined) return obj[key];
  return obj[idx];
}

/** Normalize DA/decode shapes into the IPayment.Proof object viem expects. */
export function toPaymentProofArg(proof: PaymentProof) {
  const data: any = proof.data;
  const rb = pick(data, "requestBody", 4) ?? {};
  const body = pick(data, "responseBody", 5) ?? {};
  const merkle = Array.isArray(proof.merkleProof)
    ? proof.merkleProof
    : Array.isArray((proof as any).proof)
      ? (proof as any).proof
      : [];
  return {
    merkleProof: merkle,
    data: {
      attestationType: pick(data, "attestationType", 0),
      sourceId: pick(data, "sourceId", 1),
      votingRound: BigInt(pick(data, "votingRound", 2) ?? 0),
      lowestUsedTimestamp: BigInt(pick(data, "lowestUsedTimestamp", 3) ?? 0),
      requestBody: {
        transactionId: pick(rb, "transactionId", 0),
        inUtxo: BigInt(pick(rb, "inUtxo", 1) ?? 0),
        utxo: BigInt(pick(rb, "utxo", 2) ?? 0),
      },
      responseBody: {
        blockNumber: BigInt(pick(body, "blockNumber", 0) ?? 0),
        blockTimestamp: BigInt(pick(body, "blockTimestamp", 1) ?? 0),
        sourceAddressHash: pick(body, "sourceAddressHash", 2),
        sourceAddressesRoot: pick(body, "sourceAddressesRoot", 3),
        receivingAddressHash: pick(body, "receivingAddressHash", 4),
        intendedReceivingAddressHash: pick(body, "intendedReceivingAddressHash", 5),
        spentAmount: BigInt(pick(body, "spentAmount", 6) ?? 0),
        intendedSpentAmount: BigInt(pick(body, "intendedSpentAmount", 7) ?? 0),
        receivedAmount: BigInt(pick(body, "receivedAmount", 8) ?? 0),
        intendedReceivedAmount: BigInt(pick(body, "intendedReceivedAmount", 9) ?? 0),
        standardPaymentReference: pick(body, "standardPaymentReference", 10),
        oneToOne: Boolean(pick(body, "oneToOne", 11)),
        status: Number(pick(body, "status", 12) ?? 0),
      },
    },
  };
}

async function cli() {
  const txId = process.argv[2];
  if (!txId) {
    console.error("Usage: tsx relayer/fdc-payment.ts <xrplTxHash>");
    process.exit(1);
  }
  const proof = await attestXrplPayment(txId);
  console.log(
    JSON.stringify(
      {
        roundId: proof.roundId,
        paymentReference: (proof.data as any).responseBody?.standardPaymentReference,
        status: (proof.data as any).responseBody?.status,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1]?.includes("fdc-payment")) {
  cli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
