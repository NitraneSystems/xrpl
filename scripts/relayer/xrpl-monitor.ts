/**
 * XRPL monitor for Mirror FSA onboarding.
 * Watches operator address payments, requests FDC Payment proofs, submits executeInstruction,
 * and exposes a tiny status HTTP API for the UI stepper.
 */
import * as dotenv from "dotenv";
import { createServer } from "http";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Client, type TransactionStream } from "xrpl";
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  http,
  parseAbi,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2 } from "../lib/chain.ts";
import {
  attestXrplPayment,
  resolveMasterAccountController,
  EXECUTE_INSTRUCTION_ABI,
  toPaymentProofArg,
} from "./fdc-payment.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: join(ROOT, ".env") });

const STATUS_DIR =
  process.env.FSA_STATUS_DIR ??
  (process.env.K_SERVICE ? "/tmp/mirror-fsa-status" : join(ROOT, "scripts/.fsa-status"));
const PORT = Number(process.env.PORT ?? process.env.XRPL_MONITOR_PORT ?? 8787);

export type StepperState =
  | "waiting_xrpl"
  | "requesting_fdc"
  | "minting_fxrp"
  | "sub_account_active"
  | "failed";

export type PaymentStatus = {
  xrplAddress: string;
  txHash?: string;
  state: StepperState;
  message?: string;
  personalAccount?: string;
  vaultBalance?: string;
  updatedAt: string;
};

const statuses = new Map<string, PaymentStatus>();

function statusKey(xrpl: string, txHash?: string) {
  return `${xrpl}:${txHash ?? "pending"}`.toLowerCase();
}

function persist(s: PaymentStatus) {
  statuses.set(statusKey(s.xrplAddress, s.txHash), s);
  statuses.set(s.xrplAddress.toLowerCase(), s);
  mkdirSync(STATUS_DIR, { recursive: true });
  writeFileSync(join(STATUS_DIR, `${s.xrplAddress}.json`), JSON.stringify(s, null, 2));
}

export function getStatus(xrplOrKey: string): PaymentStatus | undefined {
  const k = xrplOrKey.toLowerCase();
  if (statuses.has(k)) return statuses.get(k);
  const path = join(STATUS_DIR, `${xrplOrKey}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as PaymentStatus;
  return undefined;
}

async function loadOperatorAddress(): Promise<string> {
  if (process.env.XRPL_OPERATOR_ADDRESS) return process.env.XRPL_OPERATOR_ADDRESS;
  const cfgPath = join(ROOT, "config/coston2.json");
  if (existsSync(cfgPath)) {
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    if (cfg.fsa?.xrplOperatorAddress) return cfg.fsa.xrplOperatorAddress as string;
  }
  const mac = await resolveMasterAccountController();
  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const wallets = (await publicClient.readContract({
    address: mac,
    abi: parseAbi(["function getXrplProviderWallets() view returns (string[])"]),
    functionName: "getXrplProviderWallets",
  })) as string[];
  if (!wallets.length) throw new Error("No XRPL provider wallets from MasterAccountController");
  return wallets[0]!;
}

const MAC_ERRORS = parseAbi([
  "error FAssetBalanceTooLow()",
  "error TransactionAlreadyExecuted()",
  "error InvalidReceivingAddress()",
  "error InvalidSourceAddress()",
  "error ValueZero()",
  "error InvalidInstructionId(uint8)",
  "error InvalidMemoData()",
  "error CallFailed(bytes)",
]);

function revertDataOf(err: unknown): `0x${string}` | undefined {
  let cur: any = err;
  for (let i = 0; i < 6 && cur; i++) {
    if (typeof cur.data === "string" && cur.data.startsWith("0x") && cur.data.length >= 10) {
      return cur.data as `0x${string}`;
    }
    cur = cur.cause;
  }
  return undefined;
}

function decodeMacRevert(err: unknown): string {
  const data = revertDataOf(err);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: MAC_ERRORS, data });
      if (decoded.errorName === "FAssetBalanceTooLow") {
        return "FAssetBalanceTooLow: the PersonalAccount has 0 FXRP. executeInstruction(transfer) cannot mint; it only moves FXRP already minted via FAssets Core Vault. Coston2 Core Vault mint liquidity is often empty.";
      }
      return `executeInstruction reverted: ${decoded.errorName}`;
    } catch {
      if (data.slice(0, 10).toLowerCase() === "0xdb7b48e3") {
        return "FAssetBalanceTooLow: the PersonalAccount has 0 FXRP. executeInstruction(transfer) cannot mint; it only moves already-minted FXRP.";
      }
      return `executeInstruction reverted ${data.slice(0, 10)}`;
    }
  }
  const anyErr = err as { shortMessage?: string; message?: string };
  return anyErr.shortMessage ?? anyErr.message ?? "executeInstruction simulation failed";
}

async function executeInstructionOnMac(opts: {
  proof: Awaited<ReturnType<typeof attestXrplPayment>>;
  xrplAddress: string;
}) {
  const pk = (process.env.PERSONA_OPERATOR_RELAYER_PRIVATE_KEY ??
    process.env.DEPLOYER_PRIVATE_KEY ??
    process.env.PERSONA_DEPLOYER_PRIVATE_KEY) as Hex | undefined;
  if (!pk) throw new Error("Missing operator/deployer private key for executeInstruction");

  const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: coston2, transport: http(rpc) });
  const mac = await resolveMasterAccountController();

  const proofTuple = toPaymentProofArg(opts.proof);
  if (!proofTuple.merkleProof.length) {
    throw new Error("FDC DA proof missing merkleProof — cannot executeInstruction");
  }

  const abi = parseAbi([
    ...EXECUTE_INSTRUCTION_ABI,
    "function getPersonalAccount(string) view returns (address)",
    "function getDefaultInstructionFee() view returns (uint256)",
  ]);

  let fee = 0n;
  try {
    fee = (await publicClient.readContract({
      address: mac,
      abi,
      functionName: "getDefaultInstructionFee",
    })) as bigint;
  } catch {
    fee = 0n;
  }

  const execArgs = {
    address: mac,
    abi,
    functionName: "executeInstruction" as const,
    args: [proofTuple as never, opts.xrplAddress] as const,
    value: fee > 0n && fee < 10n ** 18n ? fee : 0n,
    gas: 2_000_000n,
    account,
  };

  try {
    await publicClient.simulateContract(execArgs);
  } catch (e) {
    const decoded = decodeMacRevert(e);
    if (/TransactionAlreadyExecuted/i.test(decoded)) {
      const personalAccount = (await publicClient.readContract({
        address: mac,
        abi,
        functionName: "getPersonalAccount",
        args: [opts.xrplAddress],
      })) as Address;
      return { hash: "already-executed" as Hex, personalAccount };
    }
    throw new Error(decoded);
  }

  const hash = await wallet.writeContract(execArgs);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`executeInstruction reverted on-chain ${hash}`);
  }

  const personalAccount = (await publicClient.readContract({
    address: mac,
    abi,
    functionName: "getPersonalAccount",
    args: [opts.xrplAddress],
  })) as Address;

  return { hash, personalAccount };
}

const inflight = new Map<string, Promise<PaymentStatus>>();

function paymentKey(txHash: string) {
  return txHash.replace(/^0x/i, "").toLowerCase();
}

export async function processPayment(opts: {
  xrplAddress: string;
  txHash: string;
  lead?: Address;
}) {
  const key = paymentKey(opts.txHash);
  const existing = inflight.get(key);
  if (existing) return existing;

  const cached = getStatus(opts.xrplAddress);
  if (
    cached &&
    cached.txHash &&
    paymentKey(cached.txHash) === key &&
    (cached.state === "minting_fxrp" || cached.state === "sub_account_active")
  ) {
    return cached;
  }

  const run = runProcessPayment(opts).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

async function runProcessPayment(opts: {
  xrplAddress: string;
  txHash: string;
  lead?: Address;
}): Promise<PaymentStatus> {
  const st: PaymentStatus = {
    xrplAddress: opts.xrplAddress,
    txHash: opts.txHash,
    state: "requesting_fdc",
    updatedAt: new Date().toISOString(),
    message: "Requesting FDC Payment attestation (one round, typically 1–3 min)",
  };
  persist(st);

  try {
    const proof = await attestXrplPayment(opts.txHash);
    st.state = "minting_fxrp";
    st.message = `FDC round ${proof.roundId}`;
    persist(st);

    const { personalAccount, hash } = await executeInstructionOnMac({
      proof,
      xrplAddress: opts.xrplAddress,
    });
    st.personalAccount = personalAccount;
    st.message = `executeInstruction ${hash}`;

    // Check vault if config present
    const cfg = JSON.parse(readFileSync(join(ROOT, "config/coston2.json"), "utf8"));
    const vault = getAddress(cfg.contracts.mirrorVault) as Address;
    const lead = opts.lead ?? (getAddress(cfg.fsa?.defaultLead ?? personalAccount) as Address);
    const rpc = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
    const publicClient = createPublicClient({ chain: coston2, transport: http(rpc) });
    const bal = (await publicClient.readContract({
      address: vault,
      abi: parseAbi([
        "function getBalance(address follower, address lead) view returns (uint256)",
      ]),
      functionName: "getBalance",
      args: [personalAccount, lead],
    })) as bigint;
    st.vaultBalance = bal.toString();
    // executeInstruction success = PersonalAccount is live. Vault follow is a separate onboard()
    // call; do not leave the UI stuck on minting_fxrp when vault balance is still 0.
    st.state = "sub_account_active";
    if (bal === 0n) {
      st.message =
        (st.message ?? "") +
        ` — PersonalAccount ${personalAccount} is active. Mirror vault follow still needs onboard().`;
    }
    persist(st);
    return st;
  } catch (e) {
    st.state = "failed";
    st.message = e instanceof Error ? e.message : String(e);
    persist(st);
    throw e;
  }
}

function startStatusServer() {
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname.startsWith("/status/")) {
      const xrpl = decodeURIComponent(url.pathname.slice("/status/".length));
      const st = getStatus(xrpl);
      res.writeHead(st ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify(st ?? { error: "not found" }));
      return;
    }
    if (url.pathname === "/process" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const j = JSON.parse(body) as { xrplAddress: string; txHash: string; lead?: string };
          if (!j.xrplAddress || !j.txHash) throw new Error("xrplAddress and txHash required");
          void processPayment({
            xrplAddress: j.xrplAddress,
            txHash: j.txHash,
            lead: j.lead as Address | undefined,
          }).catch((e) => console.error("processPayment", e));
          const st = getStatus(j.xrplAddress) ?? {
            xrplAddress: j.xrplAddress,
            txHash: j.txHash,
            state: "requesting_fdc" as StepperState,
            message: "Requesting FDC Payment attestation (one round, typically 1–3 min)",
            updatedAt: new Date().toISOString(),
          };
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify(st));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      });
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`FSA status API http://0.0.0.0:${PORT}/status/:xrplAddress`);
  });
  return server;
}

async function watch() {
  const operator = await loadOperatorAddress();
  console.log(`Watching XRPL operator ${operator}`);

  // Local only: persist operator into config for UI. Cloud Run filesystem is read-only.
  if (!process.env.K_SERVICE) {
    try {
      const cfgPath = join(ROOT, "config/coston2.json");
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      cfg.fsa = { ...(cfg.fsa ?? {}), xrplOperatorAddress: operator, operators: [operator] };
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
    } catch {
      /* optional */
    }
  }

  startStatusServer();

  const rpc = process.env.XRPL_TESTNET_RPC_URL ?? "wss://s.altnet.rippletest.net:51233";
  const client = new Client(rpc);
  await client.connect();
  await client.request({
    command: "subscribe",
    accounts: [operator],
  });

  client.on("transaction", async (tx: TransactionStream) => {
    try {
      const tr = tx.tx_json ?? (tx as any).transaction;
      if (!tr || tr.TransactionType !== "Payment") return;
      if (tr.Destination !== operator) return;
      const hash = tx.hash ?? (tx as any).hash;
      const account = tr.Account as string;
      if (!hash || !account) return;
      console.log(`Payment seen ${hash} from ${account}`);
      persist({
        xrplAddress: account,
        txHash: hash,
        state: "waiting_xrpl",
        updatedAt: new Date().toISOString(),
      });
      await processPayment({ xrplAddress: account, txHash: hash });
    } catch (e) {
      console.error("monitor error", e);
    }
  });

  console.log("XRPL monitor running");
}

if (process.argv[1]?.includes("xrpl-monitor")) {
  watch().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
