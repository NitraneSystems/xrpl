import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockEnosysCDP, MockFirelightStrategy, MockFXRP } from "../typechain-types";

describe("MockEnosysCDP", function () {
  let cdp: MockEnosysCDP;
  let fxrp: MockFXRP;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    const MockFXRP = await ethers.getContractFactory("MockFXRP");
    fxrp = await MockFXRP.deploy();
    await fxrp.waitForDeployment();
    const Cdp = await ethers.getContractFactory("MockEnosysCDP");
    cdp = await Cdp.deploy(await fxrp.getAddress(), owner.address);
    await cdp.waitForDeployment();
    await fxrp.mint(user.address, ethers.parseEther("1000"));
    await fxrp.connect(user).approve(await cdp.getAddress(), ethers.MaxUint256);
  });

  it("opens CDP, mints stable, and reports collateral ratio", async function () {
    await cdp.connect(user).openCdp(ethers.parseEther("100"), ethers.parseEther("50"));
    expect(await cdp.collateralOf(user.address)).to.equal(ethers.parseEther("100"));
    expect(await cdp.debtOf(user.address)).to.equal(ethers.parseEther("50"));
    expect(await cdp.stableBalance(user.address)).to.equal(ethers.parseEther("50"));
    const cr = await cdp.getCollateralRatio(user.address);
    expect(cr).to.equal(20000n);
  });

  /**
   * non_goal_not_real_enosys_params — this suite only checks mock wiring.
   * It must NOT be read as validation of real Enosys Loans risk parameters.
   */
  it("non_goal_not_real_enosys_params", async function () {
    // Threshold is a demo constant (15000), not claimed Enosys production risk.
    expect(await cdp.liquidationThresholdBps()).to.equal(15000n);
  });
});

describe("MockFirelightStrategy", function () {
  let strategy: MockFirelightStrategy;
  let fxrp: MockFXRP;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    const MockFXRP = await ethers.getContractFactory("MockFXRP");
    fxrp = await MockFXRP.deploy();
    await fxrp.waitForDeployment();
    const Strat = await ethers.getContractFactory("MockFirelightStrategy");
    strategy = await Strat.deploy(await fxrp.getAddress(), owner.address);
    await strategy.waitForDeployment();
    await fxrp.mint(user.address, ethers.parseEther("1000"));
    await fxrp.connect(user).approve(await strategy.getAddress(), ethers.MaxUint256);
  });

  it("deposits, accrues mock yield, withdraws", async function () {
    await strategy.connect(user).deposit(ethers.parseEther("100"));
    expect(await strategy.balanceOf(user.address)).to.equal(ethers.parseEther("100"));
    await strategy.connect(owner).setYieldAmount(ethers.parseEther("10"));
    expect(await strategy.totalAssets()).to.equal(ethers.parseEther("110"));
    const assets = await strategy.convertToAssets(ethers.parseEther("100"));
    expect(assets).to.equal(ethers.parseEther("110"));
  });
});
