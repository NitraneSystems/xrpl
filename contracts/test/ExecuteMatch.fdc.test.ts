import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder, id } from "ethers";

const SWAP_TOPIC0 = id("Swap(address,address,address,address,uint256,uint256)");

function emptyProof(overrides: Record<string, unknown> = {}) {
  const txHash = (overrides.txHash as string) ?? ethers.zeroPadValue("0x01", 32);
  const source = (overrides.sourceAddress as string) ?? ethers.ZeroAddress;
  const receiving = (overrides.receivingAddress as string) ?? ethers.ZeroAddress;
  const emitter = (overrides.emitterAddress as string) ?? receiving;
  const amountIn = (overrides.amountIn as bigint) ?? 0n;
  const amountOut = (overrides.amountOut as bigint) ?? 0n;
  const tokenIn = (overrides.tokenIn as string) ?? ethers.ZeroAddress;
  const tokenOut = (overrides.tokenOut as string) ?? ethers.ZeroAddress;
  const status = (overrides.status as number) ?? 1;

  const data = AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256", "uint256"],
    [tokenIn, tokenOut, amountIn, amountOut]
  );

  return {
    merkleProof: [],
    data: {
      attestationType: ethers.ZeroHash,
      sourceId: ethers.ZeroHash,
      votingRound: 1n,
      lowestUsedTimestamp: 0n,
      requestBody: {
        transactionHash: txHash,
        requiredConfirmations: 1,
        provideInput: true,
        listEvents: true,
        logIndices: [],
      },
      responseBody: {
        blockNumber: 1n,
        timestamp: 1n,
        sourceAddress: source,
        isDeployment: false,
        receivingAddress: receiving,
        value: 0n,
        input: "0x",
        status,
        events: [
          {
            logIndex: 0,
            emitterAddress: emitter,
            topics: [SWAP_TOPIC0],
            data,
            removed: false,
          },
        ],
      },
    },
  };
}

describe("executeMatch + FDC settlement", function () {
  async function deployAll() {
    const [owner, tee, follower, lead] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const fxrp = await MockERC20.deploy("FXRP", "FXRP", 18);
    const usdt0 = await MockERC20.deploy("USDT0", "USDT0", 18);

    const Price = await ethers.getContractFactory("MockPriceSource");
    const price = await Price.deploy();
    await price.setPrices(ethers.parseEther("2"), ethers.parseEther("1"), 1_700_000_000);

    const Guard = await ethers.getContractFactory("AnchorDivergenceGuard");
    const guard = await Guard.deploy(0, 10_000n); // allow any divergence in this suite

    const Router = await ethers.getContractFactory("MockSparkDexRouter");
    const router = await Router.deploy(
      await fxrp.getAddress(),
      await usdt0.getAddress(),
      await price.getAddress(),
      await guard.getAddress(),
      owner.address
    );

    const Registry = await ethers.getContractFactory("MirrorRegistry");
    const registry = await Registry.deploy(owner.address);

    const Vault = await ethers.getContractFactory("MirrorVault");
    const vault = await Vault.deploy(await fxrp.getAddress(), owner.address);

    const Fee = await ethers.getContractFactory("MirrorFee");
    const fee = await Fee.deploy(await fxrp.getAddress(), await registry.getAddress(), owner.address);

    const Sender = await ethers.getContractFactory("InstructionSender");
    const sender = await Sender.deploy(
      await vault.getAddress(),
      await fee.getAddress(),
      await registry.getAddress(),
      tee.address,
      owner.address
    );

    await vault.setInstructionSender(await sender.getAddress());
    await fee.setInstructionSender(await sender.getAddress());
    await sender.setSwapRouter(await router.getAddress());

    const MockFdc = await ethers.getContractFactory("MockFdcVerification");
    const fdc = await MockFdc.deploy();
    await sender.setFdcVerifier(await fdc.getAddress());
    await fee.setFdcVerifier(await fdc.getAddress());

    await registry.connect(lead).registerLead(0, 200, 0, ethers.ZeroHash);

    await fxrp.mint(follower.address, ethers.parseEther("1000"));
    await fxrp.connect(follower).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(follower).deposit(lead.address, ethers.parseEther("100"));

    await fxrp.mint(await router.getAddress(), ethers.parseEther("100000"));
    await usdt0.mint(await router.getAddress(), ethers.parseEther("100000"));
    await fxrp.mint(await fee.getAddress(), ethers.parseEther("10000"));

    return { owner, tee, follower, lead, fxrp, usdt0, router, vault, fee, sender, fdc };
  }

  it("does not change recorded vault balance until FDC proof", async function () {
    const { tee, follower, lead, fxrp, usdt0, router, vault, sender } = await deployAll();
    const amountIn = ethers.parseEther("10");

    await sender.connect(tee).executeMatch({
      follower: follower.address,
      lead: lead.address,
      profit: 0,
      epochId: 1,
      swap: {
        tokenIn: await fxrp.getAddress(),
        tokenOut: await usdt0.getAddress(),
        fee: 500,
        recipient: await sender.getAddress(),
        deadline: 2_000_000_000,
        amountIn,
        amountOutMinimum: 1,
        sqrtPriceLimitX96: 0,
      },
    });

    expect(await vault.getBalance(follower.address, lead.address)).to.equal(ethers.parseEther("100"));
    expect(await vault.getPendingLocked(follower.address, lead.address)).to.equal(amountIn);
  });

  it("commits vault debit and rejects mismatched proofs", async function () {
    const { tee, follower, lead, fxrp, usdt0, router, vault, sender } = await deployAll();
    const amountIn = ethers.parseEther("10");
    const amountOut = ethers.parseEther("20");

    await sender.connect(tee).executeMatch({
      follower: follower.address,
      lead: lead.address,
      profit: 0,
      epochId: 1,
      swap: {
        tokenIn: await fxrp.getAddress(),
        tokenOut: await usdt0.getAddress(),
        fee: 500,
        recipient: await sender.getAddress(),
        deadline: 2_000_000_000,
        amountIn,
        amountOutMinimum: amountOut,
        sqrtPriceLimitX96: 0,
      },
    });

    const base = {
      sourceAddress: tee.address,
      receivingAddress: await sender.getAddress(),
      emitterAddress: await router.getAddress(),
      tokenIn: await fxrp.getAddress(),
      tokenOut: await usdt0.getAddress(),
      amountIn,
      amountOut,
    };

    await expect(
      sender.connect(tee).applyFdcSettlement(
        0,
        emptyProof({ ...base, amountOut: ethers.parseEther("99") })
      )
    ).to.be.revertedWithCustomError(sender, "ProofMismatch");

    await sender.connect(tee).applyFdcSettlement(0, emptyProof({ ...base, txHash: ethers.zeroPadValue("0xaa", 32) }));
    expect(await vault.getBalance(follower.address, lead.address)).to.equal(ethers.parseEther("90"));

    await expect(
      sender.connect(tee).applyFdcSettlement(0, emptyProof({ ...base, txHash: ethers.zeroPadValue("0xaa", 32) }))
    ).to.be.revertedWithCustomError(sender, "FillAlreadySettled");
  });

  it("releases fee to the lead only with a valid matching proof", async function () {
    const { tee, follower, lead, fxrp, usdt0, router, fee, sender } = await deployAll();
    const amountIn = ethers.parseEther("10");
    const amountOut = ethers.parseEther("20");
    const profit = ethers.parseEther("1000"); // net fee 90 with 10% lead rate

    await sender.connect(tee).executeMatch({
      follower: follower.address,
      lead: lead.address,
      profit,
      epochId: 1,
      swap: {
        tokenIn: await fxrp.getAddress(),
        tokenOut: await usdt0.getAddress(),
        fee: 500,
        recipient: await sender.getAddress(),
        deadline: 2_000_000_000,
        amountIn,
        amountOutMinimum: amountOut,
        sqrtPriceLimitX96: 0,
      },
    });

    await expect(fee.connect(lead).claim(lead.address)).to.be.revertedWithCustomError(fee, "ProofRequired");

    const before = await fxrp.balanceOf(lead.address);
    await sender.connect(tee).applyFdcSettlement(
      0,
      emptyProof({
        sourceAddress: tee.address,
        receivingAddress: await sender.getAddress(),
        emitterAddress: await router.getAddress(),
        tokenIn: await fxrp.getAddress(),
        tokenOut: await usdt0.getAddress(),
        amountIn,
        amountOut,
        txHash: ethers.zeroPadValue("0xbb", 32),
      })
    );
    expect(await fxrp.balanceOf(lead.address) - before).to.equal(ethers.parseEther("90"));

    await expect(
      fee.connect(lead).releaseFee(
        emptyProof({ txHash: ethers.zeroPadValue("0xcc", 32) }),
        lead.address,
        ethers.parseEther("1")
      )
    ).to.be.revertedWithCustomError(fee, "OnlyInstructionSender");
  });

  it("rejects invalid, wrong-hash, and reused proofs", async function () {
    const { tee, follower, lead, fxrp, usdt0, router, sender, fdc } = await deployAll();
    const amountIn = ethers.parseEther("10");
    const amountOut = ethers.parseEther("20");
    const swap = {
      tokenIn: await fxrp.getAddress(),
      tokenOut: await usdt0.getAddress(),
      fee: 500,
      recipient: await sender.getAddress(),
      deadline: 2_000_000_000,
      amountIn,
      amountOutMinimum: amountOut,
      sqrtPriceLimitX96: 0,
    };

    await sender.connect(tee).executeMatch({
      follower: follower.address,
      lead: lead.address,
      profit: 0,
      epochId: 1,
      swap,
    });
    await sender.connect(tee).executeMatch({
      follower: follower.address,
      lead: lead.address,
      profit: 0,
      epochId: 1,
      swap,
    });

    const matching = {
      sourceAddress: tee.address,
      receivingAddress: await sender.getAddress(),
      emitterAddress: await router.getAddress(),
      tokenIn: await fxrp.getAddress(),
      tokenOut: await usdt0.getAddress(),
      amountIn,
      amountOut,
    };

    await fdc.setShouldProve(false);
    await expect(
      sender.connect(tee).applyFdcSettlement(0, emptyProof({ ...matching, txHash: ethers.zeroPadValue("0x11", 32) }))
    ).to.be.revertedWithCustomError(sender, "InvalidProof");
    await fdc.setShouldProve(true);

    await expect(
      sender.connect(tee).applyFdcSettlement(
        0,
        emptyProof({ ...matching, receivingAddress: tee.address, txHash: ethers.zeroPadValue("0x22", 32) })
      )
    ).to.be.revertedWithCustomError(sender, "ProofMismatch");

    const proofA = emptyProof({ ...matching, txHash: ethers.zeroPadValue("0x33", 32) });
    await sender.connect(tee).applyFdcSettlement(0, proofA);

    await expect(sender.connect(tee).applyFdcSettlement(1, proofA)).to.be.revertedWithCustomError(
      sender,
      "ProofAlreadyUsed"
    );
  });
});
