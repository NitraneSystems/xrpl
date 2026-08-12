"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { config } from "@/lib/config";
import { instructionSenderAbi } from "@/lib/abis";
import { encryptSignal } from "@/lib/encrypt";

export default function SignalPage() {
  const { address, isConnected } = useAccount();
  const [asset, setAsset] = useState("FXRP");
  const [direction, setDirection] = useState<"BUY" | "SELL">("BUY");
  const [sizePct, setSizePct] = useState(10);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const { writeContractAsync, isPending } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const { isSuccess, isLoading } = useWaitForTransactionReceipt({ hash });

  async function submit() {
    setErr("");
    setStatus("");
    if (!address) return;
    try {
      if (!config.teeEncryptPubKey) {
        throw new Error(
          "TEE encrypt public key missing. Set NEXT_PUBLIC_TEE_ENCRYPT_PUBKEY — plaintext will not be sent.",
        );
      }
      const encrypted = await encryptSignal(
        {
          asset,
          direction,
          sizePct,
          nonce: crypto.randomUUID(),
          recipient: address,
        },
        config.teeEncryptPubKey,
      );
      setStatus("Encrypted. Submitting Stage B…");
      const tx = await writeContractAsync({
        address: config.instructionSender,
        abi: instructionSenderAbi,
        functionName: "sendMirrorMatchStageB",
        args: [encrypted],
        value: 0n,
      });
      setHash(tx);
      setStatus(`Submitted ${tx}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section className="section form-panel">
      <h2>Encrypted signal</h2>
      <p>Payload is encrypted in-browser to the TEE public key before InstructionSender Stage B.</p>
      {!isConnected && <p className="muted">Connect as lead to submit.</p>}
      <label>
        Asset
        <input value={asset} onChange={(e) => setAsset(e.target.value)} />
      </label>
      <label>
        Direction
        <select value={direction} onChange={(e) => setDirection(e.target.value as "BUY" | "SELL")}>
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
      </label>
      <label>
        Size % ({sizePct})
        <input
          type="range"
          min={1}
          max={100}
          value={sizePct}
          onChange={(e) => setSizePct(Number(e.target.value))}
        />
      </label>
      <button
        className="btn block"
        type="button"
        disabled={!isConnected || isPending || isLoading}
        onClick={submit}
      >
        {isPending || isLoading ? "Sending…" : "Encrypt & submit"}
      </button>
      {status && <p className="ok">{status}</p>}
      {isSuccess && <p className="ok">Confirmed on Coston2.</p>}
      {err && <p className="err">{err}</p>}
    </section>
  );
}
