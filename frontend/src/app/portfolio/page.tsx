"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatUnits, parseAbiItem, type Log } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { config, STRATEGY_LABELS } from "@/lib/config";
import { registryAbi, vaultAbi, leaderboardAbi } from "@/lib/abis";

type HealthBadge = "Healthy" | "Drift Detected" | "Liquidation Risk";

type Position = {
  lead: `0x${string}`;
  balance: bigint;
  pending: bigint;
  score: number;
  strategy: string;
  health: HealthBadge;
  epochPnlFxrp: number;
  tradeSummary: string;
};

const FXRP_DECIMALS = 6;

const depositedEvent = parseAbiItem(
  "event Deposited(address indexed follower, address indexed lead, uint256 amount)",
);
const settledEvent = parseAbiItem(
  "event SettledFromProof(address indexed follower, address indexed lead, int256 delta)",
);

function plainLanguageSummary(strategy: string, pnl: number, score: number): string {
  const dir =
    pnl > 0 ? "ahead on epoch P&L" : pnl < 0 ? "behind on epoch P&L" : "flat on epoch P&L";
  return `${strategy} lead — ${dir}; AI score ${score}/100 (classification-level only).`;
}

export default function PortfolioPage() {
  const { address, isConnected } = useAccount();
  const client = usePublicClient();
  const [positions, setPositions] = useState<Position[]>([]);
  const [epochLabel, setEpochLabel] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!client || !address) return;
    (async () => {
      try {
        const block = await client.getBlockNumber();
        // ~90s FTSO epochs ≈ 50 blocks @1.8s; label for UI only
        const epoch = Number(block / 50n);
        setEpochLabel(`Epoch ~${epoch} (block ${block})`);

        const alertMap = new Map<string, HealthBadge>();
        try {
          const alertRes = await fetch(config.alertsUrl);
          if (alertRes.ok) {
            const alerts = (await alertRes.json()) as Array<{
              type: string;
              lead?: string;
              follower?: string;
            }>;
            for (const a of alerts) {
              if (a.follower && a.follower.toLowerCase() !== address.toLowerCase()) continue;
              if (!a.lead) continue;
              if (a.type === "liquidation_risk") alertMap.set(a.lead.toLowerCase(), "Liquidation Risk");
              else if (a.type === "drift" && !alertMap.has(a.lead.toLowerCase())) {
                alertMap.set(a.lead.toLowerCase(), "Drift Detected");
              }
            }
          }
        } catch {
          /* alerts optional */
        }

        const leads = (await client.readContract({
          address: config.registry,
          abi: registryAbi,
          functionName: "getFollowedLeads",
          args: [address],
        })) as `0x${string}`[];

        const fromBlock = block > 50_000n ? block - 50_000n : 0n;
        const depositLogs = (await client.getLogs({
          address: config.vault,
          event: depositedEvent,
          args: { follower: address },
          fromBlock,
          toBlock: block,
        })) as Log[];
        const settleLogs = (await client.getLogs({
          address: config.vault,
          event: settledEvent,
          args: { follower: address },
          fromBlock,
          toBlock: block,
        })) as Log[];

        const depositedByLead = new Map<string, bigint>();
        for (const log of depositLogs) {
          const args = log.args as { lead?: `0x${string}`; amount?: bigint };
          if (!args.lead || args.amount === undefined) continue;
          const k = args.lead.toLowerCase();
          depositedByLead.set(k, (depositedByLead.get(k) ?? 0n) + args.amount);
        }
        const settleByLead = new Map<string, bigint>();
        for (const log of settleLogs) {
          const args = log.args as { lead?: `0x${string}`; delta?: bigint };
          if (!args.lead || args.delta === undefined) continue;
          const k = args.lead.toLowerCase();
          settleByLead.set(k, (settleByLead.get(k) ?? 0n) + args.delta);
        }

        const rows: Position[] = [];
        for (const lead of leads) {
          const balance = (await client.readContract({
            address: config.vault,
            abi: vaultAbi,
            functionName: "getBalance",
            args: [address, lead],
          })) as bigint;
          const pending = (await client.readContract({
            address: config.vault,
            abi: vaultAbi,
            functionName: "getPendingWithdrawal",
            args: [address, lead],
          })) as bigint;
          const scoreRec = await client.readContract({
            address: config.leaderboard,
            abi: leaderboardAbi,
            functionName: "getScore",
            args: [lead],
          });
          const leadInfo = await client.readContract({
            address: config.registry,
            abi: registryAbi,
            functionName: "getLead",
            args: [lead],
          });
          const strategy = STRATEGY_LABELS[Number(leadInfo.strategyType)] ?? "unknown";
          const score = Number(scoreRec.score);
          const deposited = depositedByLead.get(lead.toLowerCase()) ?? 0n;
          const settled = settleByLead.get(lead.toLowerCase()) ?? 0n;
          // Epoch P&L ≈ FDC-settled deltas; fallback balance − deposits when no settle logs.
          const pnlWei = settled !== 0n ? settled : balance - deposited;
          const epochPnlFxrp = Number(formatUnits(pnlWei, FXRP_DECIMALS));
          rows.push({
            lead,
            balance,
            pending,
            score,
            strategy,
            health: alertMap.get(lead.toLowerCase()) ?? "Healthy",
            epochPnlFxrp,
            tradeSummary: plainLanguageSummary(strategy, epochPnlFxrp, score),
          });
        }
        setPositions(rows);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [client, address]);

  return (
    <section className="section">
      <h2>Portfolio</h2>
      <p>
        Per-lead vault balances from live Coston2. Epoch P&L from FDC settle / deposit logs.
        Trade summaries are classification-level only (PRD §6.2/§7).
      </p>
      {epochLabel && <p className="muted">{epochLabel}</p>}
      {!isConnected && <p className="muted">Connect to load positions.</p>}
      {err && <p className="err">{err}</p>}
      {isConnected && positions.length === 0 && !err && (
        <p className="muted">
          No followed leads yet. <Link href="/">Discover leads</Link>
        </p>
      )}
      {positions.length > 0 && (
        <table className="lead-table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Strategy</th>
              <th>Health</th>
              <th>AI Score</th>
              <th>Balance</th>
              <th>Epoch P&L</th>
              <th>Pending out</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.lead}>
                <td>
                  <Link href={`/lead/${p.lead}`}>
                    {p.lead.slice(0, 8)}…{p.lead.slice(-6)}
                  </Link>
                </td>
                <td>
                  <span className="badge">{p.strategy}</span>
                </td>
                <td>
                  <span className="badge">{p.health}</span>
                </td>
                <td className="score">{p.score}</td>
                <td>{formatUnits(p.balance, FXRP_DECIMALS)} FXRP</td>
                <td>
                  {p.epochPnlFxrp >= 0 ? "+" : ""}
                  {p.epochPnlFxrp.toFixed(4)} FXRP
                </td>
                <td>{formatUnits(p.pending, FXRP_DECIMALS)} FXRP</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {positions.length > 0 && (
        <div className="section" style={{ paddingTop: "1.5rem" }}>
          <h2 style={{ fontSize: "1.15rem" }}>Trade summaries</h2>
          <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
            {positions.map((p) => (
              <li key={`sum-${p.lead}`} className="muted" style={{ marginBottom: "0.5rem" }}>
                {p.tradeSummary}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
