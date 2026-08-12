/**
 * Phase 11 — one-command lifecycle demo on Coston2.
 *
 * Orchestrates existing canaries (timed). Env:
 *   DEMO_SKIP_SLOW_FDC=1   skip FDC cycle (default false for full run)
 *   DEMO_SKIP_ONCHAIN=1    skip steps that need gas / keys
 */
import * as dotenv from "dotenv";
import { spawn } from "node:child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import { getAddress } from "viem";

import { handleMirrorMatchStageB } from "../../fce-matching-engine/typescript/src/app/handlers.ts";
import { bytesToHex, hexToBytes } from "../../fce-matching-engine/typescript/src/base/encoding.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

const skipSlowFdc = process.env.DEMO_SKIP_SLOW_FDC === "1";
const skipOnchain = process.env.DEMO_SKIP_ONCHAIN === "1";

function jsonMsg(obj: unknown): string {
  return bytesToHex(Buffer.from(JSON.stringify(obj), "utf-8"));
}

async function runNpmScript(script: string, timeoutMs: number): Promise<{ ok: boolean; ms: number; note: string }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", script, "-w", "scripts"],
      {
        cwd: ROOT,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      },
    );
    let out = "";
    child.stdout?.on("data", (d) => (out += d.toString()));
    child.stderr?.on("data", (d) => (out += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ ok: false, ms: Date.now() - start, note: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        ms: Date.now() - start,
        note: code === 0 ? "ok" : `exit ${code}: ${out.slice(-400)}`,
      });
    });
  });
}

async function stepEnosysMockRoute(cfg: any, accounts: any) {
  process.env.FCE_PLAINTEXT_DECRYPT_FALLBACK = "1";
  delete process.env.SIGN_PORT;
  process.env.MIRROR_MOCK_VENUES = "true";
  process.env.MOCK_ENOSYS_CDP_ADDRESS = cfg.contracts.mockEnosysCDP;
  process.env.MOCK_FIRELIGHT_STRATEGY_ADDRESS = cfg.contracts.mockFirelightStrategy;

  const lead = getAddress(accounts.personas["lead-trader-1"].address);
  const recipient = getAddress(accounts.personas["follower-evm-1"].address);
  const r = await handleMirrorMatchStageB(
    jsonMsg({
      venue: "enosys-cdp",
      sizePct: 500,
      lead,
      recipient,
    }),
  );
  if (r[1] !== 1) throw new Error(`Enosys mock route failed: ${r[2]}`);
  const payload = JSON.parse(Buffer.from(hexToBytes(r[0]!)).toString("utf-8"));
  if (payload.venue !== "enosys-cdp" || !payload.to || !payload.data) {
    throw new Error("Enosys mock payload shape invalid");
  }
  return payload;
}

async function stepSparkdexStageB(cfg: any, accounts: any) {
  process.env.FCE_PLAINTEXT_DECRYPT_FALLBACK = "1";
  delete process.env.SIGN_PORT;
  process.env.MIRROR_MOCK_VENUES = "false";
  process.env.EXECUTION_VENUE = "mock-sparkdex";
  process.env.MOCK_SPARKDEX_ROUTER_ADDRESS = cfg.contracts.mockSparkDexRouter;
  process.env.C2_FXRP_ADDRESS = cfg.tokens.fxrp;
  process.env.C2_USDT0_ADDRESS = cfg.tokens.usdt0;
  process.env.FLARE_RPC_URL =
    process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";

  const lead = getAddress(accounts.personas["lead-trader-1"].address);
  const recipient = getAddress(accounts.personas["follower-evm-1"].address);
  const r = await handleMirrorMatchStageB(
    jsonMsg({
      asset: "FXRP",
      direction: "BUY",
      sizePct: 1000,
      lead,
      recipient,
    }),
  );
  if (r[1] !== 1) throw new Error(`SparkDEX Stage B failed: ${r[2]}`);
  const payload = JSON.parse(Buffer.from(hexToBytes(r[0]!)).toString("utf-8"));
  if (!payload.to || !payload.data) throw new Error("SparkDEX payload missing to/data");
  return payload;
}

async function main() {
  const wallStart = Date.now();
  console.log("=== demo:lifecycle (Coston2) ===\n");

  const cfg = JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
  const accountsPath = join(ROOT, "config/accounts.testnet.json");
  if (!existsSync(accountsPath)) throw new Error("Missing config/accounts.testnet.json — run provision:personas");
  const accounts = JSON.parse(readFileSync(accountsPath, "utf8"));

  const results: Array<{ step: string; ok: boolean; ms: number; detail?: string }> = [];

  // 1) Lead register (if needed) — score canary / registry presence via accounts
  {
    const t0 = Date.now();
    const lead = accounts.personas["lead-trader-1"]?.address;
    const ok = typeof lead === "string" && lead.startsWith("0x");
    results.push({
      step: "1 lead persona present",
      ok,
      ms: Date.now() - t0,
      detail: lead,
    });
    if (!ok) throw new Error("lead persona missing");
    console.log(`✓ lead register/persona: ${lead}`);
  }

  // 2) Signal encrypt path / Stage B smoke against mock SparkDEX
  {
    const t0 = Date.now();
    try {
      const p = await stepSparkdexStageB(cfg, accounts);
      results.push({ step: "2 Stage B mock SparkDEX", ok: true, ms: Date.now() - t0, detail: p.venue });
      console.log(`✓ Stage B mock SparkDEX → ${p.to}`);
    } catch (e) {
      results.push({
        step: "2 Stage B mock SparkDEX",
        ok: false,
        ms: Date.now() - t0,
        detail: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  // 3) Optional BlazeSwap note
  {
    const note = cfg.blazeSwapNote ?? "self-seeded";
    console.log(`· BlazeSwap: ${cfg.blazeSwapPair} (${note})`);
    results.push({ step: "3 BlazeSwap seeded note", ok: true, ms: 0, detail: cfg.blazeSwapPair });
  }

  // 4) FDC cycle
  if (skipSlowFdc) {
    console.log("· FDC cycle SKIPPED (DEMO_SKIP_SLOW_FDC=1)");
    results.push({ step: "4 FDC cycle", ok: true, ms: 0, detail: "skipped" });
  } else if (skipOnchain) {
    console.log("· FDC cycle SKIPPED (DEMO_SKIP_ONCHAIN=1)");
    results.push({ step: "4 FDC cycle", ok: true, ms: 0, detail: "skipped-onchain" });
  } else {
    console.log("… FDC cycle (may be slow)…");
    const r = await runNpmScript("fdc:cycle", 15 * 60_000);
    results.push({ step: "4 FDC cycle", ok: r.ok, ms: r.ms, detail: r.note });
    console.log(r.ok ? `✓ FDC cycle (${r.ms}ms)` : `✗ FDC cycle: ${r.note}`);
    if (!r.ok) throw new Error("FDC cycle failed");
  }

  // 5) Fee / settlement hooks — config presence
  {
    const ok = !!(cfg.contracts.mirrorFee && cfg.contracts.mirrorVault);
    results.push({ step: "5 fee/settlement addresses", ok, ms: 0 });
    console.log(ok ? `✓ fee=${cfg.contracts.mirrorFee}` : "✗ missing fee/vault");
    if (!ok) throw new Error("fee/vault missing");
  }

  // 6) AI score canary slice
  if (skipOnchain) {
    console.log("· AI score canary SKIPPED (DEMO_SKIP_ONCHAIN=1)");
    results.push({ step: "6 AI score canary", ok: true, ms: 0, detail: "skipped" });
  } else {
    console.log("… AI score canary…");
    const r = await runNpmScript("ai:score-canary", 10 * 60_000);
    results.push({ step: "6 AI score canary", ok: r.ok, ms: r.ms, detail: r.note });
    console.log(r.ok ? `✓ AI score (${r.ms}ms)` : `✗ AI score: ${r.note}`);
    if (!r.ok) throw new Error("AI score canary failed");
  }

  // 7) Follower withdrawal request — portfolio/withdraw is UI; assert vault address
  {
    const ok = !!cfg.contracts.mirrorVault;
    results.push({ step: "7 follower withdrawal surface", ok, ms: 0, detail: cfg.contracts.mirrorVault });
    console.log(`✓ withdraw surface vault=${cfg.contracts.mirrorVault}`);
  }

  // 8) Drift canary
  if (skipOnchain) {
    console.log("· Drift canary SKIPPED");
    results.push({ step: "8 drift canary", ok: true, ms: 0, detail: "skipped" });
  } else {
    console.log("… Drift canary…");
    const r = await runNpmScript("ai:drift-canary", 10 * 60_000);
    results.push({ step: "8 drift canary", ok: r.ok, ms: r.ms, detail: r.note });
    console.log(r.ok ? `✓ drift (${r.ms}ms)` : `✗ drift: ${r.note}`);
    if (!r.ok) throw new Error("drift canary failed");
  }

  // 9) XRPL FSA status / PersonalAccount mapping
  {
    const ops = cfg.fsa?.operators ?? [];
    const ok = ops.length > 0 && !!cfg.contracts.mirrorFsaOnboarder;
    results.push({
      step: "9 XRPL FSA mapping",
      ok,
      ms: 0,
      detail: `ops=${ops.join(",")} onboarder=${cfg.contracts.mirrorFsaOnboarder}`,
    });
    console.log(ok ? `✓ FSA operator ${ops[0]}` : "✗ FSA config incomplete");
    if (!ok) throw new Error("FSA config incomplete");
  }

  // 10) Enosys mock CDP route (Phase 10)
  {
    const t0 = Date.now();
    const p = await stepEnosysMockRoute(cfg, accounts);
    results.push({ step: "10 Enosys mock CDP route", ok: true, ms: Date.now() - t0, detail: p.to });
    console.log(`✓ Enosys mock CDP → ${p.to}`);
  }

  // 11) Multi-follower load
  {
    console.log("… load-followers…");
    const r = await runNpmScript("e2e:load-followers", 120_000);
    results.push({ step: "11 load-followers ≥5", ok: r.ok, ms: r.ms, detail: r.note });
    console.log(r.ok ? `✓ load-followers (${r.ms}ms)` : `✗ load-followers: ${r.note}`);
    if (!r.ok) throw new Error("load-followers failed");
  }

  // 12) Adversarial plaintext
  {
    console.log("… adversarial-plaintext…");
    const r = await runNpmScript("e2e:adversarial-plaintext", 120_000);
    results.push({ step: "12 adversarial plaintext", ok: r.ok, ms: r.ms, detail: r.note });
    console.log(r.ok ? `✓ adversarial (${r.ms}ms)` : `✗ adversarial: ${r.note}`);
    if (!r.ok) throw new Error("adversarial-plaintext failed");
  }

  const wallMs = Date.now() - wallStart;
  console.log("\n=== demo:lifecycle summary ===");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step}  (${r.ms}ms)${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\nWall-clock duration: ${(wallMs / 1000).toFixed(1)}s`);
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
