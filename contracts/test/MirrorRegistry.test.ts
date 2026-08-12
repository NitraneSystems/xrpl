import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MirrorRegistry, MockFXRP } from "../typechain-types";

describe("MirrorRegistry", function () {
  let registry: MirrorRegistry;
  let lead1: HardhatEthersSigner;
  let follower1: HardhatEthersSigner;

  beforeEach(async function () {
    [, lead1, follower1] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("MirrorRegistry");
    registry = await Registry.deploy(lead1.address);
    await registry.waitForDeployment();
  });

  it("registers a lead with valid fee rate", async function () {
    const teeHash = ethers.id("tee-pubkey-1");
    await expect(
      registry.connect(lead1).registerLead(0, 500, ethers.parseEther("10"), teeHash)
    ).to.emit(registry, "LeadRegistered");

    const lead = await registry.getLead(lead1.address);
    expect(lead.wallet).to.equal(lead1.address);
    expect(lead.strategyType).to.equal(0);
    expect(lead.feeRateBps).to.equal(500);
    expect(lead.minAllocation).to.equal(ethers.parseEther("10"));
    expect(lead.verified).to.equal(false);
  });

  it("reverts when fee rate exceeds 2000 bps", async function () {
    await expect(
      registry.connect(lead1).registerLead(0, 2001, 0, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(registry, "InvalidFeeRate");
  });

  it("registers follower and follows lead", async function () {
    await registry.connect(lead1).registerLead(1, 100, ethers.parseEther("5"), ethers.ZeroHash);
    await registry.connect(follower1).registerFollower(1);

    await expect(registry.connect(follower1).followLead(lead1.address, ethers.parseEther("5")))
      .to.emit(registry, "LeadFollowed");

    const allocation = await registry.getFollowAllocation(follower1.address, lead1.address);
    expect(allocation.active).to.equal(true);
    expect(allocation.allocation).to.equal(ethers.parseEther("5"));
  });

  it("reverts follow when allocation below minimum", async function () {
    await registry.connect(lead1).registerLead(1, 100, ethers.parseEther("5"), ethers.ZeroHash);
    await registry.connect(follower1).registerFollower(1);

    await expect(
      registry.connect(follower1).followLead(lead1.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(registry, "AllocationBelowMinimum");
  });

  it("unfollows a lead", async function () {
    await registry.connect(lead1).registerLead(1, 100, 0, ethers.ZeroHash);
    await registry.connect(follower1).registerFollower(0);
    await registry.connect(follower1).followLead(lead1.address, 0);

    await expect(registry.connect(follower1).unfollowLead(lead1.address)).to.emit(
      registry,
      "LeadUnfollowed"
    );

    const allocation = await registry.getFollowAllocation(follower1.address, lead1.address);
    expect(allocation.active).to.equal(false);
  });
});
