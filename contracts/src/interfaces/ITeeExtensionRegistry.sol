// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

// Minimal interface needed by our FCC-compatible InstructionSender.
interface ITeeExtensionRegistry {
    struct TeeInstructionParams {
        bytes32 opType;
        bytes32 opCommand;
        bytes message;
        address[] cosigners;
        uint64 cosignersThreshold;
        address claimBackAddress;
    }

    function sendInstructions(
        address[] calldata _teeIds,
        TeeInstructionParams calldata _instructionParams
    ) external payable returns (bytes32 _instructionId);

    function nextPublicExtensionId() external view returns (uint256);

    function getTeeExtensionInstructionsSender(uint256 _extensionId)
        external
        view
        returns (address);
}

