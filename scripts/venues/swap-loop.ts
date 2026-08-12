import { createWalletClient, createPublicClient, http, parseAbi, getAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2 } from "../lib/chain.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function quoteExactInput(address tokenIn,address tokenOut,uint256 amountIn) view returns (uint256 amountOut)",
  "function fxrp() view returns (address)",
  "function usdt0() view returns (address)",
]);
const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PERSONA_DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("Missing DEPLOYER_PRIVATE_KEY");
  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const cfg = JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
  const routerAddr = getAddress(cfg.contracts.mockSparkDexRouter) as Address;
  const account = privateKeyToAccount(pk as `0x${string}`);
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: coston2, transport: http(rpc) });

  const fxrp = (await publicClient.readContract({
    address: routerAddr,
    abi: ROUTER_ABI,
    functionName: "fxrp",
  })) as Address;
  const usdt0 = (await publicClient.readContract({
    address: routerAddr,
    abi: ROUTER_ABI,
    functionName: "usdt0",
  })) as Address;

  const fxrpDecimals = (await publicClient.readContract({
    address: fxrp,
    abi: ERC20_ABI,
    functionName: "decimals",
  })) as number;
  const amountIn = 10n ** BigInt(fxrpDecimals) / 100n; // 0.01 FXRP
  const approveHash = await wallet.writeContract({
    address: fxrp,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [routerAddr, 2n ** 256n - 1n],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  let ok = 0;
  for (let i = 0; i < 21; i++) {
    const quoted = (await publicClient.readContract({
      address: routerAddr,
      abi: ROUTER_ABI,
      functionName: "quoteExactInput",
      args: [fxrp, usdt0, amountIn],
    })) as bigint;
    const minOut = (quoted * 9000n) / 10_000n;
    const before = (await publicClient.readContract({
      address: usdt0,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    const hash = await wallet.writeContract({
      address: routerAddr,
      abi: ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: fxrp,
          tokenOut: usdt0,
          fee: 500,
          recipient: account.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
          amountIn,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
      gas: 1_500_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`swap ${i + 1} reverted tx=${hash}`);
    }
    const after = (await publicClient.readContract({
      address: usdt0,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;
    const got = after - before;
    const lo = (quoted * 9000n) / 10_000n;
    const hi = (quoted * 11000n) / 10_000n;
    if (got < lo || got > hi) {
      throw new Error(`swap ${i + 1} out of FTSO band: got ${got} quoted ${quoted} tx=${hash}`);
    }
    ok++;
    console.log(`swap ${i + 1}/21 ok out=${got} quoted=${quoted}`);
  }
  console.log(`OK: ${ok} FTSO-priced swaps within band`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
