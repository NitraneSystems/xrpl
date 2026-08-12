import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { MirrorLeaderboard, MirrorRegistry } from "../typechain-types";

describe("MirrorLeaderboard", function () {
  let leaderboard: MirrorLeaderboard;
  let aiAgent: HardhatEthersSigner;
  let deployer: HardhatEthersSigner;
  let lead: HardhatEthersSigner;
  let owner: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, aiAgent, deployer, lead] = await ethers.getSigners();

    const Leaderboard = await ethers.getContractFactory("MirrorLeaderboard");
    leaderboard = await Leaderboard.deploy(aiAgent.address, owner.address);
    await leaderboard.waitForDeployment();
  });

  it("updates score from ai agent signer", async function () {
    const attestationId = ethers.id("fdc-web2json-1");
    await expect(leaderboard.connect(aiAgent).updateScore(lead.address, 85, attestationId))
      .to.emit(leaderboard, "ScoreUpdated")
      .withArgs(lead.address, 85, attestationId);

    const record = await leaderboard.getScore(lead.address);
    expect(record.score).to.equal(85);
    expect(record.attestationId).to.equal(attestationId);

    const ranked = await leaderboard.getRankedLeads();
    expect(ranked).to.include(lead.address);
  });

  it("reverts updateScore from deployer", async function () {
    await expect(
      leaderboard.connect(deployer).updateScore(lead.address, 50, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(leaderboard, "OnlyAiAgentSigner");
  });

  it("reverts updateScore from lead trader (non-ai-agent)", async function () {
    await expect(
      leaderboard.connect(lead).updateScore(lead.address, 50, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(leaderboard, "OnlyAiAgentSigner");
  });

  it("reverts updateScore from a non-ai matching-engine-like signer", async function () {
    const [, , , , matchingEngine] = await ethers.getSigners();
    await expect(
      leaderboard.connect(matchingEngine).updateScore(lead.address, 50, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(leaderboard, "OnlyAiAgentSigner");
  });

  it("reverts invalid score over 100", async function () {
    await expect(
      leaderboard.connect(aiAgent).updateScore(lead.address, 101, ethers.ZeroHash)
    ).to.be.revertedWithCustomError(leaderboard, "InvalidScore");
  });
});
