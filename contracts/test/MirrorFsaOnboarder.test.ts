import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  MirrorFsaOnboarder,
  MirrorRegistry,
  MirrorVault,
  MockFXRP,
} from "../typechain-types";

describe("MirrorFsaOnboarder", function () {
  let onboarder: MirrorFsaOnboarder;
  let registry: MirrorRegistry;
  let vault: MirrorVault;
  let fxrp: MockFXRP;
  let owner: HardhatEthersSigner;
  let lead: HardhatEthersSigner;
  let personalAccount: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, lead, personalAccount, other] = await ethers.getSigners();

    const MockFXRP = await ethers.getContractFactory("MockFXRP");
    fxrp = await MockFXRP.deploy();
    await fxrp.waitForDeployment();

    const Registry = await ethers.getContractFactory("MirrorRegistry");
    registry = await Registry.deploy(owner.address);
    await registry.waitForDeployment();

    const Vault = await ethers.getContractFactory("MirrorVault");
    vault = await Vault.deploy(await fxrp.getAddress(), owner.address);
    await vault.waitForDeployment();

    const Onboarder = await ethers.getContractFactory("MirrorFsaOnboarder");
    onboarder = await Onboarder.deploy(
      await fxrp.getAddress(),
      await registry.getAddress(),
      await vault.getAddress(),
      owner.address
    );
    await onboarder.waitForDeployment();

    await registry.connect(owner).setFsaOnboarder(await onboarder.getAddress());
    await vault.connect(owner).setFsaOnboarder(await onboarder.getAddress());

    await registry.connect(lead).registerLead(0, 200, 0, ethers.id("tee"));
    await fxrp.mint(personalAccount.address, ethers.parseEther("1000"));
    await fxrp.connect(personalAccount).approve(await onboarder.getAddress(), ethers.MaxUint256);
  });

  it("onboards PersonalAccount: register + deposit + follow", async function () {
    const amount = ethers.parseEther("25");
    await expect(onboarder.connect(personalAccount).onboard(lead.address, amount, 1))
      .to.emit(onboarder, "FsaOnboarded")
      .withArgs(personalAccount.address, lead.address, amount, 1);

    const follower = await registry.getFollower(personalAccount.address);
    expect(follower.registered).to.equal(true);
    expect(follower.riskProfile).to.equal(1);
    expect(await vault.getBalance(personalAccount.address, lead.address)).to.equal(amount);
    const alloc = await registry.getFollowAllocation(personalAccount.address, lead.address);
    expect(alloc.active).to.equal(true);
  });

  it("is idempotent for already-registered follower", async function () {
    const amount = ethers.parseEther("10");
    await onboarder.connect(personalAccount).onboard(lead.address, amount, 0);
    await onboarder.connect(personalAccount).onboard(lead.address, amount, 0);
    expect(await vault.getBalance(personalAccount.address, lead.address)).to.equal(amount * 2n);
  });

  it("reverts below min allocation", async function () {
    const lead2 = other;
    await registry.connect(lead2).registerLead(0, 200, ethers.parseEther("50"), ethers.id("tee2"));
    await expect(
      onboarder.connect(personalAccount).onboard(lead2.address, ethers.parseEther("1"), 0)
    ).to.be.revertedWithCustomError(onboarder, "AllocationBelowMinimum");
  });

  it("reverts zero amount", async function () {
    await expect(
      onboarder.connect(personalAccount).onboard(lead.address, 0, 0)
    ).to.be.revertedWithCustomError(onboarder, "ZeroAmount");
  });
});
