import { createPublicClient, http, getAddress } from "viem";
import { type Address } from "viem";
import { FXRP_USD_FEED_ID, USDT0_USD_FEED_ID } from "./feedIds.js";

const FLARE_CHAIN_ID = 114;
const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as Address;

const REGISTRY_ABI = [
  {
    name: "getContractAddressByName",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_name", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const TEST_FTSO_V2_ABI = [
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
] as const;

export interface FtsoFeedRead {
  valueWei: bigint;
  timestamp: bigint;
}

export async function readFxrpUsdAndUsdt0Usd(params?: { rpcUrl?: string }) {
  const rpcUrl = params?.rpcUrl ?? process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";

  const client = createPublicClient({
    chain: { id: FLARE_CHAIN_ID },
    transport: http(rpcUrl),
  });

  const ftsoV2 = (await client.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByName",
    args: ["FtsoV2"],
  })) as Address;

  const fxrp = (await client.readContract({
    address: ftsoV2,
    abi: TEST_FTSO_V2_ABI,
    functionName: "getFeedByIdInWei",
    args: [FXRP_USD_FEED_ID as `0x${string}`],
  })) as [bigint, bigint];

  const usdt0 = (await client.readContract({
    address: ftsoV2,
    abi: TEST_FTSO_V2_ABI,
    functionName: "getFeedByIdInWei",
    args: [USDT0_USD_FEED_ID as `0x${string}`],
  })) as [bigint, bigint];

  return {
    fxrpUsd: { valueWei: fxrp[0], timestamp: fxrp[1] },
    usdt0Usd: { valueWei: usdt0[0], timestamp: usdt0[1] },
  };
}

