/**
 * Phase 3 — TEE proxy (operator layer, PRD §5.1).
 *
 * Public HTTP endpoint that forwards instruction payloads to the matching-engine
 * FCE `/action` (or Stage A hello). Never decrypts or logs signal plaintext —
 * only opaque hex / JSON envelopes.
 *
 * Env:
 *   TEE_PROXY_PORT=6674
 *   TEE_MATCHING_ENGINE_ENDPOINT=http://127.0.0.1:8101
 *   TEE_PROXY_TOKEN=  (optional Bearer gate)
 */
import * as dotenv from "dotenv";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

const PORT = Number(process.env.TEE_PROXY_PORT ?? "6674");
const UPSTREAM = (process.env.TEE_MATCHING_ENGINE_ENDPOINT ?? "http://127.0.0.1:8101").replace(
  /\/$/,
  "",
);
const TOKEN = process.env.TEE_PROXY_TOKEN?.trim() || "";

const PLAINTEXT_MARKERS = ['"direction":', '"sizePct":', '"asset":"FXRP"', '"asset":"USDT0"'];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function assertNoPlaintextDump(label: string, text: string) {
  for (const m of PLAINTEXT_MARKERS) {
    if (text.includes(m)) {
      throw new Error(`${label}: refused — body looks like plaintext signal JSON (${m})`);
    }
  }
}

function authOk(req: IncomingMessage): boolean {
  if (!TOKEN) return true;
  const h = req.headers.authorization ?? "";
  return h === `Bearer ${TOKEN}`;
}

async function forward(path: string, method: string, body: string | undefined, contentType?: string) {
  const url = `${UPSTREAM}${path}`;
  const res = await fetch(url, {
    method,
    headers: contentType ? { "Content-Type": contentType } : undefined,
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
  const text = await res.text();
  return { status: res.status, text, contentType: res.headers.get("content-type") ?? "application/json" };
}

async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, upstream: UPSTREAM }));
      return;
    }

    if (!authOk(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    if (url.pathname === "/action" && req.method === "POST") {
      const body = await readBody(req);
      assertNoPlaintextDump("proxy inbound", body);
      const up = await forward("/action", "POST", body, "application/json");
      assertNoPlaintextDump("proxy upstream", up.text);
      // Log only metadata — never body contents that could include decrypted fields.
      console.log(`[tee-proxy] POST /action → ${up.status} bytes=${up.text.length}`);
      res.writeHead(up.status, { "Content-Type": up.contentType });
      res.end(up.text);
      return;
    }

    if (url.pathname === "/state" && req.method === "GET") {
      const up = await forward("/state", "GET", undefined);
      res.writeHead(up.status, { "Content-Type": up.contentType });
      res.end(up.text);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found", paths: ["/health", "/action", "/state"] }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[tee-proxy] error: ${msg}`);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msg }));
  }
}

const server = createServer((req, res) => {
  void handler(req, res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`tee-proxy listening on :${PORT} → ${UPSTREAM}`);
  console.log("Forwards /action and /state; refuses plaintext signal JSON dumps.");
});
