/**
 * ★ MAIN CUSTOMIZATION POINT: your extension's handlers.
 *
 * Mirrors go/internal/extension/extension.go. Each handler follows the same
 * 4-step pattern: decode, validate, execute, respond.
 *
 * Handler contract:
 *   (originalMessageHex) => [dataHexOrNull, status, errorOrNull]
 *   status 0 = error, 1 = success. See docs/extension-contract.md §4.6.
 *
 * The framework serializes handler calls, so plain module-level state is safe.
 */

import { bytesToHex, hexToBytes } from "../base/encoding.js";
import type { Framework, HandlerResult } from "../base/types.js";
import { NodeClient } from "../base/node.js";

import { decodeSayGoodbye } from "./abi.js";
import {
  OP_COMMAND_SAY_GOODBYE,
  OP_COMMAND_SAY_HELLO,
  OP_COMMAND_MATCH_V1,
  OP_TYPE_MIRROR,
  OP_TYPE_GREETING,
} from "./config.js";

// --- Extension state ---------------------------------------------------------
// Serialized by the framework; no locking needed here.
let greetingCount = 0;
let lastGreeting = "";
let farewellCount = 0;
let lastFarewell = "";

/** Reset all state. Used by tests; not part of the wire contract. */
export function resetState(): void {
  greetingCount = 0;
  lastGreeting = "";
  farewellCount = 0;
  lastFarewell = "";
}

/** Wire handlers to (opType, opCommand) pairs. */
export function register(framework: Framework): void {
  framework.handle(OP_TYPE_GREETING, OP_COMMAND_SAY_HELLO, handleSayHello);
  framework.handle(OP_TYPE_GREETING, OP_COMMAND_SAY_GOODBYE, handleSayGoodbye);
  framework.handle(OP_TYPE_MIRROR, OP_COMMAND_MATCH_V1, handleMirrorMatchStageB);
}

/** Snapshot returned by GET /state. Mirrors the Go State struct. */
export function reportState(): unknown {
  return {
    greetingCount,
    lastGreeting,
    farewellCount,
    lastFarewell,
  };
}

/** GREETING/SAY_HELLO — JSON payload {"name": "..."}. */
export function handleSayHello(msg: string): HandlerResult {
  // 1. Decode
  let raw: Uint8Array;
  try {
    raw = hexToBytes(msg);
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  let req: unknown;
  try {
    req = JSON.parse(Buffer.from(raw).toString("utf-8"));
  } catch (e) {
    return [null, 0, `decoding request: ${String(e)}`];
  }

  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    return [null, 0, "decoding request: expected a JSON object"];
  }

  // Match Go's DisallowUnknownFields.
  const unknown = Object.keys(req).filter((k) => k !== "name").sort();
  if (unknown.length > 0) {
    return [null, 0, `decoding request: unknown field "${unknown[0]}"`];
  }

  // 2. Validate
  const name = (req as { name?: unknown }).name;
  if (typeof name !== "string" || name === "") {
    return [null, 0, "name must not be empty"];
  }

  // 3. Execute
  greetingCount++;
  const greeting = `Hello, ${name}! Welcome to Flare Confidential Compute.`;
  lastGreeting = greeting;

  // 4. Respond
  const resp = { greeting, greetingNumber: greetingCount };
  return [bytesToHex(Buffer.from(JSON.stringify(resp), "utf-8")), 1, null];
}

/** GREETING/SAY_GOODBYE — ABI-encoded (string name, string reason). */
export function handleSayGoodbye(msg: string): HandlerResult {
  // 1. Decode
  let hex: string;
  try {
    // Normalize through hexToBytes so malformed input fails here, not in viem.
    hex = bytesToHex(hexToBytes(msg));
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  let decoded: { name: string; reason: string };
  try {
    decoded = decodeSayGoodbye(hex as `0x${string}`);
  } catch (e) {
    return [null, 0, `decoding request: ${e instanceof Error ? e.message : String(e)}`];
  }

  // 2. Validate
  if (!decoded.name) {
    return [null, 0, "name must not be empty"];
  }

  // 3. Execute
  farewellCount++;
  const farewell = `Goodbye, ${decoded.name}! Reason: ${decoded.reason}`;
  lastFarewell = farewell;

  // 4. Respond
  const resp = { farewell, farewellNumber: farewellCount };
  return [bytesToHex(Buffer.from(JSON.stringify(resp), "utf-8")), 1, null];
}

function bytesToUint8Array(hex: string): Uint8Array {
  // Normalize through hexToBytes so malformed input fails fast.
  return hexToBytes(hex);
}

function safeJsonParse(buf: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(buf).toString("utf-8"));
  } catch {
    return null;
  }
}

/**
 * Mirror matching-engine Stage B.
 *
 * Contract expectations (MVP):
 * - handler receives `originalMessage` as hex-encoded bytes.
 * - those bytes are expected to be "encrypted signal bytes" and are decrypted
 *   inside TEE via tee-node `/decrypt` when available.
 * - the decrypted payload is JSON containing:
 *     { asset, direction, sizePct, nonce, follower?, lead?, recipient? }
 *
 * We intentionally avoid logging any decrypted/sensitive fields.
 */
export async function handleMirrorMatchStageB(msg: string): Promise<HandlerResult> {
  // --- 0) Decode hex originalMessage --------------------------------------
  let ciphertext: Uint8Array;
  try {
    ciphertext = bytesToUint8Array(msg);
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  // --- 1) Decrypt (best-effort) ------------------------------------------
  // In local smoke / unit environments there might be no tee-node; keep a
  // deterministic plaintext fallback gated by env var.
  const allowPlaintextFallback = process.env.FCE_PLAINTEXT_DECRYPT_FALLBACK === "1";
  const decryptEnabled = process.env.SIGN_PORT !== undefined;

  let plaintext: Uint8Array | null = null;

  if (decryptEnabled) {
    try {
      const node = new NodeClient(process.env.SIGN_PORT ?? "9091");
      plaintext = await node.decrypt(ciphertext);
    } catch (e) {
      if (!allowPlaintextFallback) {
        return [null, 0, `decrypt failed (and fallback disabled): ${e instanceof Error ? e.message : String(e)}`];
      }
      plaintext = ciphertext;
    }
  } else if (allowPlaintextFallback) {
    plaintext = ciphertext;
  } else {
    return [null, 0, "decrypt unavailable (no SIGN_PORT) and fallback disabled"];
  }

  const parsed: any = safeJsonParse(plaintext!);
  if (!parsed || typeof parsed !== "object") {
    return [null, 0, "decrypted payload: expected JSON object"];
  }

  // --- 2) Validate non-sensitive shape --------------------------------
  const asset = parsed.asset;
  const direction = parsed.direction;
  const sizePct = parsed.sizePct; // basis points out of 10_000
  const recipient = parsed.recipient;

  if (typeof asset !== "string" || (asset !== "FXRP" && asset !== "USDT0")) {
    return [null, 0, "signal.asset must be FXRP or USDT0"];
  }
  if (typeof direction !== "string" || (direction !== "BUY" && direction !== "SELL")) {
    return [null, 0, "signal.direction must be BUY or SELL"];
  }
  if (typeof sizePct !== "number" || !Number.isFinite(sizePct) || sizePct <= 0) {
    return [null, 0, "signal.sizePct must be a positive number (bps)"];
  }
  if (typeof recipient !== "string" || !recipient.startsWith("0x") || recipient.length !== 42) {
    return [null, 0, "signal.recipient must be a 20-byte hex address string"];
  }

  // --- 3) Read FTSO feed prices ----------------------------------------
  // NOTE: This runs inside the TEE; it must NOT print decrypted fields.
  const rpcUrl = process.env.FLARE_RPC_URL;
  if (!rpcUrl) return [null, 0, "missing FLARE_RPC_URL"];

  const { createPublicClient, http, getAddress, encodeFunctionData } = await import("viem");
  // viem's `Chain` type is stricter than what we need here.
  // For an MVP inside the TEE, we only require the chain id for encoding.
  const client = createPublicClient({ chain: { id: 114 } as any, transport: http(rpcUrl) });

  const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
  const REGISTRY_ABI = [
    {
      name: "getContractAddressByName",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "_name", type: "string" }],
      outputs: [{ name: "", type: "address" }],
    },
  ];

  const FTSO_ABI = [
    {
      name: "getFeedByIdInWei",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "_feedId", type: "bytes21" }],
      outputs: [
        { name: "valueWei", type: "uint256" },
        { name: "timestamp", type: "uint64" },
      ],
    },
  ];

  // bytes21 feed IDs (sourced from scripts/ftso/feedIds.ts):
  const FXRP_USD_FEED_ID = "0x015852502f55534400000000000000000000000000" as `0x${string}`;
  const USDT0_USD_FEED_ID = "0x01555344542f555344000000000000000000000000" as `0x${string}`;

  // Feed reads use the on-chain ContractRegistry indirection (no hardcoded oracle address).
  const ftsoV2 = (await client.readContract({
    address: getAddress(REGISTRY),
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByName",
    args: ["FtsoV2"],
  })) as `0x${string}`;

  await client.readContract({
    address: ftsoV2,
    abi: FTSO_ABI,
    functionName: "getFeedByIdInWei",
    args: [FXRP_USD_FEED_ID],
  });
  await client.readContract({
    address: ftsoV2,
    abi: FTSO_ABI,
    functionName: "getFeedByIdInWei",
    args: [USDT0_USD_FEED_ID],
  });

  // --- 4) Position sizing (MVP hardcap) -------------------------------
  // We model sizePct as bps out of 10_000 of a fixed notional cap.
  const sizePctBps = BigInt(Math.trunc(sizePct));
  const notionalCapWei = 1_000_000n * 10n ** 18n;
  const notionalWei = (notionalCapWei * sizePctBps) / 10_000n;
  if (notionalWei === 0n) return [null, 0, "sizing produced zero notional"];

  // Resolve token addresses via ContractRegistry (no reliance on env vars).
  const FXRP_ASSET_MANAGER = "AssetManagerFXRP";
  const USDT0_ASSET_MANAGER = "AssetManagerUSDT0";
  const ASSET_MANAGER_ABI = [
    {
      name: "fAsset",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "", type: "address" }],
    },
  ];

  let fxrpToken: `0x${string}`;
  let usdt0Token: `0x${string}`;

  // Optional env overrides (useful in TEE deployments where filesystem/config access differs).
  if (process.env.C2_FXRP_ADDRESS && process.env.C2_FXRP_ADDRESS.startsWith("0x")) {
    fxrpToken = getAddress(process.env.C2_FXRP_ADDRESS as `0x${string}`);
  } else {
    const assetManagerFxrp = (await client.readContract({
      address: getAddress(REGISTRY),
      abi: REGISTRY_ABI,
      functionName: "getContractAddressByName",
      args: [FXRP_ASSET_MANAGER],
    })) as `0x${string}`;
    fxrpToken = (await client.readContract({
      address: assetManagerFxrp,
      abi: ASSET_MANAGER_ABI,
      functionName: "fAsset",
      args: [],
    })) as `0x${string}`;
  }

  if (process.env.C2_USDT0_ADDRESS && process.env.C2_USDT0_ADDRESS.startsWith("0x")) {
    usdt0Token = getAddress(process.env.C2_USDT0_ADDRESS as `0x${string}`);
  } else {
    const assetManagerUsdt0 = (await client.readContract({
      address: getAddress(REGISTRY),
      abi: REGISTRY_ABI,
      functionName: "getContractAddressByName",
      args: [USDT0_ASSET_MANAGER],
    })) as `0x${string}`;
    usdt0Token = (await client.readContract({
      address: assetManagerUsdt0,
      abi: ASSET_MANAGER_ABI,
      functionName: "fAsset",
      args: [],
    })) as `0x${string}`;
  }

  const tokenIn = direction === "BUY" ? usdt0Token : fxrpToken;
  const tokenOut = direction === "BUY" ? fxrpToken : usdt0Token;

  // --- 5) Build exactInputSingle calldata -----------------------------
  // Swap Router ABI parity: Uniswap V3 exactInputSingle tokenIn/tokenOut.
  const exactInputSingleAbi = [
    {
      name: "exactInputSingle",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "tokenIn", type: "address" },
        { name: "tokenOut", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "recipient", type: "address" },
        { name: "deadline", type: "uint256" },
        { name: "amountIn", type: "uint256" },
        { name: "amountOutMinimum", type: "uint256" },
        { name: "sqrtPriceLimitX96", type: "uint160" },
      ],
      outputs: [{ name: "amountOut", type: "uint256" }],
    },
  ];

  const now = BigInt(Math.floor(Date.now() / 1000));
  const deadline = now + 300n;
  const fee = 3000n;
  const amountOutMinimum = 0n;
  const sqrtPriceLimitX96 = 0n;

  const recipientAddr = getAddress(recipient as `0x${string}`);
  const calldata = encodeFunctionData({
    abi: exactInputSingleAbi,
    functionName: "exactInputSingle",
    args: [
      tokenIn,
      tokenOut,
      Number(fee),
      recipientAddr,
      deadline,
      notionalWei,
      amountOutMinimum,
      sqrtPriceLimitX96,
    ],
  });

  // --- 6) Respond -------------------------------------------------------
  // Return calldata bytes only; nothing else. TEE proxy signs the action result.
  return [calldata, 1, null];
}
