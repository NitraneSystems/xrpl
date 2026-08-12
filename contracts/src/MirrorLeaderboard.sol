// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MirrorLeaderboard
/// @notice Attested performance scores updated only by the AI Agent FCE signer.
contract MirrorLeaderboard is Ownable {
    struct ScoreRecord {
        uint8 score;
        bytes32 attestationId;
        uint256 updatedAt;
    }

    error OnlyAiAgentSigner();
    error InvalidScore();
    error LeadNotFound();

    event AiAgentSignerUpdated(address indexed previousSigner, address indexed newSigner);
    event ScoreUpdated(address indexed lead, uint8 score, bytes32 attestationId);

    address public aiAgentSigner;
    address[] private _rankedLeads;

    mapping(address => ScoreRecord) public scores;
    mapping(address => bool) public isRanked;

    constructor(address aiAgentSigner_, address initialOwner) Ownable(initialOwner) {
        aiAgentSigner = aiAgentSigner_;
    }

    modifier onlyAiAgentSigner() {
        if (msg.sender != aiAgentSigner) revert OnlyAiAgentSigner();
        _;
    }

    function setAiAgentSigner(address signer) external onlyOwner {
        address previous = aiAgentSigner;
        aiAgentSigner = signer;
        emit AiAgentSignerUpdated(previous, signer);
    }

    function updateScore(address lead, uint8 score, bytes32 attestationId) external onlyAiAgentSigner {
        if (score > 100) revert InvalidScore();
        if (lead == address(0)) revert LeadNotFound();

        scores[lead] = ScoreRecord({
            score: score,
            attestationId: attestationId,
            updatedAt: block.timestamp
        });

        if (!isRanked[lead]) {
            isRanked[lead] = true;
            _rankedLeads.push(lead);
        }

        emit ScoreUpdated(lead, score, attestationId);
    }

    function getScore(address lead) external view returns (ScoreRecord memory) {
        return scores[lead];
    }

    function getRankedLeads() external view returns (address[] memory) {
        return _rankedLeads;
    }
}
