import { ethers } from "hardhat";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const CONFIG_PATH = join(ROOT, "config/coston2.json");
const ACCOUNTS_PATH = join(ROOT, "config/accounts.testnet.json");
const USDT0 = process.env.C2_USDT0_ADDRESS ?? "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";

const REGISTRY_ABI = ["function getContractAddressByName(string _name) view returns (address)"];
const ASSET_MANAGER_ABI = ["function fAsset() view returns (address)"];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 114n) throw new Error(`Expected chain ID 114, got ${network.chainId}`);

  const flareRegistry = new ethers.Contract(
    process.env.FLARE_CONTRACT_REGISTRY ?? "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
    REGISTRY_ABI,
    ethers.provider
  );
  const assetManagerAddr = await flareRegistry.getContractAddressByName("AssetManagerFXRP");
  const fxrpAddress = await new ethers.Contract(assetManagerAddr, ASSET_MANAGER_ABI, ethers.provider).fAsset();
  const fdcVerification = await flareRegistry.getContractAddressByName("FdcVerification");
  console.log(`FXRP ${fxrpAddress}`);
  console.log(`FdcVerification ${fdcVerification}`);

  let teeSigningKey = deployer.address;
  if (existsSync(ACCOUNTS_PATH)) {
    const accounts = JSON.parse(readFileSync(ACCOUNTS_PATH, "utf8"));
    teeSigningKey = accounts.personas["tee-signing-key"]?.address ?? teeSigningKey;
  }

  const existing = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};
  const registryAddr = existing.contracts?.mirrorRegistry;
  const leaderboardAddr = existing.contracts?.mirrorLeaderboard;
  if (!registryAddr) throw new Error("Missing mirrorRegistry in config/coston2.json — run deploy:core first");

  const Ftso = await ethers.getContractFactory("FtsoPriceReader");
  const ftso = await Ftso.deploy();
  await ftso.waitForDeployment();
  console.log(`FtsoPriceReader: ${await ftso.getAddress()}`);

  const Guard = await ethers.getContractFactory("AnchorDivergenceGuard");
  const guard = await Guard.deploy(ethers.parseEther("0.001"), 500n);
  await guard.waitForDeployment();
  console.log(`AnchorDivergenceGuard: ${await guard.getAddress()}`);

  const Router = await ethers.getContractFactory("MockSparkDexRouter");
  const router = await Router.deploy(
    fxrpAddress,
    USDT0,
    await ftso.getAddress(),
    await guard.getAddress(),
    deployer.address
  );
  await router.waitForDeployment();
  console.log(`MockSparkDexRouter: ${await router.getAddress()}`);

  const Vault = await ethers.getContractFactory("MirrorVault");
  const vault = await Vault.deploy(fxrpAddress, deployer.address);
  await vault.waitForDeployment();
  console.log(`MirrorVault: ${await vault.getAddress()}`);

  const Fee = await ethers.getContractFactory("MirrorFee");
  const fee = await Fee.deploy(fxrpAddress, registryAddr, deployer.address);
  await fee.waitForDeployment();
  console.log(`MirrorFee: ${await fee.getAddress()}`);

  const Sender = await ethers.getContractFactory("InstructionSender");
  const sender = await Sender.deploy(
    await vault.getAddress(),
    await fee.getAddress(),
    registryAddr,
    teeSigningKey,
    deployer.address
  );
  await sender.waitForDeployment();
  console.log(`InstructionSender: ${await sender.getAddress()}`);

  await (await vault.setInstructionSender(await sender.getAddress())).wait();
  await (await fee.setInstructionSender(await sender.getAddress())).wait();
  await (await sender.setSwapRouter(await router.getAddress())).wait();
  if (fdcVerification !== ethers.ZeroAddress) {
    await (await sender.setFdcVerifier(fdcVerification)).wait();
    await (await fee.setFdcVerifier(fdcVerification)).wait();
  }

  const fxrp = new ethers.Contract(fxrpAddress, ERC20_ABI, deployer);
  const usdt0 = new ethers.Contract(USDT0, ERC20_ABI, deployer);
  const fxrpBal = await fxrp.balanceOf(deployer.address);
  const usdt0Bal = await usdt0.balanceOf(deployer.address);
  const fxrpSeed = fxrpBal / 2n;
  const usdt0Seed = usdt0Bal / 2n;
  if (fxrpSeed > 0n) {
    await (await fxrp.transfer(await router.getAddress(), fxrpSeed)).wait();
    console.log(`Seeded mock with ${fxrpSeed} FXRP`);
  }
  if (usdt0Seed > 0n) {
    await (await usdt0.transfer(await router.getAddress(), usdt0Seed)).wait();
    console.log(`Seeded mock with ${usdt0Seed} USDT0`);
  }
  const feeSeed = fxrpBal / 10n;
  if (feeSeed > 0n) {
    await (await fxrp.transfer(await fee.getAddress(), feeSeed)).wait();
    console.log(`Seeded MirrorFee with ${feeSeed} FXRP`);
  }

  const coston2Config = {
    ...existing,
    chainId: 114,
    network: "coston2",
    contracts: {
      ...existing.contracts,
      mirrorVault: await vault.getAddress(),
      mirrorFee: await fee.getAddress(),
      instructionSender: await sender.getAddress(),
      mirrorLeaderboard: leaderboardAddr,
      ftsoPriceReader: await ftso.getAddress(),
      anchorDivergenceGuard: await guard.getAddress(),
      mockSparkDexRouter: await router.getAddress(),
    },
    tokens: {
      usdt0: USDT0,
      fxrp: fxrpAddress,
    },
    executionVenue: "mock-sparkdex",
    sparkdexPoolFee: 500,
    mainnetReference: {
      note: "chain ID 14 only — do NOT use on Coston2",
      sparkdexSwapRouter: "0x8a1E35F5c98C4E85B36B7B253222eE17773b2781",
      sparkdexV3Factory: "0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652",
      sparkdexFxrpUsdt0Pool: "0x88d46717b16619b37fa2dfd2f038defb4459f1f7",
      sparkdexPoolFee: 500,
    },
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
