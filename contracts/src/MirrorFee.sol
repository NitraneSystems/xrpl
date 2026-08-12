// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEVMTransaction} from "@flarenetwork/flare-periphery-contracts/coston2/IEVMTransaction.sol";
import {MirrorRegistry} from "./MirrorRegistry.sol";

interface IFdcEvmVerifier {
    function verifyEVMTransaction(IEVMTransaction.Proof calldata _proof) external view returns (bool);
}

/// @title MirrorFee
/// @notice Fee accrual keyed by lead/epoch with FDC-gated release.
contract MirrorFee is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant PROTOCOL_FEE_BPS = 1000;
    uint16 public constant MAX_LEAD_FEE_BPS = 2000;
    uint16 public constant BPS_DENOMINATOR = 10000;

    error OnlyInstructionSender();
    error ZeroAmount();
    error NothingToClaim();
    error InvalidProof();
    error ProofAlreadyUsed();
    error ProofRequired();
    error FdcVerifierNotSet();
    error AmountMismatch();

    event InstructionSenderUpdated(address indexed previousSender, address indexed newSender);
    event FdcVerifierUpdated(address indexed verifier);
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
    IFdcEvmVerifier public fdcVerifier;

    mapping(address => uint256) public accruedFees;
    mapping(bytes32 => bool) public usedProofs;

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

    function setFdcVerifier(address verifier) external onlyOwner {
        fdcVerifier = IFdcEvmVerifier(verifier);
        emit FdcVerifierUpdated(verifier);
    }

    function quoteNetFee(address lead, uint256 profit) public view returns (uint256 netFee) {
        if (profit == 0) return 0;
        MirrorRegistry.LeadTrader memory leadTrader = registry.getLead(lead);
        if (leadTrader.wallet == address(0)) return 0;
        uint256 grossFee = (profit * leadTrader.feeRateBps) / MAX_LEAD_FEE_BPS;
        if (grossFee == 0) return 0;
        uint256 protocolFee = (grossFee * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        return grossFee - protocolFee;
    }

    /// @notice Accrue lead performance fee from follower profit. Not withdrawable until FDC release.
    function accrueFee(
        address lead,
        address follower,
        uint256 profit,
        uint256 epochId
    ) external onlyInstructionSender returns (uint256 netFee) {
        if (profit == 0) revert ZeroAmount();

        MirrorRegistry.LeadTrader memory leadTrader = registry.getLead(lead);
        if (leadTrader.wallet == address(0)) revert ZeroAmount();

        uint256 grossFee = (profit * leadTrader.feeRateBps) / MAX_LEAD_FEE_BPS;
        if (grossFee == 0) return 0;

        uint256 protocolFee = (grossFee * PROTOCOL_FEE_BPS) / BPS_DENOMINATOR;
        netFee = grossFee - protocolFee;

        accruedFees[lead] += netFee;
        emit FeeAccrued(lead, follower, grossFee, protocolFee, netFee, epochId);
    }

    /// @notice Cannot withdraw accrued fees without an FDC proof. Use releaseFee.
    function claim(address) external pure {
        revert ProofRequired();
    }

    /// @notice FDC proof-gated fee release. Pays the lead, never msg.sender.
    function releaseFee(
        IEVMTransaction.Proof calldata proof,
        address lead,
        uint256 amount
    ) external onlyInstructionSender nonReentrant {
        if (address(fdcVerifier) == address(0)) revert FdcVerifierNotSet();
        if (amount == 0) revert ZeroAmount();
        if (!fdcVerifier.verifyEVMTransaction(proof)) revert InvalidProof();

        bytes32 txHash = proof.data.requestBody.transactionHash;
        if (txHash == bytes32(0)) revert InvalidProof();
        if (usedProofs[txHash]) revert ProofAlreadyUsed();
        if (proof.data.responseBody.status != 1) revert InvalidProof();
        if (accruedFees[lead] < amount) revert AmountMismatch();

        usedProofs[txHash] = true;
        accruedFees[lead] -= amount;
        fxrpToken.safeTransfer(lead, amount);
        emit FeeReleased(lead, txHash, amount);
    }
}
