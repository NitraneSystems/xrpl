// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MirrorVault
/// @notice Single-asset FXRP sub-account custody for followers mirroring leads.
contract MirrorVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Settlement {
        address follower;
        address lead;
        int256 balanceDelta;
        uint256 nonce;
    }

    struct SubAccount {
        uint256 balance;
        uint256 pendingWithdrawal;
    }

    error OnlyInstructionSender();
    error ZeroAmount();
    error InsufficientBalance();
    error WithdrawalExceedsBalance();
    error InvalidSettlement();
    error DuplicateNonce();

    event InstructionSenderUpdated(address indexed previousSender, address indexed newSender);
    event Deposited(address indexed follower, address indexed lead, uint256 amount);
    event WithdrawalRequested(address indexed follower, address indexed lead, uint256 amount);
    event BatchSettled(uint256 batchNonce, uint256 settlementCount);

    IERC20 public immutable fxrpToken;
    address public instructionSender;

    mapping(address => mapping(address => SubAccount)) public subAccounts;
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    constructor(address fxrpToken_, address initialOwner) Ownable(initialOwner) {
        fxrpToken = IERC20(fxrpToken_);
    }

    modifier onlyInstructionSender() {
        if (msg.sender != instructionSender) revert OnlyInstructionSender();
        _;
    }

    function setInstructionSender(address sender) external onlyOwner {
        address previous = instructionSender;
        instructionSender = sender;
        emit InstructionSenderUpdated(previous, sender);
    }

    function deposit(address lead, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        fxrpToken.safeTransferFrom(msg.sender, address(this), amount);
        subAccounts[msg.sender][lead].balance += amount;

        emit Deposited(msg.sender, lead, amount);
    }

    function requestWithdrawal(address lead, uint256 amount) external nonReentrant {
        SubAccount storage account = subAccounts[msg.sender][lead];
        if (amount == 0) revert ZeroAmount();
        if (account.balance < amount) revert InsufficientBalance();

        account.balance -= amount;
        account.pendingWithdrawal += amount;

        emit WithdrawalRequested(msg.sender, lead, amount);
    }

    /// @notice Apply post-execution balance deltas. Callable only by InstructionSender.
    function settleBatch(Settlement[] calldata settlements) external onlyInstructionSender nonReentrant {
        uint256 count = settlements.length;
        for (uint256 i = 0; i < count; ++i) {
            Settlement calldata s = settlements[i];
            if (s.follower == address(0) || s.lead == address(0)) revert InvalidSettlement();
            if (usedNonces[s.follower][s.nonce]) revert DuplicateNonce();

            usedNonces[s.follower][s.nonce] = true;

            SubAccount storage account = subAccounts[s.follower][s.lead];
            if (s.balanceDelta < 0) {
                uint256 debit = uint256(-s.balanceDelta);
                if (account.balance < debit) revert InsufficientBalance();
                account.balance -= debit;
            } else if (s.balanceDelta > 0) {
                account.balance += uint256(s.balanceDelta);
            }
        }

        emit BatchSettled(block.number, count);
    }

    /// @notice Release pending withdrawals to followers after TEE settlement (Phase 3+).
    function finalizeWithdrawal(address follower, address lead) external onlyInstructionSender nonReentrant {
        SubAccount storage account = subAccounts[follower][lead];
        uint256 amount = account.pendingWithdrawal;
        if (amount == 0) revert ZeroAmount();

        account.pendingWithdrawal = 0;
        fxrpToken.safeTransfer(follower, amount);
    }

    function getBalance(address follower, address lead) external view returns (uint256) {
        return subAccounts[follower][lead].balance;
    }

    function getPendingWithdrawal(address follower, address lead) external view returns (uint256) {
        return subAccounts[follower][lead].pendingWithdrawal;
    }
}
