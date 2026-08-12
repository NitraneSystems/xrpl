import { expect } from "chai";
import { ethers } from "hardhat";

describe("AnchorDivergenceGuard", function () {
  it("reverts when divergence exceeds max tolerance (above notional)", async function () {
    const notionalThresholdWei = 1_000n;
    const maxDivergenceBps = 100n; // 1%
    // block=1100, anchor=1000 => diff=100 => divergence=100*10000/1000=1000 bps = 10%

    const Guard = await ethers.getContractFactory("AnchorDivergenceGuard");
    const guard = await Guard.deploy(notionalThresholdWei, maxDivergenceBps);
    await guard.waitForDeployment();

    const blockPriceWei = 1100n;
    const anchorPriceWei = 1000n;
    const notionalWei = 10_000n;

    await expect(guard.checkDivergence(blockPriceWei, anchorPriceWei, notionalWei)).to.be.revertedWithCustomError(
      guard,
      "DivergenceExceeded"
    );
  });

  it("does not revert when divergence is within tolerance", async function () {
    const notionalThresholdWei = 1_000n;
    const maxDivergenceBps = 200n; // 2%
    // block=1020, anchor=1000 => diff=20 => divergence=20*10000/1000=200 bps = 2%

    const Guard = await ethers.getContractFactory("AnchorDivergenceGuard");
    const guard = await Guard.deploy(notionalThresholdWei, maxDivergenceBps);
    await guard.waitForDeployment();

    const blockPriceWei = 1020n;
    const anchorPriceWei = 1000n;
    const notionalWei = 10_000n;

    await expect(guard.checkDivergence(blockPriceWei, anchorPriceWei, notionalWei)).to.not.be.reverted;
  });
});

