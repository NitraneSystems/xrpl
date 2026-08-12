/**
 * Fund XRPL testnet account for the XRPL Smart Account (FSA) follower flow.
 *
 * Uses the public tequ faucet:
 *   https://faucet.tequ.dev/
 *
 * NOTE: This is an external write (requests test tokens). It is only used to
 * satisfy Phase 0 funding for the XRPL persona.
 */
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import { Client, Wallet } from "xrpl";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

dotenv.config({ path: join(ROOT, ".env") });

const ACCOUNTS_PATH = join(ROOT, "config/accounts.testnet.json");

async function main() {
  if (!existsSync(ACCOUNTS_PATH)) {
    throw new Error("config/accounts.testnet.json missing — run provision:personas first");
  }

  const accounts = JSON.parse(readFileSync(ACCOUNTS_PATH, "utf8"));
  const seed = process.env.XRPL_FOLLOWER_FSA_1_SECRET;
  if (!seed) {
    throw new Error("XRPL_FOLLOWER_FSA_1_SECRET missing from .env");
  }

  const wallet = Wallet.fromSeed(seed);
  const faucetUrl = "https://faucet.tequ.dev/accounts";

  console.log(`Requesting XRPL faucet for ${wallet.address}...`);
  const res = await fetch(faucetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destination: wallet.address }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`XRPL faucet failed: ${res.status} ${text}`);
  }

  console.log(`Faucet response: ${text || res.status}`);

  // Best-effort verification.
  const client = new Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();
  const bal = await client.getXrpBalance(wallet.address);
  await client.disconnect();

  console.log(`XRPL balance now: ${bal} XRP`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

