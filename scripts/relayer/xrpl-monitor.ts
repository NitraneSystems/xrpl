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
  http,
  parseAbi,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coston2 } from "../lib/chain.ts";
import { attestXrplPayment, resolveMasterAccountController } from "./fdc-payment.ts";

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

  // Build IPayment.Proof tuple: (merkleProof, data)
  const data = opts.proof.data as any;
  const proofTuple = {
    merkleProof: opts.proof.merkleProof,
    data: {
      attestationType: data.attestationType,
      sourceId: data.sourceId,
      votingRound: data.votingRound,
      lowestUsedTimestamp: data.lowestUsedTimestamp,
      requestBody: data.requestBody,
      responseBody: data.responseBody,
    },
  };

  const abi = parseAbi([
    "function executeInstruction(((bytes32[] merkleProof,(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp,(bytes32 transactionId,uint256 inUtxo,uint256 utxo) requestBody,(uint64 blockNumber,uint64 blockTimestamp,bytes32 sourceAddressHash,bytes32 sourceAddressesRoot,bytes32 receivingAddressHash,bytes32 intendedReceivingAddressHash,int256 spentAmount,int256 intendedSpentAmount,int256 receivedAmount,int256 intendedReceivedAmount,bytes32 standardPaymentReference,bool oneToOne,uint8 status) responseBody) data)) _proof, string _xrplAddress) payable",
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

  const hash = await wallet.writeContract({
    address: mac,
    abi,
    functionName: "executeInstruction",
    args: [proofTuple as never, opts.xrplAddress],
    value: fee > 0n && fee < 10n ** 18n ? fee : 0n,
    gas: 2_000_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`executeInstruction failed ${hash}`);

  const personalAccount = (await publicClient.readContract({
    address: mac,
    abi,
    functionName: "getPersonalAccount",
    args: [opts.xrplAddress],
  })) as Address;

  return { hash, personalAccount };
}

export async function processPayment(opts: {
  xrplAddress: string;
  txHash: string;
  lead?: Address;
}) {
  const st: PaymentStatus = {
    xrplAddress: opts.xrplAddress,
    txHash: opts.txHash,
    state: "requesting_fdc",
    updatedAt: new Date().toISOString(),
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
    st.state = bal > 0n ? "sub_account_active" : "minting_fxrp";
    if (bal === 0n) {
      st.message =
        (st.message ?? "") +
        " — PersonalAccount ready; complete custom-instruction onboard for Mirror vault credit";
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
      req.on("end", async () => {
        try {
          const j = JSON.parse(body) as { xrplAddress: string; txHash: string; lead?: string };
          const st = await processPayment({
            xrplAddress: j.xrplAddress,
            txHash: j.txHash,
            lead: j.lead as Address | undefined,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(st));
        } catch (e) {
          res.writeHead(500, { "Content-Type": "application/json" });
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
