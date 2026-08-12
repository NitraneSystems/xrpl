"use client";

import { useState } from "react";
import { keccak256, toBytes, parseEther } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { config, STRATEGY_LABELS } from "@/lib/config";
import { registryAbi } from "@/lib/abis";

export default function LeadOnboardPage() {
  const { address, isConnected } = useAccount();
  const [strategyType, setStrategyType] = useState(0);
  const [feeRateBps, setFeeRateBps] = useState(200);
  const [minAllocation, setMinAllocation] = useState("0");
  const { writeContract, data: hash, error, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const teeHash = keccak256(toBytes(config.teeEncryptPubKey || "mirror-tee-placeholder"));

  function submit() {
    writeContract({
      address: config.registry,
      abi: registryAbi,
      functionName: "registerLead",
      args: [strategyType, feeRateBps, parseEther(minAllocation || "0"), teeHash],
    });
  }

  return (
    <section className="section form-panel">
      <h2>Lead onboarding</h2>
      <p>Register your strategy on MirrorRegistry. Followers encrypt signals to the TEE key.</p>
      {!isConnected && <p className="muted">Connect a wallet to continue.</p>}
      <label>
        Strategy type
        <select value={strategyType} onChange={(e) => setStrategyType(Number(e.target.value))}>
          {STRATEGY_LABELS.map((s, i) => (
            <option key={s} value={i}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        Fee rate (bps)
        <input
          type="number"
          min={0}
          max={2000}
          value={feeRateBps}
          onChange={(e) => setFeeRateBps(Number(e.target.value))}
        />
      </label>
      <label>
        Min allocation (FXRP)
        <input value={minAllocation} onChange={(e) => setMinAllocation(e.target.value)} />
      </label>
      <label>
        TEE public key hash
        <input className="field" readOnly value={teeHash} />
      </label>
      <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
        Share this encrypt pubkey with followers (env):{" "}
        {config.teeEncryptPubKey
          ? `${config.teeEncryptPubKey.slice(0, 24)}…`
          : "set NEXT_PUBLIC_TEE_ENCRYPT_PUBKEY"}
      </p>
      <button className="btn block" type="button" disabled={!isConnected || isPending || confirming} onClick={submit}>
        {isPending || confirming ? "Submitting…" : "Register lead"}
      </button>
      {isSuccess && <p className="ok">Registered. Wallet: {address}</p>}
      {error && <p className="err">{error.message}</p>}
    </section>
  );
}
