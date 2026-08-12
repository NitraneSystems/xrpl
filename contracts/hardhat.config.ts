import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-verify";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, "../.env") });

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PERSONA_DEPLOYER_PRIVATE_KEY ?? "";
const FLARE_EXPLORER_API_KEY = process.env.FLARE_EXPLORER_API_KEY ?? "mirror-blockscout";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.25",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
  },
  networks: {
    hardhat: {
      chainId: 114,
    },
    coston2: {
      url: process.env.FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc",
      chainId: 114,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    apiKey: {
      coston2: FLARE_EXPLORER_API_KEY,
    },
    customChains: [
      {
        network: "coston2",
        chainId: 114,
        urls: {
          apiURL: "https://coston2-explorer.flare.network/api",
          browserURL: "https://coston2-explorer.flare.network",
        },
      },
    ],
  },
};

export default config;
