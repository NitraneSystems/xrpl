import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { InstructionSender, MirrorVault, MockFXRP } from "../typechain-types";

describe("InstructionSender", function () {
  let instructionSender: InstructionSender;
  let vault: MirrorVault;
  let fxrp: MockFXRP;
  let owner: HardhatEthersSigner;
  let tee: HardhatEthersSigner;
  let unauthorized: HardhatEthersSigner;
  let follower: HardhatEthersSigner;
  let lead: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, tee, unauthorized, follower, lead] = await ethers.getSigners();

    const MockFXRP = await ethers.getContractFactory("MockFXRP");
    fxrp = await MockFXRP.deploy();

    const Registry = await ethers.getContractFactory("MirrorRegistry");
    const registry = await Registry.deploy(owner.address);

    const Vault = await ethers.getContractFactory("MirrorVault");
    vault = await Vault.deploy(await fxrp.getAddress(), owner.address);

    const Fee = await ethers.getContractFactory("MirrorFee");
    const fee = await Fee.deploy(await fxrp.getAddress(), await registry.getAddress(), owner.address);

    const Sender = await ethers.getContractFactory("InstructionSender");
    instructionSender = await Sender.deploy(
      await vault.getAddress(),
      await fee.getAddress(),
      await registry.getAddress(),
      tee.address,
      owner.address
    );

    await vault.connect(owner).setInstructionSender(await instructionSender.getAddress());
    await vault.connect(owner).setLegacySettleBatchEnabled(true);

    await fxrp.mint(follower.address, ethers.parseEther("100"));
    await fxrp.connect(follower).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(follower).deposit(lead.address, ethers.parseEther("50"));
  });

  it("enforces monotonic nonce ordering", async function () {
    const settlements = [
      {
        follower: follower.address,
        lead: lead.address,
        balanceDelta: 1n,
        nonce: 1n,
      },
    ];

    await instructionSender.connect(tee).settleBatch(settlements, 0);
    expect(await instructionSender.batchNonce()).to.equal(1n);

    await expect(
      instructionSender.connect(tee).settleBatch(settlements, 2n)
    ).to.be.revertedWithCustomError(instructionSender, "InvalidNonce");
  });

  it("reverts when unauthorized executor calls settleBatch", async function () {
    const settlements = [
      {
        follower: follower.address,
        lead: lead.address,
        balanceDelta: 1n,
        nonce: 1n,
      },
    ];

    await expect(
      instructionSender.connect(unauthorized).settleBatch(settlements, 0)
    ).to.be.revertedWithCustomError(instructionSender, "UnauthorizedExecutor");
  });

  it("allows owner as fallback executor", async function () {
    const settlements = [
      {
        follower: follower.address,
        lead: lead.address,
        balanceDelta: 1n,
        nonce: 1n,
      },
    ];

    await expect(instructionSender.connect(owner).settleBatch(settlements, 0)).to.not.be.reverted;
  });
});
