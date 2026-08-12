import { decodeShape } from "./decodeServer.js";

function stringToBytes32Hex(s: string) {
  const encoded = new TextEncoder().encode(s);
  const padded = new Uint8Array(32);
  padded.set(encoded);
  return "0x" + Buffer.from(padded).toString("hex");
}

function toHexUtf8(str: string): string {
  return "0x" + Buffer.from(str, "utf8").toString("hex");
}

function buildDataFixed(opType: string, opCommand: string, originalMessageHex: string) {
  return {
    instructionId: `0x${"11".repeat(32)}`,
    teeId: `0x${"22".repeat(20)}`,
    timestamp: Math.floor(Date.now() / 1000),
    rewardEpochId: 42,
    opType: stringToBytes32Hex(opType),
    opCommand: stringToBytes32Hex(opCommand),
    cosigners: [],
    cosignersThreshold: 0,
    originalMessage: originalMessageHex,
    additionalFixedMessage: "0x",
  };
}

function buildActionMessageHex(df: any): string {
  return toHexUtf8(JSON.stringify(df));
}

async function main() {
  // Stage B (MIRROR/MATCH_V1): originalMessage is ciphertext bytes (opaque to decoder).
  const stageBSignal = { asset: "FXRP", direction: "BUY", sizePct: 1000, nonce: "1" };
  const stageBCiphertextLike = toHexUtf8(JSON.stringify(stageBSignal));
  const stageBMsg = buildActionMessageHex(buildDataFixed("MIRROR", "MATCH_V1", stageBCiphertextLike));

  const outB = decodeShape({ message: stageBMsg });
  if (outB.opType !== "MIRROR" || outB.opCommand !== "MATCH_V1") {
    throw new Error("decodeShape: stageB op identifiers mismatch");
  }
  if (!outB.originalMessage || typeof outB.originalMessage.bytes !== "number") {
    throw new Error("decodeShape: stageB originalMessage bytes missing");
  }
  if (outB.greetingName) throw new Error("decodeShape: should not return greetingName for stageB");

  // Stage A (GREETING/SAY_HELLO): originalMessage contains non-sensitive JSON.
  const helloPayload = { name: "Mirror" };
  const helloMsg = buildActionMessageHex(buildDataFixed("GREETING", "SAY_HELLO", toHexUtf8(JSON.stringify(helloPayload))));

  const outA = decodeShape({ message: helloMsg });
  if (outA.opType !== "GREETING" || outA.opCommand !== "SAY_HELLO") {
    throw new Error("decodeShape: stageA op identifiers mismatch");
  }
  if (outA.greetingName !== "Mirror") {
    throw new Error("decodeShape: stageA greetingName mismatch");
  }

  console.log("OK: types-server /decode shape smoke");
}

main().catch((e) => {
  console.error("FAIL:", e?.message ?? String(e));
  process.exit(1);
});

