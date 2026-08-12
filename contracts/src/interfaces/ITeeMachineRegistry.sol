// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

// Minimal interface needed by our FCC-compatible InstructionSender.
interface ITeeMachineRegistry {
    function getRandomTeeIds(uint256 extensionId, uint256 count) external view returns (address[] memory);
}

