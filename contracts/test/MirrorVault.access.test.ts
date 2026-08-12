import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  MirrorVault,
  MockFXRP,
  InstructionSender,
  MirrorFee,
  MirrorRegistry,
} from "../typechain-types";

describe("MirrorVault access control", function () {
  let vault: MirrorVault;
  let fee: MirrorFee;
  let fxrp: MockFXRP;
  let instructionSender: InstructionSender;
  let owner: HardhatEthersSigner;
  let deployer: HardhatEthersSigner;
  let leadTrader: HardhatEthersSigner;
  let follower: HardhatEthersSigner;
  let tee: HardhatEthersSigner;
  let lead: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, deployer, leadTrader, follower, tee, lead] = await ethers.getSigners();

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
    fee = await Fee.deploy(await fxrp.getAddress(), await registry.getAddress(), owner.address);
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
    await fee.connect(owner).setInstructionSender(await instructionSender.getAddress());

    await fxrp.mint(follower.address, ethers.parseEther("100"));
    await fxrp.connect(follower).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(follower).deposit(lead.address, ethers.parseEther("50"));
  });

  const settlement = (followerAddr: string, leadAddr: string) => [
    {
      follower: followerAddr,
      lead: leadAddr,
      balanceDelta: ethers.parseEther("1"),
      nonce: 1n,
    },
  ];

  it("reverts settleBatch from deployer", async function () {
    await expect(
      vault.connect(deployer).settleBatch(settlement(follower.address, lead.address))
    ).to.be.revertedWithCustomError(vault, "OnlyInstructionSender");
  });

  it("reverts settleBatch from lead-trader", async function () {
    await expect(
      vault.connect(leadTrader).settleBatch(settlement(follower.address, lead.address))
    ).to.be.revertedWithCustomError(vault, "OnlyInstructionSender");
  });

  it("reverts settleBatch from follower", async function () {
    await expect(
      vault.connect(follower).settleBatch(settlement(follower.address, lead.address))
    ).to.be.revertedWithCustomError(vault, "OnlyInstructionSender");
  });

  it("reverts finalizeWithdrawal from deployer", async function () {
    await vault.connect(follower).requestWithdrawal(lead.address, ethers.parseEther("10"));
    await expect(
      vault.connect(deployer).finalizeWithdrawal(follower.address, lead.address)
    ).to.be.revertedWithCustomError(vault, "OnlyInstructionSender");
  });

  it("reverts accrueFee from deployer", async function () {
    await expect(
      fee.connect(deployer).accrueFee(lead.address, follower.address, 100, 1)
    ).to.be.revertedWithCustomError(fee, "OnlyInstructionSender");
  });

  it("reverts accrueFee from lead-trader", async function () {
    await expect(
      fee.connect(leadTrader).accrueFee(lead.address, follower.address, 100, 1)
    ).to.be.revertedWithCustomError(fee, "OnlyInstructionSender");
  });

  it("reverts accrueFee from follower", async function () {
    await expect(
      fee.connect(follower).accrueFee(lead.address, follower.address, 100, 1)
    ).to.be.revertedWithCustomError(fee, "OnlyInstructionSender");
  });
});
