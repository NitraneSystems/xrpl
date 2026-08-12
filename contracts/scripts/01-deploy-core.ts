import { ethers } from "hardhat";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const CONFIG_PATH = join(ROOT, "config/coston2.json");
const ACCOUNTS_PATH = join(ROOT, "config/accounts.testnet.json");

const REGISTRY_ABI = [
  "function getContractAddressByName(string _name) view returns (address)",
];
const ASSET_MANAGER_ABI = ["function fAsset() view returns (address)"];

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  if (network.chainId !== 114n) {
    throw new Error(`Expected chain ID 114, got ${network.chainId}`);
  }

  console.log(`Deploying from ${deployer.address} on Coston2...`);

  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) {
    throw new Error(
      `Deployer ${deployer.address} has zero C2FLR. Fund via https://faucet.flare.network/coston2`
    );
  }

  const registryContract = new ethers.Contract(
    process.env.FLARE_CONTRACT_REGISTRY ?? "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
    REGISTRY_ABI,
    ethers.provider
  );

  const assetManagerAddr = await registryContract.getContractAddressByName("AssetManagerFXRP");
  const assetManager = new ethers.Contract(assetManagerAddr, ASSET_MANAGER_ABI, ethers.provider);
  const fxrpAddress = await assetManager.fAsset();
  console.log(`FXRP resolved: ${fxrpAddress}`);

  let aiAgentSigner = deployer.address;
  let teeSigningKey = deployer.address;
  if (existsSync(ACCOUNTS_PATH)) {
    const accounts = JSON.parse(readFileSync(ACCOUNTS_PATH, "utf8"));
    aiAgentSigner = accounts.personas["ai-agent-signer"]?.address ?? aiAgentSigner;
    teeSigningKey = accounts.personas["tee-signing-key"]?.address ?? teeSigningKey;
  }

  const Registry = await ethers.getContractFactory("MirrorRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();
  console.log(`MirrorRegistry: ${await registry.getAddress()}`);

  const Vault = await ethers.getContractFactory("MirrorVault");
  const vault = await Vault.deploy(fxrpAddress, deployer.address);
  await vault.waitForDeployment();
  console.log(`MirrorVault: ${await vault.getAddress()}`);

  const Fee = await ethers.getContractFactory("MirrorFee");
  const fee = await Fee.deploy(fxrpAddress, await registry.getAddress(), deployer.address);
  await fee.waitForDeployment();
  console.log(`MirrorFee: ${await fee.getAddress()}`);

  const Leaderboard = await ethers.getContractFactory("MirrorLeaderboard");
  const leaderboard = await Leaderboard.deploy(aiAgentSigner, deployer.address);
  await leaderboard.waitForDeployment();
  console.log(`MirrorLeaderboard: ${await leaderboard.getAddress()}`);

  const Sender = await ethers.getContractFactory("InstructionSender");
  const instructionSender = await Sender.deploy(
    await vault.getAddress(),
    await fee.getAddress(),
    await registry.getAddress(),
    teeSigningKey,
    deployer.address
  );
  await instructionSender.waitForDeployment();
  console.log(`InstructionSender: ${await instructionSender.getAddress()}`);

  await (await vault.setInstructionSender(await instructionSender.getAddress())).wait();
  await (await fee.setInstructionSender(await instructionSender.getAddress())).wait();
  console.log("Wired InstructionSender on Vault and Fee");

  const coston2Config = {
    chainId: 114,
    network: "coston2",
    contracts: {
      mirrorRegistry: await registry.getAddress(),
      mirrorVault: await vault.getAddress(),
      mirrorFee: await fee.getAddress(),
      mirrorLeaderboard: await leaderboard.getAddress(),
      instructionSender: await instructionSender.getAddress(),
    },
    tokens: {
      usdt0: process.env.C2_USDT0_ADDRESS ?? "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F",
      fxrp: fxrpAddress,
    },
    executionVenue: "mock-sparkdex",
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(coston2Config, null, 2));
  console.log(`Wrote ${CONFIG_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
