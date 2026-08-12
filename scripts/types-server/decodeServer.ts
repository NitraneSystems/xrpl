import http from "node:http";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";
import path from "node:path";

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0) throw new Error("hex must have even length");
  return new Uint8Array(Buffer.from(normalized, "hex"));
}

function bytes32HexToString(hex: string): string {
  const b = hexToBytes(hex);
  // bytes32 is padded with zeros; strip trailing zeros.
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return Buffer.from(b.slice(0, end)).toString("utf-8");
}

function decodeDataFixedFromActionMessage(actionMessageHex: string): any {
  const bytes = hexToBytes(actionMessageHex);
  const json = Buffer.from(bytes).toString("utf-8");
  return JSON.parse(json);
}

function safeJsonParseBytes(bytes: Uint8Array): any | null {
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf-8"));
  } catch {
    return null;
  }
}

export function decodeShape(payload: any): any {
  const actionMessageHex = payload?.message ?? payload?.data?.message ?? payload?.action?.data?.message;
  if (typeof actionMessageHex !== "string" || !actionMessageHex.startsWith("0x")) {
    throw new Error("missing action.data.message hex (expected 0x...)" );
  }

  const df = decodeDataFixedFromActionMessage(actionMessageHex);
  const opTypeHex = df?.opType;
  const opCommandHex = df?.opCommand;
  const originalMessageHex = df?.originalMessage ?? "0x";

  const opType = typeof opTypeHex === "string" ? bytes32HexToString(opTypeHex) : null;
  const opCommand = typeof opCommandHex === "string" ? bytes32HexToString(opCommandHex) : null;

  const originalMessageBytes = typeof originalMessageHex === "string" ? hexToBytes(originalMessageHex).length : 0;

  // For the Stage A GREETING canary, the originalMessage is non-sensitive JSON bytes.
  // For Stage B, we never decrypt; we only report ciphertext shape (length).
  let greetingName: string | null = null;
  if (opType === "GREETING" && opCommand === "SAY_HELLO" && typeof originalMessageHex === "string") {
    const parsed = safeJsonParseBytes(hexToBytes(originalMessageHex));
    if (parsed && typeof parsed.name === "string") greetingName = parsed.name;
  }

  return {
    instructionId: df?.instructionId ?? null,
    teeId: df?.teeId ?? null,
    timestamp: df?.timestamp ?? null,
    rewardEpochId: df?.rewardEpochId ?? null,
    opType,
    opCommand,
    originalMessage: {
      bytes: originalMessageBytes,
      // Avoid echoing ciphertext in CI logs; the contract never needs it.
      hexPrefix: typeof originalMessageHex === "string" ? originalMessageHex.slice(0, 18) : null,
    },
    ...(greetingName ? { greetingName } : {}),
  };
}

async function main() {
  const port = Number(process.env.TYPES_SERVER_PORT ?? "8200");

  const server = http.createServer(async (req, res) => {
    if (!req.url) return res.writeHead(404).end();

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    if (req.method !== "POST" || url.pathname !== "/decode") {
      res.writeHead(404).end("not found");
      return;
    }

    try {
      const raw: Buffer[] = [];
      req.on("data", (c) => raw.push(c));
      req.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(raw).toString("utf8"));
          const decoded = decodeShape(body);
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(decoded));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(e) }));
        }
      });
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });

  server.listen(port, () => {
    console.log(`types-server listening on :${port} (POST /decode)`);
  });
}

const thisFile = path.resolve(fileURLToPath(import.meta.url));
const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedAs && invokedAs === thisFile) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}

