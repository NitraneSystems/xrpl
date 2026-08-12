import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MockKineticPool, MockFXRP, MirrorHealthAuth } from "../typechain-types";

describe("MockKineticPool", function () {
  let pool: MockKineticPool;
  let fxrp: MockFXRP;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();
    const MockFXRP = await ethers.getContractFactory("MockFXRP");
    fxrp = await MockFXRP.deploy();
    await fxrp.waitForDeployment();

    const Pool = await ethers.getContractFactory("MockKineticPool");
    pool = await Pool.deploy(await fxrp.getAddress(), owner.address);
    await pool.waitForDeployment();

    await fxrp.mint(user.address, ethers.parseEther("1000"));
    await fxrp.mint(await pool.getAddress(), ethers.parseEther("500"));
    await fxrp.connect(user).approve(await pool.getAddress(), ethers.MaxUint256);
  });

  it("supplies and borrows within collateral factor", async function () {
    await pool.connect(user).supply(ethers.parseEther("100"));
    await pool.connect(user).borrow(ethers.parseEther("50"));
    expect(await pool.supplyBalance(user.address)).to.equal(ethers.parseEther("100"));
    expect(await pool.borrowBalance(user.address)).to.equal(ethers.parseEther("50"));
    const cr = await pool.getCollateralRatioBps(user.address);
    expect(cr).to.equal(20000n);
  });

  it("flags liquidatable after price drop", async function () {
    await pool.connect(user).supply(ethers.parseEther("100"));
    await pool.connect(user).borrow(ethers.parseEther("70"));
    expect(await pool.isLiquidatable(user.address)).to.equal(false);
    await pool.connect(owner).setPrice(ethers.parseEther("0.5"));
    // supply value halves → CR = 50/70 * 10000 ≈ 7142 < 11000
    expect(await pool.isLiquidatable(user.address)).to.equal(true);
  });
});

describe("MirrorHealthAuth", function () {
  it("stores pre-authorization", async function () {
    const [owner, follower, lead] = await ethers.getSigners();
    const Auth = await ethers.getContractFactory("MirrorHealthAuth");
    const auth = await Auth.deploy(owner.address);
    await auth.waitForDeployment();
    await auth.connect(follower).preAuthorizeTopUp(lead.address, ethers.parseEther("10"), true);
    expect(await auth.isAuthorized(follower.address, lead.address, ethers.parseEther("5"))).to.equal(true);
    expect(await auth.isAuthorized(follower.address, lead.address, ethers.parseEther("11"))).to.equal(false);
  });
});
