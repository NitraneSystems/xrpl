/**
 * Deploy Phase 8–9 contracts on Coston2 and wire FSA onboarder into vault/registry.
 * Redeploys Registry+Vault(+Fee+InstructionSender) so FSA hooks are available on-chain.
 */
import { ethers } from "hardhat";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const CONFIG_PATH = join(ROOT, "config/coston2.json");
const ACCOUNTS_PATH = join(ROOT, "config/accounts.testnet.json");

const REGISTRY_ABI = ["function getContractAddressByName(string _name) view returns (address)"];
const ASSET_MANAGER_ABI = ["function fAsset() view returns (address)"];
const MAC_ABI = [
  "function getPersonalAccount(string) view returns (address)",
  "function getXrplProviderWallets() view returns (string[])",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 114n) throw new Error(`Expected chain 114, got ${network.chainId}`);

  console.log(`Phase 8–9 deploy from ${deployer.address}`);

  const flareRegistry = new ethers.Contract(
    process.env.FLARE_CONTRACT_REGISTRY ?? "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
    REGISTRY_ABI,
    ethers.provider
  );

  const masterAccountController =
    process.env.MASTER_ACCOUNT_CONTROLLER ??
    (await flareRegistry.getContractAddressByName("MasterAccountController"));
  console.log(`MasterAccountController: ${masterAccountController}`);

  let operators: string[] = [];
  try {
    const mac = new ethers.Contract(masterAccountController, MAC_ABI, ethers.provider);
    operators = await mac.getXrplProviderWallets();
    console.log(`FSA operators: ${operators.join(", ")}`);
  } catch (e) {
    console.warn("getXrplProviderWallets() unavailable — set XRPL_OPERATOR_ADDRESS manually", e);
  }

  const assetManagerAddr = await flareRegistry.getContractAddressByName("AssetManagerFXRP");
  const assetManager = new ethers.Contract(assetManagerAddr, ASSET_MANAGER_ABI, ethers.provider);
  const fxrpAddress = await assetManager.fAsset();

  let aiAgentSigner = deployer.address;
  let teeSigningKey = deployer.address;
  if (existsSync(ACCOUNTS_PATH)) {
    const accounts = JSON.parse(readFileSync(ACCOUNTS_PATH, "utf8"));
    aiAgentSigner = accounts.personas["ai-agent-signer"]?.address ?? aiAgentSigner;
    teeSigningKey = accounts.personas["tee-signing-key"]?.address ?? teeSigningKey;
  }

  const existing = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};

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

  const Leaderboard = await ethers.getContractFactory("MirrorLeaderboard");
  const leaderboard = await Leaderboard.deploy(aiAgentSigner, deployer.address);
  await leaderboard.waitForDeployment();

  const Sender = await ethers.getContractFactory("InstructionSender");
  const instructionSender = await Sender.deploy(
    await vault.getAddress(),
    await fee.getAddress(),
    await registry.getAddress(),
    teeSigningKey,
    deployer.address
  );
  await instructionSender.waitForDeployment();
  await vault.setInstructionSender(await instructionSender.getAddress());

  const Onboarder = await ethers.getContractFactory("MirrorFsaOnboarder");
  const onboarder = await Onboarder.deploy(
    fxrpAddress,
    await registry.getAddress(),
    await vault.getAddress(),
    deployer.address
  );
  await onboarder.waitForDeployment();
  await registry.setFsaOnboarder(await onboarder.getAddress());
  await vault.setFsaOnboarder(await onboarder.getAddress());
  console.log(`MirrorFsaOnboarder: ${await onboarder.getAddress()}`);

  const Auth = await ethers.getContractFactory("MirrorHealthAuth");
  const healthAuth = await Auth.deploy(deployer.address);
  await healthAuth.waitForDeployment();
  console.log(`MirrorHealthAuth: ${await healthAuth.getAddress()}`);

  const Kinetic = await ethers.getContractFactory("MockKineticPool");
  const mockKinetic = await Kinetic.deploy(fxrpAddress, deployer.address);
  await mockKinetic.waitForDeployment();
  console.log(`MockKineticPool: ${await mockKinetic.getAddress()}`);

  const out = {
    ...existing,
    chainId: 114,
    network: "coston2",
    contracts: {
      ...(existing.contracts ?? {}),
      mirrorRegistry: await registry.getAddress(),
      mirrorVault: await vault.getAddress(),
      mirrorFee: await fee.getAddress(),
      mirrorLeaderboard: await leaderboard.getAddress(),
      instructionSender: await instructionSender.getAddress(),
      mirrorFsaOnboarder: await onboarder.getAddress(),
      mirrorHealthAuth: await healthAuth.getAddress(),
      mockKineticPool: await mockKinetic.getAddress(),
      masterAccountController,
    },
    tokens: {
      ...(existing.tokens ?? {}),
      fxrp: fxrpAddress,
    },
    fsa: {
      operators,
      xrplOperatorAddress: operators[0] ?? process.env.XRPL_OPERATOR_ADDRESS ?? "",
    },
    deployedPhase89At: new Date().toISOString(),
    deployer: deployer.address,
  };

  writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${CONFIG_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
