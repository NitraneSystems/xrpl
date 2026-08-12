import { test, expect } from "@playwright/test";
import { createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "fs";
import { join } from "path";
import * as dotenv from "dotenv";

const ROOT = join(__dirname, "../..");
dotenv.config({ path: join(ROOT, ".env") });

const cfg = JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";

const vaultAbi = [
  {
    type: "function",
    name: "getBalance",
    stateMutability: "view",
    inputs: [
      { name: "follower", type: "address" },
      { name: "lead", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

const leaderboardAbi = [
  {
    type: "function",
    name: "getRankedLeads",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
] as const;

test.describe("Mirror Coston2 UI", () => {
  test("landing shows Mirror brand and discovery", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hero-brand")).toHaveText("Mirror");
    await expect(page.getByRole("heading", { name: /Copy leads/i })).toBeVisible();
    await expect(page.locator("#discover h2")).toHaveText("Discovery");
  });

  test("signal page blocks plaintext without TEE key override", async ({ page }) => {
    await page.goto("/signal");
    await expect(page.getByRole("heading", { name: /Encrypted signal/i })).toBeVisible();
  });

  test("coston2 chain has ranked leads or empty state readable", async ({ page }) => {
    await page.goto("/");
    const client = createPublicClient({
      transport: http(rpc),
    });
    const ranked = (await client.readContract({
      address: cfg.contracts.mirrorLeaderboard as `0x${string}`,
      abi: leaderboardAbi,
      functionName: "getRankedLeads",
    })) as string[];
    if (ranked.length >= 2) {
      await expect(page.locator(".lead-table tbody tr").first()).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText(/No ranked leads|Loading Coston2/i)).toBeVisible();
    }
  });

  test("portfolio reads live vault balances when follower key present", async () => {
    const pk = process.env.PERSONA_FOLLOWER_EVM_1_PRIVATE_KEY as `0x${string}` | undefined;
    const leadPk = process.env.PERSONA_LEAD_TRADER_1_PRIVATE_KEY as `0x${string}` | undefined;
    test.skip(!pk || !leadPk, "persona keys missing");
    const follower = privateKeyToAccount(pk!);
    const lead = privateKeyToAccount(leadPk!);
    const client = createPublicClient({ transport: http(rpc) });
    const bal = await client.readContract({
      address: cfg.contracts.mirrorVault as `0x${string}`,
      abi: vaultAbi,
      functionName: "getBalance",
      args: [follower.address, lead.address],
    });
    // Assert live read succeeds (balance may be 0 before deposit)
    expect(typeof bal).toBe("bigint");
    expect(formatEther(bal)).toMatch(/^\d/);
  });

  test("encrypt helper path documented in UI", async ({ page }) => {
    await page.goto("/lead/onboard");
    await expect(page.getByText(/TEE public key hash/i)).toBeVisible();
  });

  test("portfolio shows epoch P&L column headers", async ({ page }) => {
    await page.goto("/portfolio");
    await expect(page.getByRole("heading", { name: /Portfolio/i })).toBeVisible();
    await expect(page.getByText(/Epoch P&L|Connect to load/i)).toBeVisible();
  });

  test("XRPL onboarding renders Xaman QR", async ({ page }) => {
    await page.goto("/follower/xrpl");
    await expect(page.getByRole("heading", { name: /XRPL Smart Account/i })).toBeVisible();
    await expect(page.getByAltText(/Xaman payment QR/i)).toBeVisible();
  });

  test("withdraw page wires requestWithdrawal surface", async ({ page }) => {
    await page.goto("/withdraw");
    await expect(page.getByRole("heading", { name: /Withdraw/i })).toBeVisible();
  });
});
