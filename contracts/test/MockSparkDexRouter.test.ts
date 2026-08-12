import { expect } from "chai";
import { ethers } from "hardhat";
import { id } from "ethers";

describe("MockSparkDexRouter", function () {
  async function deployFixture() {
    const [owner, trader, recipient] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const fxrp = await MockERC20.deploy("FXRP", "FXRP", 18);
    const usdt0 = await MockERC20.deploy("USDT0", "USDT0", 18);

    const Price = await ethers.getContractFactory("MockPriceSource");
    const price = await Price.deploy();
    await price.setPrices(ethers.parseEther("2"), ethers.parseEther("1"), 1_700_000_000);

    const Guard = await ethers.getContractFactory("AnchorDivergenceGuard");
    // threshold 0.5 token-notional USD, max 1% divergence
    const guard = await Guard.deploy(ethers.parseEther("0.5"), 100n);

    const Router = await ethers.getContractFactory("MockSparkDexRouter");
    const router = await Router.deploy(
      await fxrp.getAddress(),
      await usdt0.getAddress(),
      await price.getAddress(),
      await guard.getAddress(),
      owner.address
    );

    await fxrp.mint(trader.address, ethers.parseEther("100000"));
    await usdt0.mint(trader.address, ethers.parseEther("100000"));
    await fxrp.mint(await router.getAddress(), ethers.parseEther("1000000"));
    await usdt0.mint(await router.getAddress(), ethers.parseEther("1000000"));
    await fxrp.connect(trader).approve(await router.getAddress(), ethers.MaxUint256);
    await usdt0.connect(trader).approve(await router.getAddress(), ethers.MaxUint256);

    return { owner, trader, recipient, fxrp, usdt0, price, guard, router };
  }

  it("matches Uniswap V3 / SparkDEX struct selectors", async function () {
    expect(id("exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))").slice(0, 10)).to.equal(
      "0x414bf389"
    );
    expect(id("exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))").slice(0, 10)).to.equal(
      "0xdb3e2198"
    );

    const { router } = await deployFixture();
    expect(router.interface.getFunction("exactInputSingle").selector).to.equal("0x414bf389");
    expect(router.interface.getFunction("exactOutputSingle").selector).to.equal("0xdb3e2198");
  });

  it("fills 20+ swaps within the FTSO price band", async function () {
    const { trader, recipient, fxrp, usdt0, router } = await deployFixture();
    const amountIn = ethers.parseEther("1");
    // FXRP $2 / USDT0 $1 => 1 FXRP -> 2 USDT0
    const expectedOut = ethers.parseEther("2");

    for (let i = 0; i < 21; i++) {
      const before = await usdt0.balanceOf(recipient.address);
      await router.connect(trader).exactInputSingle({
        tokenIn: await fxrp.getAddress(),
        tokenOut: await usdt0.getAddress(),
        fee: 500,
        recipient: recipient.address,
        deadline: 2_000_000_000,
        amountIn,
        amountOutMinimum: expectedOut,
        sqrtPriceLimitX96: 0,
      });
      const after = await usdt0.balanceOf(recipient.address);
      expect(after - before).to.equal(expectedOut);
    }
  });

  it("reverts when injected anchor diverges beyond the threshold", async function () {
    const { owner, trader, recipient, fxrp, usdt0, router } = await deployFixture();
    // block FXRP=$2, inject anchor=$1 => 100% divergence >> 1%
    await router.connect(owner).setAnchorSnapshot(ethers.parseEther("1"), ethers.parseEther("1"), 1);

    await expect(
      router.connect(trader).exactInputSingle({
        tokenIn: await fxrp.getAddress(),
        tokenOut: await usdt0.getAddress(),
        fee: 500,
        recipient: recipient.address,
        deadline: 2_000_000_000,
        amountIn: ethers.parseEther("1"),
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      })
    ).to.be.revertedWithCustomError(
      await ethers.getContractAt("AnchorDivergenceGuard", await router.divergenceGuard()),
      "DivergenceExceeded"
    );
  });

  it("reverts when amountOut is below minOut", async function () {
    const { trader, recipient, fxrp, usdt0, router } = await deployFixture();
    await expect(
      router.connect(trader).exactInputSingle({
        tokenIn: await fxrp.getAddress(),
        tokenOut: await usdt0.getAddress(),
        fee: 500,
        recipient: recipient.address,
        deadline: 2_000_000_000,
        amountIn: ethers.parseEther("1"),
        amountOutMinimum: ethers.parseEther("3"),
        sqrtPriceLimitX96: 0,
      })
    ).to.be.revertedWithCustomError(router, "InsufficientOutput");
  });
});
