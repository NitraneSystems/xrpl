import { HDNodeWallet, Mnemonic, Wallet } from "ethers";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Wallet as XrplWallet } from "xrpl";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CONFIG_PATH = join(ROOT, "config/accounts.testnet.json");
const ENV_PATH = join(ROOT, ".env");

const PERSONAS = [
  { key: "deployer", index: 0, role: "Contract deploy + FXRP/USDT0 reserve" },
  { key: "lead-trader-1", index: 1, role: "Lead trader (drift testing Phase 9)" },
  { key: "lead-trader-2", index: 2, role: "Lead trader (drift testing Phase 9)" },
  { key: "follower-evm-1", index: 3, role: "Follower EVM wallet 1" },
  { key: "follower-evm-2", index: 4, role: "Follower EVM wallet 2" },
  { key: "follower-evm-3", index: 5, role: "Follower EVM wallet 3" },
  { key: "follower-evm-4", index: 9, role: "Follower EVM wallet 4 (Phase 11 load)" },
  { key: "follower-evm-5", index: 10, role: "Follower EVM wallet 5 (Phase 11 load)" },
  { key: "operator-relayer", index: 6, role: "Operator / relayer (Phase 5/8)" },
  { key: "tee-signing-key", index: 7, role: "PMW-controlled TEE signing key" },
  { key: "ai-agent-signer", index: 8, role: "AI Agent FCE signer (Phase 6)" },
] as const;

function deriveWallet(mnemonic: Mnemonic, index: number): HDNodeWallet {
  return HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${index}`);
}

function loadOrCreateMnemonic(): Mnemonic {
  if (existsSync(ENV_PATH)) {
    const envContent = readFileSync(ENV_PATH, "utf8");
    const match = envContent.match(/^TESTNET_MNEMONIC=(.+)$/m);
    if (match?.[1]?.trim()) {
      return Mnemonic.fromPhrase(match[1].trim());
    }
  }
  const wallet = Wallet.createRandom();
  if (!wallet.mnemonic) throw new Error("Failed to generate mnemonic");
  return wallet.mnemonic;
}

function updateEnvFile(mnemonic: string, personaKeys: Record<string, string>, xrplSecret: string) {
  let envContent = "";
  if (existsSync(ENV_PATH)) {
    envContent = readFileSync(ENV_PATH, "utf8");
  } else if (existsSync(join(ROOT, ".env.example"))) {
    envContent = readFileSync(join(ROOT, ".env.example"), "utf8");
  }

  const setVar = (content: string, key: string, value: string): string => {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      return content.replace(regex, `${key}=${value}`);
    }
    return `${content.trim()}\n${key}=${value}\n`;
  };

  envContent = setVar(envContent, "TESTNET_MNEMONIC", mnemonic);
  envContent = setVar(envContent, "DEPLOYER_PRIVATE_KEY", personaKeys["deployer"]);
  envContent = setVar(envContent, "PERSONA_DEPLOYER_PRIVATE_KEY", personaKeys["deployer"]);

  for (const persona of PERSONAS) {
    const envKey = `PERSONA_${persona.key.toUpperCase().replace(/-/g, "_")}_PRIVATE_KEY`;
    envContent = setVar(envContent, envKey, personaKeys[persona.key]);
  }

  envContent = setVar(envContent, "XRPL_FOLLOWER_FSA_1_SECRET", xrplSecret);

  writeFileSync(ENV_PATH, envContent, "utf8");
}

async function main() {
  const mnemonic = loadOrCreateMnemonic();
  const phrase = mnemonic.phrase;

  const personas: Record<string, { address: string; role: string }> = {};
  const personaKeys: Record<string, string> = {};

  for (const persona of PERSONAS) {
    const wallet = deriveWallet(mnemonic, persona.index);
    personas[persona.key] = {
      address: wallet.address,
      role: persona.role,
    };
    personaKeys[persona.key] = wallet.privateKey;
  }

  const xrplWallet = XrplWallet.generate();
  const xrplAccount = {
    address: xrplWallet.address,
    role: "XRPL testnet follower (Phase 8 FSA path)",
  };

  const accountsConfig = {
    network: "coston2",
    chainId: 114,
    personas,
    xrpl: {
      "follower-fsa-1": xrplAccount,
    },
    tokens: {
      c2flr: "native",
      usdt0: "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F",
      fxrp: null,
    },
    generatedAt: new Date().toISOString(),
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(accountsConfig, null, 2), "utf8");
  updateEnvFile(phrase, personaKeys, xrplWallet.seed ?? "");

  console.log("Generated personas and wrote config/accounts.testnet.json");
  console.log("Updated .env with private keys (NEVER commit .env)");
  console.log("\nCoston2 addresses:");
  for (const [key, { address, role }] of Object.entries(personas)) {
    console.log(`  ${key}: ${address} (${role})`);
  }
  console.log(`  xrpl follower-fsa-1: ${xrplAccount.address}`);
  console.log("\nNext: run `pnpm provision:faucet-checklist` and fund each address via https://faucet.flare.network/coston2");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
