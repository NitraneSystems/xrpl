import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getAddress, parseAbi, type Address } from "viem";
import { decodeEventLog } from "viem";
import { clientsFromEnv, loadConfig, loadSenderAbi, relaySwapProof } from "./fdc.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

const ERC20_ABI = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
const REGISTRY_ABI = parseAbi([
  "function getLead(address) view returns (address wallet, uint8 strategyType, uint16 feeRateBps, uint256 minAllocation, bytes32 teePublicKeyHash)",
  "function registerLead(uint8 strategyType, uint16 feeRateBps, uint256 minAllocation, bytes32 teePublicKeyHash)",
]);
const VAULT_ABI = parseAbi([
  "function deposit(address lead, uint256 amount)",
  "function getBalance(address follower, address lead) view returns (uint256)",
]);
const ROUTER_ABI = parseAbi([
  "function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256 amountOut)",
]);
const MATCH_EXECUTED = parseAbi([
  "event MatchExecuted(uint256 indexed fillId, address follower, address lead, uint256 amountIn, uint256 amountOut)",
]);

async function main() {
  const cfg = loadConfig();
  const { publicClient, wallet, account } = clientsFromEnv();
  const sender = getAddress(cfg.contracts.instructionSender) as Address;
  const vault = getAddress(cfg.contracts.mirrorVault) as Address;
  const registry = getAddress(cfg.contracts.mirrorRegistry) as Address;
  const router = getAddress(cfg.contracts.mockSparkDexRouter) as Address;
  const fxrp = getAddress(cfg.tokens.fxrp) as Address;
  const usdt0 = getAddress(cfg.tokens.usdt0) as Address;
  const senderAbi = loadSenderAbi();

  const leadInfo = (await publicClient.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "getLead",
    args: [account.address],
  })) as readonly [Address, number, number, bigint, `0x${string}`];
  if (leadInfo[0] === "0x0000000000000000000000000000000000000000") {
    const hash = await wallet.writeContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "registerLead",
      args: [0, 200, 0n, ("0x" + "00".repeat(32)) as `0x${string}`],
      gas: 500_000n,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("registered deployer as lead");
  }

  const fxrpDecimals = (await publicClient.readContract({
    address: fxrp,
    abi: ERC20_ABI,
    functionName: "decimals",
  })) as number;
  const amountIn = 10n ** BigInt(fxrpDecimals) / 100n; // 0.01 FXRP
  const cycles = 10;
  const depositAmt = amountIn * BigInt(cycles) * 2n;
  const approveHash = await wallet.writeContract({
    address: fxrp,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [vault, depositAmt],
    gas: 500_000n,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  const depHash = await wallet.writeContract({
    address: vault,
    abi: VAULT_ABI,
    functionName: "deposit",
    args: [account.address, depositAmt],
    gas: 500_000n,
  });
  await publicClient.waitForTransactionReceipt({ hash: depHash });

  const profit = 10n ** BigInt(fxrpDecimals); // 1 FXRP profit → 0.09 FXRP net fee
  let ok = 0;
  for (let i = 0; i < cycles; i++) {
    const quoted = (await publicClient.readContract({
      address: router,
      abi: ROUTER_ABI,
      functionName: "quoteExactInput",
      args: [fxrp, usdt0, amountIn],
    })) as bigint;
    const minOut = (quoted * 9000n) / 10_000n;
    const balBefore = (await publicClient.readContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: "getBalance",
      args: [account.address, account.address],
    })) as bigint;

    const execHash = await wallet.writeContract({
      address: sender,
      abi: senderAbi,
      functionName: "executeMatch",
      args: [
        {
          follower: account.address,
          lead: account.address,
          profit,
          epochId: BigInt(i + 1),
          swap: {
            tokenIn: fxrp,
            tokenOut: usdt0,
            fee: 500,
            recipient: sender,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
            amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0n,
          },
        },
      ],
      gas: 2_000_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: execHash });
    if (receipt.status !== "success") throw new Error(`executeMatch reverted tx=${execHash}`);
    let fillId = BigInt(i);
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: MATCH_EXECUTED, data: log.data, topics: log.topics });
        if (decoded.eventName === "MatchExecuted") fillId = decoded.args.fillId as bigint;
      } catch {
        /* not this event */
      }
    }

    const { proof, publicClient: pc, wallet: w } = await relaySwapProof(execHash);
    const settleHash = await w.writeContract({
      address: sender,
      abi: senderAbi,
      functionName: "applyFdcSettlement",
      args: [fillId, proof],
      gas: 2_000_000n,
    });
    const settleReceipt = await pc.waitForTransactionReceipt({ hash: settleHash });
    if (settleReceipt.status !== "success") throw new Error(`applyFdcSettlement reverted tx=${settleHash}`);

    const balAfter = (await publicClient.readContract({
      address: vault,
      abi: VAULT_ABI,
      functionName: "getBalance",
      args: [account.address, account.address],
    })) as bigint;
    if (balAfter !== balBefore - amountIn) {
      throw new Error(`cycle ${i}: vault balance ${balAfter} expected ${balBefore - amountIn}`);
    }
    ok++;
    console.log(`cycle ${ok}/${cycles} swap=${execHash} settle=${settleHash} fill=${fillId}`);
  }
  console.log(`OK: ${ok} consecutive FDC settlement cycles`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
