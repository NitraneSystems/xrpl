/**
 * Encode FSA payment references and 0xFE custom-instruction memos for Mirror onboarding.
 */
import {
  encodeFunctionData,
  encodeAbiParameters,
  keccak256,
  concat,
  pad,
  toHex,
  type Address,
  type Hex,
} from "viem";

const ONBOARD_ABI = [
  {
    type: "function",
    name: "onboard",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lead", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "riskProfile", type: "uint8" },
    ],
    outputs: [],
  },
] as const;

/** FXRP instruction type nibble 0, transfer command 0x01 = transfer. */
export function encodeFxrpTransferReference(opts: {
  recipient: Address;
  valueDrops: bigint;
  walletId?: number;
}): Hex {
  const typeCmd = 0x01; // type 0 (FXRP), command 1 (transfer)
  const walletId = opts.walletId ?? 0;
  const recipient = pad(opts.recipient, { size: 20 });
  // Layout: [typeCmd:1][walletId:1][recipient:20][value:10]  = 32 bytes
  const valueHex = pad(toHex(opts.valueDrops), { size: 10 });
  return concat([toHex(typeCmd, { size: 1 }), toHex(walletId, { size: 1 }), recipient, valueHex]) as Hex;
}

/** Deliberately malformed 32-byte reference for rejection tests. */
export function encodeMalformedReference(): Hex {
  return ("0x" + "ff".repeat(32)) as Hex;
}

export function encodeOnboardCalldata(lead: Address, amount: bigint, riskProfile: number): Hex {
  return encodeFunctionData({
    abi: ONBOARD_ABI,
    functionName: "onboard",
    args: [lead, amount, riskProfile],
  });
}

/**
 * Minimal PackedUserOperation-style payload for Mirror FSA custom instruction.
 * Flare PersonalAccount validates sender/nonce; executor delivers full bytes for 0xFE.
 */
export function buildOnboardUserOp(opts: {
  personalAccount: Address;
  onboarder: Address;
  lead: Address;
  amount: bigint;
  riskProfile: number;
  nonce?: bigint;
}): { userOp: Hex; userOpHash: Hex; memoFe: Hex; callData: Hex } {
  const callData = encodeOnboardCalldata(opts.lead, opts.amount, opts.riskProfile);
  // Compact encoding: (address sender, uint256 nonce, address target, bytes callData)
  const userOp = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "address" },
      { type: "bytes" },
    ],
    [opts.personalAccount, opts.nonce ?? 0n, opts.onboarder, callData],
  );
  const userOpHash = keccak256(userOp);
  // Memo: 0xFE || keccak256(userOp) padded to fit XRPL memo (42 bytes typical: 1+1+32+…)
  const memoFe = concat(["0xfe" as Hex, "0x00" as Hex, userOpHash]) as Hex;
  return { userOp, userOpHash, memoFe, callData };
}

/** XRPL Payment memoData hex (no 0x) for a 32-byte standard payment reference. */
export function paymentReferenceToMemoData(ref: Hex): string {
  return ref.replace(/^0x/, "").toLowerCase();
}

if (process.argv[1]?.includes("encode-reference")) {
  const lead = (process.argv[2] ?? "0x0000000000000000000000000000000000000001") as Address;
  const amount = BigInt(process.argv[3] ?? 10_000_000); // drops / wei
  const ref = encodeFxrpTransferReference({
    recipient: lead,
    valueDrops: amount,
  });
  console.log(JSON.stringify({ paymentReference: ref, memoData: paymentReferenceToMemoData(ref) }, null, 2));
}
