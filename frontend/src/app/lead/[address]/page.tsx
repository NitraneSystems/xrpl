"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { config, STRATEGY_LABELS } from "@/lib/config";
import { leaderboardAbi, registryAbi } from "@/lib/abis";

export default function LeadProfilePage() {
  const params = useParams<{ address: string }>();
  const lead = params.address as `0x${string}`;
  const client = usePublicClient();
  const { isConnected } = useAccount();
  const [score, setScore] = useState<number | null>(null);
  const [attestationId, setAttestationId] = useState<string>("");
  const [strategyType, setStrategyType] = useState(0);
  const [verified, setVerified] = useState(false);
  const [feeRateBps, setFeeRateBps] = useState(0);
  const [allocation, setAllocation] = useState("10");
  const [err, setErr] = useState("");

  const { writeContract, data: hash, error, isPending } = useWriteContract();
  const { isSuccess, isLoading } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (!client || !lead) return;
    (async () => {
      try {
        const s = await client.readContract({
          address: config.leaderboard,
          abi: leaderboardAbi,
          functionName: "getScore",
          args: [lead],
        });
        const l = await client.readContract({
          address: config.registry,
          abi: registryAbi,
          functionName: "getLead",
          args: [lead],
        });
        setScore(Number(s.score));
        setAttestationId(s.attestationId);
        setStrategyType(Number(l.strategyType));
        setVerified(Boolean(l.verified));
        setFeeRateBps(Number(l.feeRateBps));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [client, lead]);

  function follow() {
    writeContract({
      address: config.registry,
      abi: registryAbi,
      functionName: "followLead",
      args: [lead, parseEther(allocation || "0")],
    });
  }

  return (
    <section className="section profile-hero">
      <p className="muted">Lead profile</p>
      <h2 style={{ wordBreak: "break-all" }}>{lead}</h2>
      <div className="score-xl">{score ?? "—"}</div>
      <p>
        <span className="badge">{STRATEGY_LABELS[strategyType] ?? "unknown"}</span>
        {verified && <span className="badge" style={{ marginLeft: 8 }}>verified</span>}
        <span className="muted" style={{ marginLeft: 12 }}>
          fee {(feeRateBps / 100).toFixed(2)}%
        </span>
      </p>
      {attestationId && attestationId !== "0x" + "0".repeat(64) && (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Attestation:{" "}
          <a
            href={`https://coston2-explorer.flare.network`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--mint)" }}
          >
            {attestationId.slice(0, 18)}…
          </a>
        </p>
      )}
      <label>
        Allocation (FXRP, for follow)
        <input value={allocation} onChange={(e) => setAllocation(e.target.value)} />
      </label>
      <button
        className="btn"
        type="button"
        disabled={!isConnected || isPending || isLoading}
        onClick={follow}
      >
        {isPending || isLoading ? "Following…" : "Follow"}
      </button>
      <p>
        <Link href="/follower/onboard">Need to register as follower first?</Link>
      </p>
      {isSuccess && <p className="ok">Follow submitted.</p>}
      {(err || error) && <p className="err">{err || error?.message}</p>}
    </section>
  );
}
