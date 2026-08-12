import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MirrorFee, MockFXRP, MirrorRegistry, InstructionSender } from "../typechain-types";

describe("MirrorFee", function () {
  let fee: MirrorFee;
  let registry: MirrorRegistry;
  let fxrp: MockFXRP;
  let instructionSender: InstructionSender;
  let owner: HardhatEthersSigner;
  let lead: HardhatEthersSigner;
  let follower: HardhatEthersSigner;
  let tee: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, lead, follower, tee] = await ethers.getSigners();

    const MockFXRP = await ethers.getContractFactory("MockFXRP");
    fxrp = await MockFXRP.deploy();
    await fxrp.waitForDeployment();

    const Registry = await ethers.getContractFactory("MirrorRegistry");
    registry = await Registry.deploy(owner.address);
    await registry.waitForDeployment();

    const Fee = await ethers.getContractFactory("MirrorFee");
    fee = await Fee.deploy(await fxrp.getAddress(), await registry.getAddress(), owner.address);
    await fee.waitForDeployment();

    const Vault = await ethers.getContractFactory("MirrorVault");
    const vault = await Vault.deploy(await fxrp.getAddress(), owner.address);
    await vault.waitForDeployment();

    const Sender = await ethers.getContractFactory("InstructionSender");
    instructionSender = await Sender.deploy(
      await vault.getAddress(),
      await fee.getAddress(),
      await registry.getAddress(),
      tee.address,
      owner.address
    );
    await instructionSender.waitForDeployment();

    await fee.connect(owner).setInstructionSender(await instructionSender.getAddress());

    await registry.connect(lead).registerLead(0, 200, 0, ethers.ZeroHash);
    await fxrp.mint(await fee.getAddress(), ethers.parseEther("10000"));
  });

  it("accrues fee with protocol deduction via InstructionSender", async function () {
    const profit = ethers.parseEther("1000");
    const accruals = [
      {
        lead: lead.address,
        follower: follower.address,
        profit,
        epochId: 1n,
      },
    ];

    await instructionSender.connect(tee).accrueFees(accruals, 0);
    expect(await fee.accruedFees(lead.address)).to.equal(ethers.parseEther("90"));
  });

  it("blocks unguarded claim until FDC release", async function () {
    await instructionSender.connect(tee).accrueFees(
      [{ lead: lead.address, follower: follower.address, profit: ethers.parseEther("1000"), epochId: 1n }],
      0
    );
    await expect(fee.connect(lead).claim(lead.address)).to.be.revertedWithCustomError(fee, "ProofRequired");
  });

  it("reverts claim when nothing accrued", async function () {
    await expect(fee.connect(lead).claim(lead.address)).to.be.revertedWithCustomError(fee, "ProofRequired");
  });
});

describe("MirrorFee claim math", function () {
  it("quotes correct net fee at 10% rate", async function () {
    const [owner, lead] = await ethers.getSigners();

    const MockFXRP = await ethers.getContractFactory("MockFXRP");
    const fxrp = await MockFXRP.deploy();

    const Registry = await ethers.getContractFactory("MirrorRegistry");
    const registry = await Registry.deploy(owner.address);

    const Fee = await ethers.getContractFactory("MirrorFee");
    const fee = await Fee.deploy(await fxrp.getAddress(), await registry.getAddress(), owner.address);

    await registry.connect(lead).registerLead(0, 200, 0, ethers.ZeroHash);
    expect(await fee.quoteNetFee(lead.address, ethers.parseEther("1000"))).to.equal(ethers.parseEther("90"));
  });
});
