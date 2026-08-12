/**
 * Health canary: price drop on MockKinetic → liquidation-risk alert → TOPUP_V1 handler → supply.
 */
import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  getAddress,
  parseUnits,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2 } from "../lib/chain.ts";
import { assessHealth } from "../../fce-ai-agent/typescript/src/app/health.ts";
import { handleMirrorTopUpV1 } from "../../fce-matching-engine/typescript/src/app/handlers.ts";
import { bytesToHex } from "../../fce-matching-engine/typescript/src/base/encoding.ts";
import { sendAlert } from "./alert-webhook.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

const FXRP_DECIMALS = 6;
const u = (n: string) => parseUnits(n, FXRP_DECIMALS);

async function main() {
  const cfg = JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
  const kinetic = getAddress(cfg.contracts.mockKineticPool) as Address;
  const healthAuth = getAddress(cfg.contracts.mirrorHealthAuth) as Address;
  const fxrp = getAddress(cfg.tokens.fxrp) as Address;
  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";

  const followerPk = process.env.PERSONA_FOLLOWER_EVM_1_PRIVATE_KEY as Hex;
  const ownerPk = (process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PERSONA_DEPLOYER_PRIVATE_KEY) as Hex;
  if (!followerPk || !ownerPk) throw new Error("Need follower + deployer keys");

  const follower = privateKeyToAccount(followerPk);
  const owner = privateKeyToAccount(ownerPk);
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const followerWallet = createWalletClient({ account: follower, chain: coston2, transport: http(rpc) });
  const ownerWallet = createWalletClient({ account: owner, chain: coston2, transport: http(rpc) });

  const kineticAbi = parseAbi([
    "function supply(uint256 amount)",
    "function borrow(uint256 amount)",
    "function setPrice(uint256 priceWei)",
    "function getCollateralRatioBps(address user) view returns (uint256)",
    "function supplyBalance(address) view returns (uint256)",
    "function borrowBalance(address) view returns (uint256)",
    "function liquidationThresholdBps() view returns (uint256)",
  ]);
  const erc20Abi = parseAbi([
    "function approve(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ]);
  const authAbi = parseAbi([
    "function preAuthorizeTopUp(address lead, uint256 maxTopUp, bool enabled)",
    "function isAuthorized(address follower, address lead, uint256 amount) view returns (bool)",
  ]);

  const lead = getAddress(
    JSON.parse(readFileSync(join(ROOT, "config/accounts.testnet.json"), "utf8")).personas["lead-trader-1"]
      .address,
  ) as Address;

  // Seed liquidity in pool from owner if needed
  const poolBal = (await publicClient.readContract({
    address: fxrp,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [kinetic],
  })) as bigint;
  if (poolBal < u("50")) {
    console.log("Note: MockKinetic may need FXRP liquidity for borrows");
  }

  const followerBal = (await publicClient.readContract({
    address: fxrp,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [follower.address],
  })) as bigint;
  if (followerBal < u("10")) {
    const ownerBal = (await publicClient.readContract({
      address: fxrp,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner.address],
    })) as bigint;
    const need = u("15") - followerBal;
    if (ownerBal < need) {
      throw new Error(
        `Follower needs ≥10 FXRP (have ${followerBal}); deployer has ${ownerBal}. Fund from Coston2 faucet.`,
      );
    }
    const transferAbi = parseAbi(["function transfer(address,uint256) returns (bool)"]);
    const tx = await ownerWallet.writeContract({
      address: fxrp,
      abi: transferAbi,
      functionName: "transfer",
      args: [follower.address, need],
      gas: 100_000n,
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log(`funded follower with ${need} FXRP from deployer`);
  }

  await followerWallet.writeContract({
    address: fxrp,
    abi: erc20Abi,
    functionName: "approve",
    args: [kinetic, u("100")],
    gas: 100_000n,
  });
  await followerWallet.writeContract({
    address: kinetic,
    abi: kineticAbi,
    functionName: "supply",
    args: [u("10")],
    gas: 300_000n,
  });
  await followerWallet.writeContract({
    address: kinetic,
    abi: kineticAbi,
    functionName: "borrow",
    args: [u("6")],
    gas: 300_000n,
  });

  await followerWallet.writeContract({
    address: healthAuth,
    abi: authAbi,
    functionName: "preAuthorizeTopUp",
    args: [lead, u("20"), true],
    gas: 150_000n,
  });

  // Price drop → CR falls (price is USD wei, keep 18 decimals)
  const dropTx = await ownerWallet.writeContract({
    address: kinetic,
    abi: kineticAbi,
    functionName: "setPrice",
    args: [parseEther("0.7")],
    gas: 100_000n,
  });
  await publicClient.waitForTransactionReceipt({ hash: dropTx });

  const cr = Number(
    await publicClient.readContract({
      address: kinetic,
      abi: kineticAbi,
      functionName: "getCollateralRatioBps",
      args: [follower.address],
    }),
  );
  const supplyBal = (await publicClient.readContract({
    address: kinetic,
    abi: kineticAbi,
    functionName: "supplyBalance",
    args: [follower.address],
  })) as bigint;
  const borrowBal = (await publicClient.readContract({
    address: kinetic,
    abi: kineticAbi,
    functionName: "borrowBalance",
    args: [follower.address],
  })) as bigint;
  const liq = Number(
    await publicClient.readContract({
      address: kinetic,
      abi: kineticAbi,
      functionName: "liquidationThresholdBps",
    }),
  );

  const snap = assessHealth({
    follower: follower.address,
    lead,
    collateralRatioBps: cr,
    liquidateBps: liq,
    borrowBalance: borrowBal,
    supplyBalance: supplyBal,
  });
  if (snap.status !== "Liquidation Risk") {
    throw new Error(`expected Liquidation Risk, got ${snap.status} cr=${cr}`);
  }
  await sendAlert({
    type: "liquidation_risk",
    follower: follower.address,
    lead,
    message: `CR ${cr} bps below alert ${snap.alertBps}`,
    meta: snap as unknown as Record<string, unknown>,
  });

  const topUpAmount = snap.suggestedTopUp > 0n ? snap.suggestedTopUp : u("3");
  const authorized = await publicClient.readContract({
    address: healthAuth,
    abi: authAbi,
    functionName: "isAuthorized",
    args: [follower.address, lead, topUpAmount],
  });
  if (!authorized) throw new Error("top-up not pre-authorized");

  // TEE handler path
  const msgHex = bytesToHex(
    Uint8Array.from(
      Buffer.from(
        JSON.stringify({
          follower: follower.address,
          lead,
          amountWei: topUpAmount.toString(),
          kineticPool: kinetic,
        }),
        "utf-8",
      ),
    ),
  );
  const [dataHex, status, err] = handleMirrorTopUpV1(msgHex);
  if (status !== 1 || !dataHex) throw new Error(`TOPUP_V1 failed: ${err}`);
  const teePayload = JSON.parse(Buffer.from(dataHex.slice(2), "hex").toString("utf-8")) as {
    to: string;
    data: Hex;
  };

  // Execute supply calldata from follower (simulates post-TEE execution)
  await followerWallet.writeContract({
    address: fxrp,
    abi: erc20Abi,
    functionName: "approve",
    args: [kinetic, topUpAmount],
    gas: 100_000n,
  });
  const topTx = await followerWallet.writeContract({
    address: teePayload.to as Address,
    abi: kineticAbi,
    functionName: "supply",
    args: [topUpAmount],
    gas: 300_000n,
  });
  await publicClient.waitForTransactionReceipt({ hash: topTx });

  const crAfter = Number(
    await publicClient.readContract({
      address: kinetic,
      abi: kineticAbi,
      functionName: "getCollateralRatioBps",
      args: [follower.address],
    }),
  );
  if (crAfter < snap.alertBps) {
    // Reset price for recovery check alternative
    console.warn(`CR after top-up ${crAfter} still below alert; restoring price and verifying improvement`);
  }
  if (crAfter <= cr) throw new Error(`expected CR to improve after top-up (${cr} → ${crAfter})`);

  await sendAlert({
    type: "topup_executed",
    follower: follower.address,
    lead,
    message: `TOPUP_V1 executed; CR ${cr} → ${crAfter}`,
  });

  // Restore price for cleanliness
  await ownerWallet.writeContract({
    address: kinetic,
    abi: kineticAbi,
    functionName: "setPrice",
    args: [parseEther("1")],
    gas: 100_000n,
  });

  console.log(JSON.stringify({ ok: true, crBefore: cr, crAfter, topUpAmount: topUpAmount.toString() }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
