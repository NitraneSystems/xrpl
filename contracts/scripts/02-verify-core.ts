import { run } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const CONFIG_PATH = join(ROOT, "config/coston2.json");
const ACCOUNTS_PATH = join(ROOT, "config/accounts.testnet.json");

async function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const accounts = JSON.parse(readFileSync(ACCOUNTS_PATH, "utf8"));
  const { contracts, tokens, deployer } = config;
  const aiAgentSigner = accounts.personas["ai-agent-signer"].address;
  const teeSigningKey = accounts.personas["tee-signing-key"].address;

  const verify = async (address: string, args: unknown[]) => {
    console.log(`Verifying ${address}...`);
    try {
      await run("verify:verify", { address, constructorArguments: args });
      console.log(`  OK: ${address}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Already Verified") || msg.includes("already verified")) {
        console.log(`  Already verified: ${address}`);
      } else {
        console.warn(`  Skip ${address}: ${msg}`);
      }
    }
  };

  await verify(contracts.mirrorRegistry, [deployer]);
  await verify(contracts.mirrorVault, [tokens.fxrp, deployer]);
  await verify(contracts.mirrorFee, [tokens.fxrp, contracts.mirrorRegistry, deployer]);
  await verify(contracts.mirrorLeaderboard, [aiAgentSigner, deployer]);
  await verify(contracts.instructionSender, [
    contracts.mirrorVault,
    contracts.mirrorFee,
    contracts.mirrorRegistry,
    teeSigningKey,
    deployer,
  ]);
}

main().catch(console.error);
