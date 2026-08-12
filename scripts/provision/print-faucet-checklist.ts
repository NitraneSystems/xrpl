import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CONFIG_PATH = join(ROOT, "config/accounts.testnet.json");
const FAUCET_URL = "https://faucet.flare.network/coston2";

interface AccountsConfig {
  personas: Record<string, { address: string; role: string }>;
  xrpl?: Record<string, { address: string; role: string }>;
}

function main() {
  if (!existsSync(CONFIG_PATH)) {
    console.error("config/accounts.testnet.json not found. Run: pnpm provision:personas");
    process.exit(1);
  }

  const config: AccountsConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

  console.log("=== Coston2 Faucet Funding Checklist ===\n");
  console.log(`Faucet: ${FAUCET_URL}\n`);
  console.log("For each address below, request: C2FLR + USDT0 + FXRP (100/10/10 per 24h)\n");

  let i = 1;
  for (const [key, { address, role }] of Object.entries(config.personas)) {
    console.log(`${i}. ${key}`);
    console.log(`   Address: ${address}`);
    console.log(`   Role:    ${role}`);
    console.log(`   Explorer: https://coston2-explorer.flare.network/address/${address}`);
    console.log("");
    i++;
  }

  if (config.xrpl) {
    console.log("--- XRPL Testnet (Phase 8 — fund separately via XRPL testnet faucet) ---\n");
    for (const [key, { address, role }] of Object.entries(config.xrpl)) {
      console.log(`${i}. ${key}`);
      console.log(`   Address: ${address}`);
      console.log(`   Role:    ${role}`);
      console.log(`   Faucet:  https://faucet.tequ.dev/`);
      console.log("");
      i++;
    }
  }

  console.log("Priority: fund deployer first (needed for contract deployment).");
}

main();
