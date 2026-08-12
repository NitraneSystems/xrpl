import { expect } from "chai";
import { ethers } from "hardhat";
import fc from "fast-check";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MirrorVault, MockFXRP, InstructionSender } from "../typechain-types";

describe("MirrorVault fuzz-style settleBatch", function () {
  let vault: MirrorVault;
  let fxrp: MockFXRP;
  let instructionSender: InstructionSender;
  let owner: HardhatEthersSigner;
  let tee: HardhatEthersSigner;
  let follower: HardhatEthersSigner;
  let lead: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, lead, follower, tee] = await ethers.getSigners();

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

    await fxrp.mint(follower.address, ethers.parseEther("1000000"));
    await fxrp.connect(follower).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(follower).deposit(lead.address, ethers.parseEther("500000"));
  });

  it("handles empty settlement array", async function () {
    await expect(instructionSender.connect(tee).settleBatch([], 0)).to.not.be.reverted;
  });

  it("reverts on zero-address follower or lead", async function () {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (zeroFollower) => {
        const settlements = [
          {
            follower: zeroFollower ? ethers.ZeroAddress : follower.address,
            lead: zeroFollower ? lead.address : ethers.ZeroAddress,
            balanceDelta: 1n,
            nonce: BigInt(Math.floor(Math.random() * 1e6)),
          },
        ];
        await expect(
          instructionSender.connect(tee).settleBatch(settlements, await instructionSender.batchNonce())
        ).to.be.revertedWithCustomError(vault, "InvalidSettlement");
      }),
      { numRuns: 10 }
    );
  });

  it("reverts on duplicate nonces within batch path", async function () {
    const nonce = 42n;
    const settlements = [
      {
        follower: follower.address,
        lead: lead.address,
        balanceDelta: 1n,
        nonce,
      },
    ];

    await instructionSender.connect(tee).settleBatch(settlements, await instructionSender.batchNonce());

    await expect(
      instructionSender.connect(tee).settleBatch(settlements, await instructionSender.batchNonce())
    ).to.be.revertedWithCustomError(vault, "DuplicateNonce");
  });

  it("reverts when debit exceeds balance", async function () {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: ethers.parseEther("500001"), max: ethers.parseEther("600000") }),
        async (debit) => {
          const settlements = [
            {
              follower: follower.address,
              lead: lead.address,
              balanceDelta: -debit,
              nonce: BigInt(Date.now()) + debit,
            },
          ];
          await expect(
            instructionSender.connect(tee).settleBatch(settlements, await instructionSender.batchNonce())
          ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
        }
      ),
      { numRuns: 5 }
    );
  });

  it("accepts valid random credit deltas within balance headroom", async function () {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.bigInt({ min: 1n, max: ethers.parseEther("1000") }), { minLength: 1, maxLength: 20 }),
        async (deltas) => {
          const batchNonce = await instructionSender.batchNonce();
          const settlements = deltas.map((delta, i) => ({
            follower: follower.address,
            lead: lead.address,
            balanceDelta: delta,
            nonce: batchNonce * 10000n + BigInt(i) + 1n,
          }));

          const balanceBefore = await vault.getBalance(follower.address, lead.address);
          const totalCredit = deltas.reduce((a, b) => a + b, 0n);

          await instructionSender.connect(tee).settleBatch(settlements, batchNonce);

          const balanceAfter = await vault.getBalance(follower.address, lead.address);
          expect(balanceAfter - balanceBefore).to.equal(totalCredit);
        }
      ),
      { numRuns: 10 }
    );
  });

  it("reverts oversized batch from direct vault call (unauthorized)", async function () {
    const oversized = Array.from({ length: 50 }, (_, i) => ({
      follower: follower.address,
      lead: lead.address,
      balanceDelta: 1n,
      nonce: BigInt(i + 1),
    }));

    await expect(vault.connect(follower).settleBatch(oversized)).to.be.revertedWithCustomError(
      vault,
      "OnlyInstructionSender"
    );
  });
});
