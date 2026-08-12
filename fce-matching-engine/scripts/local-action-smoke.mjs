/**
 * Local FCE /action smoke test — starts the TypeScript extension server,
 * sends a hello-world SAY_HELLO instruction, validates the response.
 *
 * Run from repo root: npm run fce:smoke
 */
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TS_ROOT = join(__dirname, "../typescript");
const PORT = process.env.FCE_SMOKE_PORT ?? "8100";

function stringToBytes32Hex(s) {
  const encoded = new TextEncoder().encode(s);
  const padded = new Uint8Array(32);
  padded.set(encoded);
  return "0x" + Buffer.from(padded).toString("hex");
}

function buildActionBody() {
  const dataFixed = {
    instructionId: `0x${"11".repeat(32)}`,
    teeId: `0x${"22".repeat(20)}`,
    timestamp: Math.floor(Date.now() / 1000),
    rewardEpochId: 42,
    opType: stringToBytes32Hex("GREETING"),
    opCommand: stringToBytes32Hex("SAY_HELLO"),
    cosigners: [],
    cosignersThreshold: 0,
    originalMessage: "0x" + Buffer.from(JSON.stringify({ name: "Mirror" })).toString("hex"),
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
  console.log("=== FCE /action smoke test ===\n");

  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: TS_ROOT,
    env: { ...process.env, EXTENSION_PORT: PORT, SIGN_PORT: "9091" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  child.stdout?.on("data", (d) => (serverOutput += d.toString()));
  child.stderr?.on("data", (d) => (serverOutput += d.toString()));

  try {
    const base = `http://127.0.0.1:${PORT}`;
    await waitForServer(`${base}/action`);

    const res = await fetch(`${base}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildActionBody(),
    });

    const body = await res.json();
    console.log(`POST /action → HTTP ${res.status}`);
    console.log(JSON.stringify(body, null, 2));

    if (res.status !== 200) {
      throw new Error(`Expected HTTP 200, got ${res.status}`);
    }
    if (body.status !== 1) {
      throw new Error(`Expected action status 1 (success), got ${body.status}`);
    }

    console.log("\nOK: FCE hello-world /action responded successfully");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
