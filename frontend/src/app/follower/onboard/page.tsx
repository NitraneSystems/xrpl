"use client";

import { useState } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits } from "viem";
import { config, RISK_LABELS, FXRP_DECIMALS } from "@/lib/config";
import { registryAbi, vaultAbi, erc20Abi } from "@/lib/abis";

export default function FollowerOnboardPage() {
  const { address, isConnected } = useAccount();
  const [risk, setRisk] = useState(1);
  const [lead, setLead] = useState("");
  const [amount, setAmount] = useState("10");
  const [step, setStep] = useState<"idle" | "register" | "approve" | "deposit" | "follow">("idle");
  const { writeContractAsync, error } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  const [msg, setMsg] = useState("");

  async function run() {
    if (!address) return;
    setMsg("");
    try {
      setStep("register");
      await writeContractAsync({
        address: config.registry,
        abi: registryAbi,
        functionName: "registerFollower",
        args: [risk],
      });

      const amt = parseUnits(amount || "0", FXRP_DECIMALS);
      if (lead && amt > 0n) {
        const leadAddr = lead as `0x${string}`;
        setStep("approve");
        await writeContractAsync({
          address: config.fxrp,
          abi: erc20Abi,
          functionName: "approve",
          args: [config.vault, amt],
        });
        setStep("deposit");
        const dep = await writeContractAsync({
          address: config.vault,
          abi: vaultAbi,
          functionName: "deposit",
          args: [leadAddr, amt],
        });
        setTxHash(dep);
        setStep("follow");
        await writeContractAsync({
          address: config.registry,
          abi: registryAbi,
          functionName: "followLead",
          args: [leadAddr, amt],
        });
      }
      setMsg("Follower onboarding complete.");
      setStep("idle");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setStep("idle");
    }
  }

  return (
    <section className="section form-panel">
      <h2>Follower onboarding</h2>
      <p>Register risk profile, approve FXRP, deposit into MirrorVault, then follow a lead.</p>
      {!isConnected && <p className="muted">Connect a wallet to continue.</p>}
      <label>
        Risk profile
        <select value={risk} onChange={(e) => setRisk(Number(e.target.value))}>
          {RISK_LABELS.map((r, i) => (
            <option key={r} value={i}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label>
        Lead to follow (optional)
        <input placeholder="0x…" value={lead} onChange={(e) => setLead(e.target.value)} />
      </label>
      <label>
        Deposit amount (FXRP)
        <input value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <button className="btn block" type="button" disabled={!isConnected || step !== "idle"} onClick={run}>
        {step === "idle" ? "Register & deposit" : `Working: ${step}…`}
      </button>
      <p className="muted" style={{ marginTop: "1rem" }}>
        XRPL-only path (no C2FLR): <a href="/follower/xrpl">Smart Account onboarding</a>
      </p>
      {(msg || isSuccess) && <p className={msg.startsWith("Follower") ? "ok" : "err"}>{msg || "Done"}</p>}
      {error && <p className="err">{error.message}</p>}
    </section>
  );
}
