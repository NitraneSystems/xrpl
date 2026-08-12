/**
 * Deploy Phase 10 venue mocks (Enosys CDP + Firelight strategy) on Coston2.
 */
import { ethers } from "hardhat";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "../..");
const CONFIG_PATH = join(ROOT, "config/coston2.json");

const REGISTRY_ABI = ["function getContractAddressByName(string _name) view returns (address)"];
const ASSET_MANAGER_ABI = ["function fAsset() view returns (address)"];

const FIRELIGHT_VAULT_REAL = "0xC90D6847747b85d1fa2E07859869fb9fB72c0361";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 114n) throw new Error(`Expected chain 114, got ${network.chainId}`);

  console.log(`Phase 10 deploy from ${deployer.address}`);

  const flareRegistry = new ethers.Contract(
    process.env.FLARE_CONTRACT_REGISTRY ?? "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
    REGISTRY_ABI,
    ethers.provider
  );
  const assetManagerAddr = await flareRegistry.getContractAddressByName("AssetManagerFXRP");
  const assetManager = new ethers.Contract(assetManagerAddr, ASSET_MANAGER_ABI, ethers.provider);
  const fxrpAddress = await assetManager.fAsset();

  const Enosys = await ethers.getContractFactory("MockEnosysCDP");
  const enosys = await Enosys.deploy(fxrpAddress, deployer.address);
  await enosys.waitForDeployment();
  console.log(`MockEnosysCDP: ${await enosys.getAddress()}`);

  const Fire = await ethers.getContractFactory("MockFirelightStrategy");
  const firelight = await Fire.deploy(fxrpAddress, deployer.address);
  await firelight.waitForDeployment();
  console.log(`MockFirelightStrategy: ${await firelight.getAddress()}`);

  const existing = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};
  const out = {
    ...existing,
    contracts: {
      ...(existing.contracts ?? {}),
      mockEnosysCDP: await enosys.getAddress(),
      mockFirelightStrategy: await firelight.getAddress(),
      firelightVaultReal: FIRELIGHT_VAULT_REAL,
    },
    firelightVaultReal: FIRELIGHT_VAULT_REAL,
    firelightNote:
      "Real Firelight vault on Coston2 exists but passive-staking MVP uses MockFirelightStrategy; swap addresses later.",
    deployedPhase10At: new Date().toISOString(),
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${CONFIG_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
