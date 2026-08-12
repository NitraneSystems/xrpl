/**
 * Client-side RSA-OAEP encryption of signal payload for TEE.
 * Requires NEXT_PUBLIC_TEE_ENCRYPT_PUBKEY as base64 SPKI (SubjectPublicKeyInfo).
 */
export type SignalPayload = {
  asset: string;
  direction: "BUY" | "SELL";
  sizePct: number;
  nonce: string;
  recipient: string;
};

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function encryptSignal(
  payload: SignalPayload,
  pubKeyB64: string,
): Promise<`0x${string}`> {
  if (!pubKeyB64) {
    throw new Error(
      "TEE encrypt public key missing. Set NEXT_PUBLIC_TEE_ENCRYPT_PUBKEY.",
    );
  }

  const key = await crypto.subtle.importKey(
    "spki",
    b64ToBuf(pubKeyB64),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, plaintext);
  const hex = Array.from(new Uint8Array(cipher))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}
