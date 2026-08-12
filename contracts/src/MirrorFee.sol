// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MirrorRegistry} from "./MirrorRegistry.sol";

/// @title MirrorFee
/// @notice Fee accrual keyed by lead/epoch with FDC-gated release (Phase 5).
contract MirrorFee is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant PROTOCOL_FEE_BPS = 1000; // 10% of lead fee per PRD
    uint16 public constant MAX_LEAD_FEE_BPS = 2000; // 20% max lead fee
    uint16 public constant BPS_DENOMINATOR = 10000;

    error OnlyInstructionSender();
    error ZeroAmount();
    error NothingToClaim();
    error InvalidProof();
    error ProofAlreadyUsed();

    event InstructionSenderUpdated(address indexed previousSender, address indexed newSender);
    event FeeAccrued(
        address indexed lead,
        address indexed follower,
        uint256 grossFee,
        uint256 protocolFee,
        uint256 netFee,
        uint256 epochId
    );
    event FeeClaimed(address indexed lead, uint256 amount);
    event FeeReleased(address indexed lead, bytes32 fdcProofId, uint256 amount);

    IERC20 public immutable fxrpToken;
    MirrorRegistry public immutable registry;
    address public instructionSender;

    mapping(address => uint256) public accruedFees;
    mapping(bytes32 => bool) public usedProofs;
    mapping(bytes32 => uint256) public pendingReleaseByProof;

    constructor(address fxrpToken_, address registry_, address initialOwner) Ownable(initialOwner) {
        fxrpToken = IERC20(fxrpToken_);
        registry = MirrorRegistry(registry_);
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

    /// @notice Accrue lead performance fee from follower profit. Callable only by InstructionSender.
    function accrueFee(
        address lead,
        address follower,
        uint256 profit,
        uint256 epochId
    ) external onlyInstructionSender {
        if (profit == 0) revert ZeroAmount();

        MirrorRegistry.LeadTrader memory leadTrader = registry.getLead(lead);
        if (leadTrader.wallet == address(0)) revert ZeroAmount();

        uint256 grossFee = (profit * leadTrader.feeRateBps) / MAX_LEAD_FEE_BPS;
        if (grossFee == 0) return;

        uint256 protocolFee = (grossFee * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        uint256 netFee = grossFee - protocolFee;

        accruedFees[lead] += netFee;

        emit FeeAccrued(lead, follower, grossFee, protocolFee, netFee, epochId);
    }

    function claim(address lead) external nonReentrant {
        if (msg.sender != lead) revert ZeroAmount();

        uint256 amount = accruedFees[lead];
        if (amount == 0) revert NothingToClaim();

        accruedFees[lead] = 0;
        fxrpToken.safeTransfer(lead, amount);

        emit FeeClaimed(lead, amount);
    }

    /// @notice FDC proof-gated fee release stub — full verification wired in Phase 5.
    function releaseFee(bytes32 fdcProofId) external nonReentrant {
        if (fdcProofId == bytes32(0)) revert InvalidProof();
        if (usedProofs[fdcProofId]) revert ProofAlreadyUsed();

        uint256 amount = pendingReleaseByProof[fdcProofId];
        if (amount == 0) revert InvalidProof();

        usedProofs[fdcProofId] = true;
        delete pendingReleaseByProof[fdcProofId];

        fxrpToken.safeTransfer(msg.sender, amount);
        emit FeeReleased(msg.sender, fdcProofId, amount);
    }

    /// @notice Testnet helper to stage FDC release amounts until Phase 5 wiring.
    function stageRelease(bytes32 fdcProofId, address lead, uint256 amount) external onlyOwner {
        pendingReleaseByProof[fdcProofId] = amount;
        accruedFees[lead] += amount;
    }
}
