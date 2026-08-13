"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { config, RISK_LABELS } from "@/lib/config";

type Step =
  | "idle"
  | "waiting_xrpl"
  | "requesting_fdc"
  | "minting_fxrp"
  | "sub_account_active"
  | "failed";

const STEPS: { id: Step; label: string }[] = [
  { id: "waiting_xrpl", label: "Waiting for XRPL confirmation" },
  { id: "requesting_fdc", label: "Requesting FDC proof" },
  { id: "minting_fxrp", label: "Minting FXRP" },
  { id: "sub_account_active", label: "Sub-account active" },
];

function toMemoData(hex: string): string {
  return hex.replace(/^0x/, "").toLowerCase();
}

/** Encode FXRP transfer-style 32-byte payment reference (type 0 cmd 1). */
function encodePaymentReference(recipient: string, valueDrops: bigint): `0x${string}` {
  const typeCmd = "01";
  const walletId = "00";
  const addr = recipient.replace(/^0x/, "").toLowerCase().padStart(40, "0");
  const value = valueDrops.toString(16).padStart(20, "0");
  return `0x${typeCmd}${walletId}${addr}${value}` as `0x${string}`;
}

export default function XrplOnboardPage() {
  const [lead, setLead] = useState("");
  const [amountXrp, setAmountXrp] = useState("2");
  const [risk, setRisk] = useState(1);
  const [xrplAddress, setXrplAddress] = useState("");
  const [txHash, setTxHash] = useState("");
  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");

  const paymentReference = useMemo(() => {
    if (!config.fsaOnboarder) return "0x" as `0x${string}`;
    const drops = BigInt(Math.floor(Number(amountXrp || "0") * 1_000_000));
    return encodePaymentReference(config.fsaOnboarder, drops > 0n ? drops : 1_000_000n);
  }, [amountXrp]);

  const memoData = useMemo(() => toMemoData(paymentReference), [paymentReference]);

  const xamanLink = useMemo(() => {
    // Xaman testnet deep link (payment intent JSON as query — simplified for demo)
    const payload = encodeURIComponent(
      JSON.stringify({
        TransactionType: "Payment",
        Destination: config.xrplOperator,
        Amount: String(Math.floor(Number(amountXrp || "2") * 1_000_000)),
        Memos: [{ Memo: { MemoData: memoData } }],
      }),
    );
    return `https://xumm.app/detect/request:${payload}`;
  }, [amountXrp, memoData]);

  const cliJson = useMemo(
    () =>
      JSON.stringify(
        {
          TransactionType: "Payment",
          Destination: config.xrplOperator,
          Amount: String(Math.floor(Number(amountXrp || "2") * 1_000_000)),
          Memos: [{ Memo: { MemoData: memoData } }],
          Mirror: { lead, riskProfile: RISK_LABELS[risk], onboarder: config.fsaOnboarder },
        },
        null,
        2,
      ),
    [amountXrp, memoData, lead, risk],
  );

  useEffect(() => {
    if (!xrplAddress || step === "idle" || step === "sub_account_active" || step === "failed") return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`${config.monitorUrl}/status/${encodeURIComponent(xrplAddress)}`);
        if (!res.ok) return;
        const j = (await res.json()) as { state?: Step; message?: string };
        if (j.state) setStep(j.state);
        if (j.message) setMessage(j.message);
      } catch {
        /* monitor may be offline */
      }
    }, 3000);
    return () => clearInterval(t);
  }, [xrplAddress, step]);

  async function notifyMonitor() {
    setErr("");
    if (!xrplAddress || !txHash) {
      setErr("Enter your XRPL address and payment tx hash after signing.");
      return;
    }
    setStep("waiting_xrpl");
    try {
      const res = await fetch(`${config.monitorUrl}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xrplAddress, txHash, lead: lead || undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setStep(j.state ?? "requesting_fdc");
      setMessage(j.message ?? "");
    } catch (e) {
      setStep("failed");
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  function stepIndex(s: Step) {
    const i = STEPS.findIndex((x) => x.id === s);
    return i < 0 ? -1 : i;
  }

  const activeIdx = stepIndex(step);

  return (
    <section className="section">
      <h2>XRPL Smart Account onboarding</h2>
      <p>
        No C2FLR required. Pay the Mirror operator on XRPL testnet with the generated 32-byte reference,
        then the monitor requests an FDC Payment proof and submits it to MasterAccountController.
      </p>
      {!config.monitorUrl && (
        <p className="err">
          XRPL monitor URL not set. Deploy Cloud Run and set NEXT_PUBLIC_XRPL_MONITOR_URL on Vercel.
        </p>
      )}

      <div className="form-panel">
        <label>
          Lead to follow
          <input placeholder="0x…" value={lead} onChange={(e) => setLead(e.target.value)} />
        </label>
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
          XRP amount (testnet)
          <input value={amountXrp} onChange={(e) => setAmountXrp(e.target.value)} />
        </label>
        <label>
          Operator destination
          <input className="field" readOnly value={config.xrplOperator} />
        </label>
        <label>
          Payment reference (32 bytes)
          <input className="field" readOnly value={paymentReference} />
        </label>
      </div>

      <div className="section" style={{ paddingTop: 0 }}>
        <h2 style={{ fontSize: "1.2rem" }}>Sign</h2>
        <p className="muted">Scan the QR in Xaman (testnet) or paste the CLI JSON into an xrpl Payment.</p>
        <p>
          <img
            alt="Xaman payment QR"
            width={220}
            height={220}
            style={{ background: "#fff", padding: 8, border: "1px solid var(--line)" }}
            src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(xamanLink)}`}
          />
        </p>
        <p>
          <a className="btn" href={xamanLink} target="_blank" rel="noreferrer">
            Open Xaman intent
          </a>
        </p>
        <pre
          style={{
            background: "var(--ink-2)",
            padding: "1rem",
            overflow: "auto",
            fontSize: "0.8rem",
            border: "1px solid var(--line)",
          }}
        >
          {cliJson}
        </pre>
      </div>

      <div className="form-panel">
        <label>
          Your XRPL address
          <input value={xrplAddress} onChange={(e) => setXrplAddress(e.target.value)} placeholder="r…" />
        </label>
        <label>
          Payment tx hash
          <input value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="…" />
        </label>
        <button className="btn block" type="button" onClick={notifyMonitor}>
          Track FDC / mint status
        </button>
      </div>

      <div className="section">
        <h2 style={{ fontSize: "1.2rem" }}>Status</h2>
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {STEPS.map((s, i) => {
            const done = activeIdx > i || step === "sub_account_active";
            const current = s.id === step;
            return (
              <li
                key={s.id}
                style={{
                  padding: "0.65rem 0",
                  borderBottom: "1px solid var(--line)",
                  color: current ? "var(--mint)" : done ? "var(--text)" : "var(--muted)",
                  fontWeight: current ? 600 : 400,
                }}
              >
                {done || current ? "●" : "○"} {s.label}
              </li>
            );
          })}
        </ol>
        {message && <p className="ok">{message}</p>}
        {err && <p className="err">{err}</p>}
        <p className="muted" style={{ marginTop: "1rem" }}>
          Prefer the EVM path? <Link href="/follower/onboard">Follower onboarding</Link>
        </p>
      </div>
    </section>
  );
}
