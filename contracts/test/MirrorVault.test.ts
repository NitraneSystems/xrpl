import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MirrorVault, MockFXRP, InstructionSender } from "../typechain-types";

describe("MirrorVault", function () {
  let vault: MirrorVault;
  let fxrp: MockFXRP;
  let instructionSender: InstructionSender;
  let owner: HardhatEthersSigner;
  let follower: HardhatEthersSigner;
  let lead: HardhatEthersSigner;
  let tee: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, lead, follower, tee] = await ethers.getSigners();

    const MockFXRP = await ethers.getContractFactory("MockFXRP");
    fxrp = await MockFXRP.deploy();
    await fxrp.waitForDeployment();

    const Registry = await ethers.getContractFactory("MirrorRegistry");
    const registry = await Registry.deploy(owner.address);
    await registry.waitForDeployment();

    const Vault = await ethers.getContractFactory("MirrorVault");
    vault = await Vault.deploy(await fxrp.getAddress(), owner.address);
    await vault.waitForDeployment();

    const Fee = await ethers.getContractFactory("MirrorFee");
    const fee = await Fee.deploy(await fxrp.getAddress(), await registry.getAddress(), owner.address);
    await fee.waitForDeployment();

    const Sender = await ethers.getContractFactory("InstructionSender");
    instructionSender = await Sender.deploy(
      await vault.getAddress(),
      await fee.getAddress(),
      await registry.getAddress(),
      tee.address,
      owner.address
    );
    await instructionSender.waitForDeployment();

    await vault.connect(owner).setInstructionSender(await instructionSender.getAddress());
    await vault.connect(owner).setLegacySettleBatchEnabled(true);

    await fxrp.mint(follower.address, ethers.parseEther("1000"));
    await fxrp.connect(follower).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  it("deposits FXRP into sub-account", async function () {
    const amount = ethers.parseEther("100");
    await expect(vault.connect(follower).deposit(lead.address, amount))
      .to.emit(vault, "Deposited")
      .withArgs(follower.address, lead.address, amount);

    expect(await vault.getBalance(follower.address, lead.address)).to.equal(amount);
  });

  it("requests withdrawal and moves balance to pending", async function () {
    const amount = ethers.parseEther("50");
    await vault.connect(follower).deposit(lead.address, amount);
    await vault.connect(follower).requestWithdrawal(lead.address, amount);

    expect(await vault.getBalance(follower.address, lead.address)).to.equal(0);
    expect(await vault.getPendingWithdrawal(follower.address, lead.address)).to.equal(amount);
  });

  it("settleBatch applies positive and negative deltas via InstructionSender", async function () {
    await vault.connect(follower).deposit(lead.address, ethers.parseEther("100"));

    const settlements = [
      {
        follower: follower.address,
        lead: lead.address,
        balanceDelta: ethers.parseEther("10"),
        nonce: 1n,
      },
    ];

    await instructionSender.connect(tee).settleBatch(settlements, 0);
    expect(await vault.getBalance(follower.address, lead.address)).to.equal(ethers.parseEther("110"));
  });

  it("Phase 5: settleBatch reverts when legacySettleBatchEnabled is false", async function () {
    await vault.connect(owner).setLegacySettleBatchEnabled(false);
    const settlements = [
      {
        follower: follower.address,
        lead: lead.address,
        balanceDelta: ethers.parseEther("1"),
        nonce: 99n,
      },
    ];
    await expect(
      instructionSender.connect(tee).settleBatch(settlements, await instructionSender.batchNonce())
    ).to.be.revertedWithCustomError(vault, "ProofRequiredUseSettleFromProof");
  });

  it("finalizes withdrawal via InstructionSender", async function () {
    const amount = ethers.parseEther("25");
    await vault.connect(follower).deposit(lead.address, amount);
    await vault.connect(follower).requestWithdrawal(lead.address, amount);

    await instructionSender.connect(tee).finalizeWithdrawal(follower.address, lead.address, 0);

    expect(await fxrp.balanceOf(follower.address)).to.equal(ethers.parseEther("1000"));
    expect(await vault.getPendingWithdrawal(follower.address, lead.address)).to.equal(0);
  });
});
