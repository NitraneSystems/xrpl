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
        uint256 pendingLocked;
    }

    error OnlyInstructionSender();
    error OnlyFsaOnboarder();
    error ZeroAmount();
    error InsufficientBalance();
    error WithdrawalExceedsBalance();
    error InvalidSettlement();
    error DuplicateNonce();
    error InsufficientUnlocked();
    error ProofRequiredUseSettleFromProof();

    event InstructionSenderUpdated(address indexed previousSender, address indexed newSender);
    event FsaOnboarderUpdated(address indexed previous, address indexed next);
    event Deposited(address indexed follower, address indexed lead, uint256 amount);
    event WithdrawalRequested(address indexed follower, address indexed lead, uint256 amount);
    event BatchSettled(uint256 batchNonce, uint256 settlementCount);
    event LockedForExecution(address indexed follower, address indexed lead, uint256 amount);
    event SettledFromProof(address indexed follower, address indexed lead, int256 delta);
    event LegacySettleBatchEnabled(bool enabled);

    IERC20 public immutable fxrpToken;
    address public instructionSender;
    address public fsaOnboarder;
    /// @notice Phase 5: when false (default), settleBatch reverts — use settleFromProof after FDC.
    /// Owner may enable only for controlled unit-test / emergency TEE admin paths.
    bool public legacySettleBatchEnabled;

    mapping(address => mapping(address => SubAccount)) public subAccounts;
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    constructor(address fxrpToken_, address initialOwner) Ownable(initialOwner) {
        fxrpToken = IERC20(fxrpToken_);
    }

    modifier onlyInstructionSender() {
        if (msg.sender != instructionSender) revert OnlyInstructionSender();
        _;
    }

    modifier onlyFsaOnboarder() {
        if (msg.sender != fsaOnboarder) revert OnlyFsaOnboarder();
        _;
    }

    function setInstructionSender(address sender) external onlyOwner {
        address previous = instructionSender;
        instructionSender = sender;
        emit InstructionSenderUpdated(previous, sender);
    }

    function setFsaOnboarder(address onboarder) external onlyOwner {
        address previous = fsaOnboarder;
        fsaOnboarder = onboarder;
        emit FsaOnboarderUpdated(previous, onboarder);
    }

    /// @notice Toggle proof-free settleBatch. Default off after Phase 5 (FDC-gated settlement).
    function setLegacySettleBatchEnabled(bool enabled) external onlyOwner {
        legacySettleBatchEnabled = enabled;
        emit LegacySettleBatchEnabled(enabled);
    }

    function deposit(address lead, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        fxrpToken.safeTransferFrom(msg.sender, address(this), amount);
        subAccounts[msg.sender][lead].balance += amount;

        emit Deposited(msg.sender, lead, amount);
    }

    /// @notice FSA onboarder deposits FXRP already held by this contract for a PersonalAccount follower.
    function depositFor(address follower, address lead, uint256 amount) external onlyFsaOnboarder nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (follower == address(0)) revert InvalidSettlement();

        fxrpToken.safeTransferFrom(msg.sender, address(this), amount);
        subAccounts[follower][lead].balance += amount;

        emit Deposited(follower, lead, amount);
    }

    function requestWithdrawal(address lead, uint256 amount) external nonReentrant {
        SubAccount storage account = subAccounts[msg.sender][lead];
        if (amount == 0) revert ZeroAmount();
        uint256 available = account.balance - account.pendingLocked;
        if (available < amount) revert InsufficientBalance();

        account.balance -= amount;
        account.pendingWithdrawal += amount;

        emit WithdrawalRequested(msg.sender, lead, amount);
    }

    /// @notice Lock FXRP for an unconfirmed swap. Recorded `balance` is unchanged until settleFromProof.
    function transferForExecution(address follower, address lead, uint256 amount)
        external
        onlyInstructionSender
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        SubAccount storage account = subAccounts[follower][lead];
        uint256 available = account.balance - account.pendingLocked;
        if (available < amount) revert InsufficientUnlocked();

        account.pendingLocked += amount;
        fxrpToken.safeTransfer(msg.sender, amount);
        emit LockedForExecution(follower, lead, amount);
    }

    /// @notice Commit a swap fill after a matching FDC proof. Positive delta credits FXRP already received.
    function settleFromProof(address follower, address lead, int256 delta)
        external
        onlyInstructionSender
        nonReentrant
    {
        if (follower == address(0) || lead == address(0)) revert InvalidSettlement();
        SubAccount storage account = subAccounts[follower][lead];

        if (delta < 0) {
            uint256 debit = uint256(-delta);
            if (account.pendingLocked < debit) revert InsufficientUnlocked();
            if (account.balance < debit) revert InsufficientBalance();
            account.pendingLocked -= debit;
            account.balance -= debit;
        } else if (delta > 0) {
            account.balance += uint256(delta);
        }

        emit SettledFromProof(follower, lead, delta);
    }

    /// @notice Accept FXRP received from a swap into vault custody (balance credited only on proof).
    function receiveExecutionProceeds(uint256 amount) external onlyInstructionSender nonReentrant {
        if (amount == 0) revert ZeroAmount();
        fxrpToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Deprecated proof-free settlement. Reverts unless `legacySettleBatchEnabled`.
    /// Phase 5 path: use `settleFromProof` after FDC verification via InstructionSender.applyFdcSettlement.
    function settleBatch(Settlement[] calldata settlements) external onlyInstructionSender nonReentrant {
        if (!legacySettleBatchEnabled) revert ProofRequiredUseSettleFromProof();
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

    function getPendingLocked(address follower, address lead) external view returns (uint256) {
        return subAccounts[follower][lead].pendingLocked;
    }
}
