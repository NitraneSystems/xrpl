import { createWalletClient, createPublicClient, http, parseAbi, getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2 } from "../lib/chain.ts";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

const FACTORY = "0xf0f5e4cde15b22a423e995415f373fedc1f8f431" as Address;
const ROUTER = "0x8D29b61C41CF318d15d031BE2928F79630e068e6" as Address;
const STALE_FACTORY = "0x440602f459D7Dd500a74528003e6A20A46d6e2A6".toLowerCase();
const USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F" as Address;
const FLARE_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as Address;

const FACTORY_ABI = parseAbi([
  "function getPair(address,address) view returns (address)",
  "function createPair(address,address) returns (address)",
]);
const ROUTER_ABI = parseAbi([
  "function factory() view returns (address)",
  "function addLiquidity(address tokenA,address tokenB,uint amountADesired,uint amountBDesired,uint amountAMin,uint amountBMin,uint feeBipsA,uint feeBipsB,address to,uint deadline) returns (uint amountA, uint amountB, uint liquidity)",
  "function swapExactTokensForTokens(uint amountIn,uint amountOutMin,address[] path,address to,uint deadline) returns (uint[] amounts)",
]);
const ERC20_ABI = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
const REGISTRY_ABI = parseAbi(["function getContractAddressByName(string) view returns (address)"]);
const AM_ABI = parseAbi(["function fAsset() view returns (address)"]);
const FTSO_ABI = parseAbi([
  "function getFeedByIdInWei(bytes21) view returns (uint256 valueWei, uint64 timestamp)",
]);

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PERSONA_DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("Missing DEPLOYER_PRIVATE_KEY");
  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const account = privateKeyToAccount(pk as `0x${string}`);
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: coston2, transport: http(rpc) });

  const factoryOnRouter = (await publicClient.readContract({
    address: ROUTER,
    abi: ROUTER_ABI,
    functionName: "factory",
  })) as Address;
  if (factoryOnRouter.toLowerCase() !== FACTORY.toLowerCase()) {
    throw new Error(`router.factory() ${factoryOnRouter} != expected ${FACTORY}`);
  }
  if (factoryOnRouter.toLowerCase() === STALE_FACTORY) {
    throw new Error("stale blazeswap.top factory — abort");
  }

  const am = (await publicClient.readContract({
    address: FLARE_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByName",
    args: ["AssetManagerFXRP"],
  })) as Address;
  const fxrp = (await publicClient.readContract({
    address: am,
    abi: AM_ABI,
    functionName: "fAsset",
  })) as Address;

  let pair = (await publicClient.readContract({
    address: FACTORY,
    abi: FACTORY_ABI,
    functionName: "getPair",
    args: [USDT0, fxrp],
  })) as Address;

  if (pair === "0x0000000000000000000000000000000000000000") {
    const hash = await wallet.writeContract({
      address: FACTORY,
      abi: FACTORY_ABI,
      functionName: "createPair",
      args: [USDT0, fxrp],
      gas: 8_000_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`createPair reverted tx=${hash}`);
    pair = (await publicClient.readContract({
      address: FACTORY,
      abi: FACTORY_ABI,
      functionName: "getPair",
      args: [USDT0, fxrp],
    })) as Address;
    if (pair === "0x0000000000000000000000000000000000000000") {
      throw new Error(`createPair mined but getPair is still zero tx=${hash}`);
    }
    console.log(`Created pair ${pair} tx=${hash}`);
  } else {
    console.log(`Existing pair ${pair}`);
  }

  const ftso = (await publicClient.readContract({
    address: FLARE_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByName",
    args: ["FtsoV2"],
  })) as Address;
  const [fxrpUsd] = (await publicClient.readContract({
    address: ftso,
    abi: FTSO_ABI,
    functionName: "getFeedByIdInWei",
    args: ["0x015852502f55534400000000000000000000000000"],
  })) as [bigint, bigint];
  const [usdtUsd] = (await publicClient.readContract({
    address: ftso,
    abi: FTSO_ABI,
    functionName: "getFeedByIdInWei",
    args: ["0x01555344542f555344000000000000000000000000"],
  })) as [bigint, bigint];

  const usdtBal = (await publicClient.readContract({
    address: USDT0,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  const fxrpBal = (await publicClient.readContract({
    address: fxrp,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;

  const usdtDecimals = (await publicClient.readContract({
    address: USDT0,
    abi: ERC20_ABI,
    functionName: "decimals",
  })) as number;
  const fxrpDecimals = (await publicClient.readContract({
    address: fxrp,
    abi: ERC20_ABI,
    functionName: "decimals",
  })) as number;
  const usdtDesired = usdtBal < 10n ** BigInt(usdtDecimals) * 10_000n
    ? usdtBal / 2n
    : 10n ** BigInt(usdtDecimals) * 10_000n;
  const fxrpDesired =
    usdtUsd === 0n || fxrpUsd === 0n
      ? fxrpBal / 2n
      : (usdtDesired * usdtUsd * 10n ** BigInt(fxrpDecimals)) / (fxrpUsd * 10n ** BigInt(usdtDecimals));
  const fxrpUse = fxrpDesired > fxrpBal / 2n ? fxrpBal / 2n : fxrpDesired;
  if (usdtDesired === 0n || fxrpUse === 0n) throw new Error("Insufficient USDT0/FXRP to seed pool");

  for (const [token, amount] of [
    [USDT0, usdtDesired],
    [fxrp, fxrpUse],
  ] as const) {
    const hash = await wallet.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [ROUTER, amount],
      gas: 500_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`approve reverted ${token} tx=${hash}`);
  }

  const liqHash = await wallet.writeContract({
    address: ROUTER,
    abi: ROUTER_ABI,
    functionName: "addLiquidity",
    args: [
      USDT0,
      fxrp,
      usdtDesired,
      fxrpUse,
      (usdtDesired * 90n) / 100n,
      (fxrpUse * 90n) / 100n,
      0n,
      0n,
      account.address,
      BigInt(Math.floor(Date.now() / 1000) + 600),
    ],
    gas: 3_000_000n,
  });
  const liqReceipt = await publicClient.waitForTransactionReceipt({ hash: liqHash });
  if (liqReceipt.status !== "success") throw new Error(`addLiquidity reverted tx=${liqHash}`);
  console.log(`addLiquidity tx ${liqHash}`);
  console.log(`Self-seeded test liquidity (not third-party): pair=${pair}`);

  const usdtLeft = (await publicClient.readContract({
    address: USDT0,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  const swapIn = usdtLeft > 10n ** BigInt(usdtDecimals) ? 10n ** BigInt(usdtDecimals) : usdtLeft / 10n;
  if (swapIn === 0n) throw new Error("no USDT0 left for one-swap test");
  const swapApproveHash = await wallet.writeContract({
    address: USDT0,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [ROUTER, swapIn],
    gas: 500_000n,
  });
  await publicClient.waitForTransactionReceipt({ hash: swapApproveHash });
  const fxrpBefore = (await publicClient.readContract({
    address: fxrp,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  const swapHash = await wallet.writeContract({
    address: ROUTER,
    abi: ROUTER_ABI,
    functionName: "swapExactTokensForTokens",
    args: [swapIn, 1n, [USDT0, fxrp], account.address, BigInt(Math.floor(Date.now() / 1000) + 600)],
    gas: 1_500_000n,
  });
  const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
  if (swapReceipt.status !== "success") throw new Error(`BlazeSwap swap reverted tx=${swapHash}`);
  const fxrpAfter = (await publicClient.readContract({
    address: fxrp,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  if (fxrpAfter <= fxrpBefore) throw new Error("BlazeSwap one-swap did not increase FXRP");
  console.log(`self-seeded BlazeSwap USDT0→FXRP swap ${swapHash} out=${fxrpAfter - fxrpBefore}`);

  const cfgPath = join(ROOT, "config/coston2.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  cfg.blazeSwapPair = pair;
  cfg.blazeSwapNote = "self-seeded test liquidity — not third-party FXRP/USDT0 depth";
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
