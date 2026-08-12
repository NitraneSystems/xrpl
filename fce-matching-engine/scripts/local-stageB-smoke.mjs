/**
 * Local FCE /action smoke test (Stage B).
 *
 * Because we don't run tee-node here, we send plaintext signal bytes and
 * rely on `FCE_PLAINTEXT_DECRYPT_FALLBACK=1` so the handler can still produce
 * correctly-shaped SparkDEX `exactInputSingle` calldata.
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const TS_ROOT = join(__dirname, "../typescript");
const PORT = process.env.FCE_SMOKE_PORT ?? "8101";
let serverOutput = "";

// Best-effort local env loading (the repo's root `.env`).
if (!process.env.FLARE_RPC_URL && existsSync(join(ROOT, ".env"))) {
  const lines = readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function stringToBytes32Hex(s) {
  const encoded = new TextEncoder().encode(s);
  const padded = new Uint8Array(32);
  padded.set(encoded);
  return "0x" + Buffer.from(padded).toString("hex");
}

function buildStageBActionBody() {
  const signal = {
    asset: "FXRP",
    direction: "BUY",
    sizePct: 1000, // 10.00% (bps, MVP interpretation)
    nonce: "1",
    recipient: "0x000000000000000000000000000000000000dEaD",
  };

  const ciphertextLikeHex = "0x" + Buffer.from(JSON.stringify(signal)).toString("hex");

  const dataFixed = {
    instructionId: `0x${"11".repeat(32)}`,
    teeId: `0x${"22".repeat(20)}`,
    timestamp: Math.floor(Date.now() / 1000),
    rewardEpochId: 42,
    opType: stringToBytes32Hex("MIRROR"),
    opCommand: stringToBytes32Hex("MATCH_V1"),
    cosigners: [],
    cosignersThreshold: 0,
    originalMessage: ciphertextLikeHex,
    additionalFixedMessage: "0x",
  };

  return JSON.stringify({
    data: {
      id: dataFixed.instructionId,
      type: "instruction",
      submissionTag: "submit",
      message: "0x" + Buffer.from(JSON.stringify(dataFixed), "utf8").toString("hex"),
    },
    additionalVariableMessages: [],
    timestamps: [],
    additionalActionData: "0x",
    signatures: [],
  });
}

async function waitForServer(url, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status === 405 || res.ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Server not ready at ${url}`);
}

async function main() {
  console.log("=== FCE /action Stage B smoke test ===\n");

  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: TS_ROOT,
    env: {
      ...process.env,
      EXTENSION_PORT: PORT,
      FCE_PLAINTEXT_DECRYPT_FALLBACK: "1",
      EXECUTION_VENUE: process.env.EXECUTION_VENUE ?? "mock-sparkdex",
      MOCK_SPARKDEX_ROUTER_ADDRESS:
        process.env.MOCK_SPARKDEX_ROUTER_ADDRESS || "0x000000000000000000000000000000000000dEaD",
      // Intentionally omit SIGN_PORT: ensures `decryptEnabled === false`.
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (d) => (serverOutput += d.toString()));
  child.stderr?.on("data", (d) => (serverOutput += d.toString()));

  try {
    const base = `http://127.0.0.1:${PORT}`;
    await waitForServer(`${base}/action`);

    const res = await fetch(`${base}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildStageBActionBody(),
    });

    const body = await res.json();
    console.log(`POST /action → HTTP ${res.status}`);

    if (res.status !== 200) throw new Error(`Expected HTTP 200, got ${res.status}`);
    if (body.status !== 1) {
      throw new Error(`Expected action status 1 (success), got ${body.status}: ${body.error ?? JSON.stringify(body)}`);
    }
    if (typeof body.data !== "string" || !body.data.startsWith("0x") || body.data.length < 10) {
      throw new Error("Expected returned payload hex in body.data");
    }
    const payload = JSON.parse(Buffer.from(body.data.slice(2), "hex").toString("utf8"));
    if (!payload.to || !payload.data) throw new Error("payload missing to/data");
    if (!String(payload.data).toLowerCase().startsWith("0x414bf389")) {
      throw new Error(`expected exactInputSingle selector 0x414bf389, got ${String(payload.data).slice(0, 10)}`);
    }
    if (payload.fee !== 500) throw new Error(`expected fee 500, got ${payload.fee}`);

    console.log("OK: Stage B returned struct exactInputSingle calldata (fee 500)");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((err) => {
  console.error("FAIL:", err?.message ?? String(err));
  console.error("---- FCE output (best-effort) ----");
  console.error(serverOutput);
  process.exit(1);
});

