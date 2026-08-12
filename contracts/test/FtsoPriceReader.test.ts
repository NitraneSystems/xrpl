import { expect } from "chai";
import { ethers, network } from "hardhat";
import type { FtsoPriceReader } from "../typechain-types";

describe("FtsoPriceReader", function () {
  async function forkCoston2() {
    const rpcUrl = process.env.FLARE_RPC_URL;
    if (!rpcUrl) throw new Error("Missing FLARE_RPC_URL");

    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: rpcUrl,
          },
        },
      ],
    });
  }

  it("reads FXRP/USD and USDT0/USD values from live (forked) Coston2", async function () {
    if (process.env.RUN_LIVE_FTSO !== "1") {
      this.skip();
    }

    await forkCoston2();

    const Reader = await ethers.getContractFactory("FtsoPriceReader");
    const reader: FtsoPriceReader = (await Reader.deploy()) as FtsoPriceReader;
    await reader.waitForDeployment();

    const [fxrpWei, fxrpTs] = await reader.getFxrpUsdInWei();
    const [usdt0Wei, usdt0Ts] = await reader.getUsdt0UsdInWei();

    // We only need to prove readability and basic freshness (non-zero).
    expect(fxrpTs).to.be.greaterThan(0n);
    expect(usdt0Ts).to.be.greaterThan(0n);
    expect(fxrpWei).to.be.greaterThan(0n);
    expect(usdt0Wei).to.be.greaterThan(0n);
  });
});

