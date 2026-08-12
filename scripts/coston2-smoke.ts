import { createPublicClient, http, formatEther, formatUnits, getAddress, type Address } from "viem";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
dotenv.config({ path: join(ROOT, ".env") });

const FLARE_CHAIN_ID = 114;
const FLARE_CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as Address;
const SPARKDEX_SWAP_ROUTER = "0x8a1E35F5c98C4E85B36B7B253222eE17773b2781" as Address;
const SPARKDEX_V3_FACTORY = "0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652" as Address;
const BLAZESWAP_FACTORY = "0xf0f5e4cde15b22a423e995415f373fedc1f8f431" as Address;
const C2_USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F" as Address;

const REGISTRY_ABI = [
  {
    name: "getContractAddressByName",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_name", type: "string" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const ASSET_MANAGER_ABI = [
  {
    name: "fAsset",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

const BLAZESWAP_FACTORY_ABI = [
  {
    name: "allPairsLength",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getPair",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

interface AccountsConfig {
  personas: Record<string, { address: string }>;
  tokens?: { fxrp?: string | null };
}

interface Coston2Config {
  contracts?: Record<string, string>;
  tokens?: { fxrp?: string | null };
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function warn(msg: string) {
  console.warn(`WARN: ${msg}`);
}

function ok(msg: string) {
  console.log(`OK: ${msg}`);
}

async function pingTeeEndpoint(endpoint: string): Promise<boolean> {
  try {
    const healthUrl = endpoint.replace(/\/$/, "") + "/health";
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      ok(`TEE endpoint health check passed (${healthUrl})`);
      return true;
    }
    warn(`TEE health returned ${res.status}; trying /action is skipped`);
    return false;
  } catch {
    warn(`TEE endpoint unreachable at ${endpoint}`);
    return false;
  }
}

async function main() {
  const rpcUrl = process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc";
  const envChainId = Number(process.env.FLARE_CHAIN_ID ?? FLARE_CHAIN_ID);

  if (envChainId !== FLARE_CHAIN_ID) {
    fail(`FLARE_CHAIN_ID=${envChainId}, expected ${FLARE_CHAIN_ID}`);
  }

  const client = createPublicClient({
    transport: http(rpcUrl),
  });

  const chainId = await client.getChainId();
  const blockNumber = await client.getBlockNumber();

  console.log(`\n=== Mirror Coston2 Smoke Test ===`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Block: ${blockNumber}`);

  if (chainId !== FLARE_CHAIN_ID) {
    fail(`Connected chain ID ${chainId} !== ${FLARE_CHAIN_ID}`);
  }
  ok(`Connected to Coston2 (chain ID ${FLARE_CHAIN_ID})`);

  const ftsoV2 = await client.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByName",
    args: ["FtsoV2"],
  });
  const fdcHub = await client.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByName",
    args: ["FdcHub"],
  });
  const assetManager = await client.readContract({
    address: FLARE_CONTRACT_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getContractAddressByName",
    args: ["AssetManagerFXRP"],
  });

  ok(`FtsoV2: ${ftsoV2}`);
  ok(`FdcHub: ${fdcHub}`);
  ok(`AssetManagerFXRP: ${assetManager}`);

  const fxrpAddress = await client.readContract({
    address: assetManager,
    abi: ASSET_MANAGER_ABI,
    functionName: "fAsset",
  });
  ok(`FXRP (via fAsset()): ${fxrpAddress}`);

  const coston2Path = join(ROOT, "config/coston2.json");
  if (existsSync(coston2Path)) {
    const coston2: Coston2Config = JSON.parse(readFileSync(coston2Path, "utf8"));
    coston2.tokens = { ...coston2.tokens, fxrp: fxrpAddress };
    writeFileSync(coston2Path, JSON.stringify(coston2, null, 2));
  }

  const sparkRouterCode = await client.getCode({ address: SPARKDEX_SWAP_ROUTER });
  const sparkFactoryCode = await client.getCode({ address: SPARKDEX_V3_FACTORY });
  if (sparkRouterCode && sparkRouterCode !== "0x") {
    warn(`SparkDEX SwapRouter has bytecode on Coston2 — verify if spot shipped since last check`);
  } else {
    ok("SparkDEX SwapRouter: no bytecode on Coston2 (expected)");
  }
  if (sparkFactoryCode && sparkFactoryCode !== "0x") {
    warn(`SparkDEX V3Factory has bytecode on Coston2 — verify if spot shipped since last check`);
  } else {
    ok("SparkDEX V3Factory: no bytecode on Coston2 (expected)");
  }

  const pairsLength = await client.readContract({
    address: BLAZESWAP_FACTORY,
    abi: BLAZESWAP_FACTORY_ABI,
    functionName: "allPairsLength",
  });
  if (pairsLength > 0n) {
    ok(`BlazeSwap factory allPairsLength: ${pairsLength}`);
  } else {
    warn("BlazeSwap factory allPairsLength is zero");
  }

  const usdt0FxrpPair = await client.readContract({
    address: BLAZESWAP_FACTORY,
    abi: BLAZESWAP_FACTORY_ABI,
    functionName: "getPair",
    args: [C2_USDT0, fxrpAddress],
  });
  if (usdt0FxrpPair === "0x0000000000000000000000000000000000000000") {
    ok("BlazeSwap USDT0/FXRP pair: none (expected until Phase 4B seed)");
  } else {
    warn(`BlazeSwap USDT0/FXRP pair exists: ${usdt0FxrpPair}`);
  }

  const accountsPath = join(ROOT, "config/accounts.testnet.json");
  if (existsSync(accountsPath)) {
    const accounts: AccountsConfig = JSON.parse(readFileSync(accountsPath, "utf8"));
    accounts.tokens = { ...accounts.tokens, fxrp: fxrpAddress };
    writeFileSync(accountsPath, JSON.stringify(accounts, null, 2));

    const fxrpDecimals = await client.readContract({
      address: fxrpAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    });
    const usdt0Decimals = await client.readContract({
      address: C2_USDT0,
      abi: ERC20_ABI,
      functionName: "decimals",
    });

    console.log("\n--- Persona Balances ---");
    for (const [name, { address }] of Object.entries(accounts.personas)) {
      const addr = getAddress(address);
      const c2flr = await client.getBalance({ address: addr });
      const fxrpBal = await client.readContract({
        address: fxrpAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [addr],
      });
      const usdt0Bal = await client.readContract({
        address: C2_USDT0,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [addr],
      });

      console.log(
        `${name}: C2FLR=${formatEther(c2flr)} FXRP=${formatUnits(fxrpBal, fxrpDecimals)} USDT0=${formatUnits(usdt0Bal, usdt0Decimals)}`
      );

      if (c2flr === 0n) warn(`${name} has zero C2FLR — fund via faucet`);
    }
  } else {
    warn("config/accounts.testnet.json missing — run pnpm provision:personas");
  }

  if (existsSync(coston2Path)) {
    const coston2: Coston2Config = JSON.parse(readFileSync(coston2Path, "utf8"));
    if (coston2.contracts && Object.keys(coston2.contracts).length > 0) {
      console.log("\n--- Deployed Mirror Contracts ---");
      for (const [name, addr] of Object.entries(coston2.contracts)) {
        const code = await client.getCode({ address: getAddress(addr) });
        if (code && code !== "0x") {
          ok(`${name}: ${addr} (bytecode present)`);
        } else {
          warn(`${name}: ${addr} (no bytecode)`);
        }
      }
    }
  }

  const teeEndpoint = process.env.TEE_MATCHING_ENGINE_ENDPOINT;
  if (teeEndpoint) {
    console.log("\n--- TEE Matching Engine ---");
    await pingTeeEndpoint(teeEndpoint);
  } else {
    console.log("\nTEE_MATCHING_ENGINE_ENDPOINT unset — skipping FCE ping (CI-friendly)");
  }

  console.log("\n=== Smoke test complete ===\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
