"use client";

import { useState } from "react";
import { parseUnits } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { config, FXRP_DECIMALS } from "@/lib/config";
import { vaultAbi } from "@/lib/abis";

export default function WithdrawPage() {
  const { isConnected } = useAccount();
  const [lead, setLead] = useState("");
  const [amount, setAmount] = useState("1");
  const { writeContract, data: hash, error, isPending } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  function submit() {
    writeContract({
      address: config.vault,
      abi: vaultAbi,
      functionName: "requestWithdrawal",
      args: [lead as `0x${string}`, parseUnits(amount || "0", FXRP_DECIMALS)],
    });
  }

  return (
    <section className="section form-panel">
      <h2>Request withdrawal</h2>
      <p>Queues a withdrawal from MirrorVault for a followed lead.</p>
      {!isConnected && <p className="muted">Connect a wallet to continue.</p>}
      <label>
        Lead address
        <input placeholder="0x…" value={lead} onChange={(e) => setLead(e.target.value)} />
      </label>
      <label>
        Amount (FXRP)
        <input value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <button
        className="btn block"
        type="button"
        disabled={!isConnected || !lead || isPending || isLoading}
        onClick={submit}
      >
        {isPending || isLoading ? "Submitting…" : "Request withdrawal"}
      </button>
      {isSuccess && <p className="ok">Withdrawal requested.</p>}
      {error && <p className="err">{error.message}</p>}
    </section>
  );
}
