// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IEVMTransaction} from "@flarenetwork/flare-periphery-contracts/coston2/IEVMTransaction.sol";
import {MirrorVault} from "./MirrorVault.sol";
import {MirrorFee} from "./MirrorFee.sol";
import {MirrorRegistry} from "./MirrorRegistry.sol";
import {ITeeExtensionRegistry} from "./interfaces/ITeeExtensionRegistry.sol";
import {ITeeMachineRegistry} from "./interfaces/ITeeMachineRegistry.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {IFdcEvmVerifier} from "./MirrorFee.sol";

/// @title InstructionSender
/// @notice Sole authorized forwarder for vault settlements and fee accrual. Enforces nonce ordering.
contract InstructionSender is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct FeeAccrual {
        address lead;
        address follower;
        uint256 profit;
        uint256 epochId;
    }

    struct PendingFill {
        address follower;
        address lead;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        uint256 profit;
        uint256 epochId;
        bool exists;
        bool settled;
    }

    struct MatchExecution {
        address follower;
        address lead;
        ISwapRouter.ExactInputSingleParams swap;
        uint256 profit;
        uint256 epochId;
    }

    error UnauthorizedExecutor();
    error InvalidNonce();
    error NonceAlreadyUsed();
    error RouterNotSet();
    error FillNotFound();
    error FillAlreadySettled();
    error ProofMismatch();
    error InvalidProof();
    error ProofAlreadyUsed();
    error FdcVerifierNotSet();

    event AuthorizedExecutorUpdated(address indexed previousExecutor, address indexed newExecutor);
    event SettlementForwarded(uint256 indexed batchNonce, uint256 settlementCount);
    event FeeAccrualForwarded(uint256 indexed batchNonce, uint256 accrualCount);

    MirrorVault public immutable vault;
    MirrorFee public immutable fee;
    MirrorRegistry public immutable registry;

    // ---------------------------------------------------------------------
    // FCC: optional (set post-deploy). Kept optional so existing Phase 1/2
    // deployments keep their constructor signature.
    // ---------------------------------------------------------------------

    // Greeting Stage A canary.
    bytes32 public constant OP_TYPE_GREETING = bytes32("GREETING");
    bytes32 public constant OP_COMMAND_SAY_HELLO = bytes32("SAY_HELLO");

    // Mirror matching engine Stage B.
    bytes32 public constant OP_TYPE_MIRROR = bytes32("MIRROR");
    bytes32 public constant OP_COMMAND_MATCH_V1 = bytes32("MATCH_V1");
    bytes32 public constant OP_COMMAND_TOPUP_V1 = bytes32("TOPUP_V1");

    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000; // 65536

    ITeeExtensionRegistry public teeExtensionRegistry;
    ITeeMachineRegistry public teeMachineRegistry;
    uint256 private _extensionId;

    address public authorizedExecutor;
    uint256 public batchNonce;
    mapping(uint256 => bool) public usedBatchNonces;

    ISwapRouter public swapRouter;
    IFdcEvmVerifier public fdcVerifier;
    uint256 public nextFillId;
    mapping(uint256 => PendingFill) public pendingFills;
    mapping(bytes32 => bool) public usedProofTxHashes;

    error TeeRegistriesNotSet();
    error ExtensionIdNotSet();
    error TEERegistryAlreadySet();

    event TeeRegistriesSet(address indexed extensionRegistry, address indexed machineRegistry);
    event ExtensionIdSet(uint256 indexed extensionId);
    event SwapRouterUpdated(address indexed router);
    event FdcVerifierUpdated(address indexed verifier);
    event MatchExecuted(uint256 indexed fillId, address follower, address lead, uint256 amountIn, uint256 amountOut);
    event FillSettled(uint256 indexed fillId, bytes32 txHash);

    constructor(
        address vault_,
        address fee_,
        address registry_,
        address authorizedExecutor_,
        address initialOwner
    ) Ownable(initialOwner) {
        vault = MirrorVault(vault_);
        fee = MirrorFee(fee_);
        registry = MirrorRegistry(registry_);
        authorizedExecutor = authorizedExecutor_;
    }

    modifier onlyAuthorizedExecutor() {
        if (msg.sender != authorizedExecutor && msg.sender != owner()) revert UnauthorizedExecutor();
        _;
    }

    /**
     * @notice Set FCC registry addresses once (post-deploy).
     * Used by Stage A/B instruction submission paths.
     */
    function setTeeRegistries(address extRegistry_, address machineRegistry_) external onlyOwner {
        if (address(teeExtensionRegistry) != address(0) || address(teeMachineRegistry) != address(0)) {
            revert TEERegistryAlreadySet();
        }
        require(extRegistry_ != address(0), "TeeExtensionRegistry cannot be zero address");
        require(machineRegistry_ != address(0), "TeeMachineRegistry cannot be zero address");
        require(extRegistry_.code.length > 0, "TeeExtensionRegistry has no code");
        require(machineRegistry_.code.length > 0, "TeeMachineRegistry has no code");

        teeExtensionRegistry = ITeeExtensionRegistry(extRegistry_);
        teeMachineRegistry = ITeeMachineRegistry(machineRegistry_);
        emit TeeRegistriesSet(extRegistry_, machineRegistry_);
    }

    /**
     * @notice Discover and cache the extension id assigned to this contract.
     * This mirrors the scaffold HelloWorldInstructionSender behaviour.
     */
    function setExtensionId() external onlyOwner {
        if (address(teeExtensionRegistry) == address(0) || address(teeMachineRegistry) == address(0)) {
            revert TeeRegistriesNotSet();
        }
        require(_extensionId == 0, "Extension ID already set.");

        uint256 c = teeExtensionRegistry.nextPublicExtensionId();
        for (uint256 i = FIRST_PUBLIC_EXTENSION_ID; i < c; ++i) {
            if (teeExtensionRegistry.getTeeExtensionInstructionsSender(i) == address(this)) {
                _extensionId = i;
                emit ExtensionIdSet(i);
                return;
            }
        }
        revert("Extension ID not found.");
    }

    function _getExtensionId() internal view returns (uint256) {
        if (_extensionId == 0) revert ExtensionIdNotSet();
        return _extensionId;
    }

    function setAuthorizedExecutor(address executor) external onlyOwner {
        address previous = authorizedExecutor;
        authorizedExecutor = executor;
        emit AuthorizedExecutorUpdated(previous, executor);
    }

    function setSwapRouter(address router) external onlyOwner {
        swapRouter = ISwapRouter(router);
        emit SwapRouterUpdated(router);
    }

    function setFdcVerifier(address verifier) external onlyOwner {
        fdcVerifier = IFdcEvmVerifier(verifier);
        emit FdcVerifierUpdated(verifier);
    }

    /// @notice Execute TEE-assembled exactInputSingle against the configured router. Does not settle vault balances.
    function executeMatch(MatchExecution calldata exec)
        external
        onlyAuthorizedExecutor
        nonReentrant
        returns (uint256 fillId, uint256 amountOut)
    {
        if (address(swapRouter) == address(0)) revert RouterNotSet();

        ISwapRouter.ExactInputSingleParams memory params = exec.swap;
        params.recipient = address(this);
        address fxrp = address(vault.fxrpToken());

        if (params.tokenIn == fxrp) {
            vault.transferForExecution(exec.follower, exec.lead, params.amountIn);
        }

        IERC20(params.tokenIn).forceApprove(address(swapRouter), params.amountIn);
        amountOut = swapRouter.exactInputSingle(params);

        if (params.tokenOut == fxrp) {
            IERC20(fxrp).forceApprove(address(vault), amountOut);
            vault.receiveExecutionProceeds(amountOut);
        }

        fillId = nextFillId;
        unchecked {
            ++nextFillId;
        }
        pendingFills[fillId] = PendingFill({
            follower: exec.follower,
            lead: exec.lead,
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amountIn: params.amountIn,
            amountOut: amountOut,
            profit: exec.profit,
            epochId: exec.epochId,
            exists: true,
            settled: false
        });

        emit MatchExecuted(fillId, exec.follower, exec.lead, params.amountIn, amountOut);
    }

    /// @notice Commit vault delta + fee release after a matching FDC EVMTransaction proof.
    function applyFdcSettlement(uint256 fillId, IEVMTransaction.Proof calldata proof)
        external
        onlyAuthorizedExecutor
        nonReentrant
    {
        if (address(fdcVerifier) == address(0)) revert FdcVerifierNotSet();
        PendingFill storage fill = pendingFills[fillId];
        if (!fill.exists) revert FillNotFound();
        if (fill.settled) revert FillAlreadySettled();
        if (!fdcVerifier.verifyEVMTransaction(proof)) revert InvalidProof();

        bytes32 txHash = proof.data.requestBody.transactionHash;
        if (txHash == bytes32(0)) revert InvalidProof();
        if (usedProofTxHashes[txHash]) revert ProofAlreadyUsed();
        if (proof.data.responseBody.status != 1) revert InvalidProof();
        // Outer tx is executeMatch: to = this, from = authorized executor (or owner).
        if (proof.data.responseBody.receivingAddress != address(this)) revert ProofMismatch();

        _matchSwapEvent(proof, fill);

        usedProofTxHashes[txHash] = true;
        fill.settled = true;

        address fxrp = address(vault.fxrpToken());
        int256 delta;
        if (fill.tokenIn == fxrp) {
            delta = -int256(fill.amountIn);
        } else if (fill.tokenOut == fxrp) {
            delta = int256(fill.amountOut);
        }
        if (delta != 0) {
            vault.settleFromProof(fill.follower, fill.lead, delta);
        }

        if (fill.profit > 0) {
            uint256 netFee = fee.accrueFee(fill.lead, fill.follower, fill.profit, fill.epochId);
            if (netFee > 0) {
                fee.releaseFee(proof, fill.lead, netFee);
            }
        }

        emit FillSettled(fillId, txHash);
    }

    bytes32 private constant SWAP_TOPIC0 =
        keccak256("Swap(address,address,address,address,uint256,uint256)");

    function _matchSwapEvent(IEVMTransaction.Proof calldata proof, PendingFill storage fill) internal view {
        IEVMTransaction.Event[] calldata events = proof.data.responseBody.events;
        address router = address(swapRouter);
        for (uint256 i = 0; i < events.length; ++i) {
            IEVMTransaction.Event calldata ev = events[i];
            if (ev.removed || ev.emitterAddress != router) continue;
            if (ev.topics.length == 0 || ev.topics[0] != SWAP_TOPIC0) continue;
            if (ev.data.length < 128) revert ProofMismatch();

            bytes memory data = ev.data;
            address tokenIn;
            address tokenOut;
            uint256 amountIn;
            uint256 amountOut;
            assembly {
                tokenIn := mload(add(data, 32))
                tokenOut := mload(add(data, 64))
                amountIn := mload(add(data, 96))
                amountOut := mload(add(data, 128))
            }
            if (tokenIn != fill.tokenIn || tokenOut != fill.tokenOut) revert ProofMismatch();
            if (amountIn != fill.amountIn || amountOut != fill.amountOut) revert ProofMismatch();
            return;
        }
        revert ProofMismatch();
    }

    /**
     * @notice Stage A (GREETING/SAY_HELLO) FCC instruction submission.
     * Does NOT mutate vault/fee state (only the extension routes & returns data).
     */
    function sendSayHello(bytes calldata message) external payable returns (bytes32 instructionId) {
        if (address(teeExtensionRegistry) == address(0) || address(teeMachineRegistry) == address(0)) {
            revert TeeRegistriesNotSet();
        }

        address[] memory teeIds = teeMachineRegistry.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);

        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry
            .TeeInstructionParams({
                opType: OP_TYPE_GREETING,
                opCommand: OP_COMMAND_SAY_HELLO,
                message: message,
                cosigners: cosigners,
                cosignersThreshold: 0,
                claimBackAddress: msg.sender
            });

        instructionId = teeExtensionRegistry.sendInstructions{value: msg.value}(teeIds, params);
    }

    /**
     * @notice Stage B (Mirror matching engine v1) FCC instruction submission.
     * The extension performs decrypt -> FTSO reads -> calldata assembly.
     */
    function sendMirrorMatchStageB(bytes calldata encryptedSignal) external payable returns (bytes32 instructionId) {
        if (address(teeExtensionRegistry) == address(0) || address(teeMachineRegistry) == address(0)) {
            revert TeeRegistriesNotSet();
        }

        address[] memory teeIds = teeMachineRegistry.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);

        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry
            .TeeInstructionParams({
                opType: OP_TYPE_MIRROR,
                opCommand: OP_COMMAND_MATCH_V1,
                message: encryptedSignal,
                cosigners: cosigners,
                cosignersThreshold: 0,
                claimBackAddress: msg.sender
            });

        instructionId = teeExtensionRegistry.sendInstructions{value: msg.value}(teeIds, params);
    }

    /**
     * @notice Phase 9 collateral top-up via matching-engine FCE (TOPUP_V1).
     */
    function sendMirrorTopUp(bytes calldata topUpPayload) external payable returns (bytes32 instructionId) {
        if (address(teeExtensionRegistry) == address(0) || address(teeMachineRegistry) == address(0)) {
            revert TeeRegistriesNotSet();
        }

        address[] memory teeIds = teeMachineRegistry.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);

        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry
            .TeeInstructionParams({
                opType: OP_TYPE_MIRROR,
                opCommand: OP_COMMAND_TOPUP_V1,
                message: topUpPayload,
                cosigners: cosigners,
                cosignersThreshold: 0,
                claimBackAddress: msg.sender
            });

        instructionId = teeExtensionRegistry.sendInstructions{value: msg.value}(teeIds, params);
    }

    function settleBatch(
        MirrorVault.Settlement[] calldata settlements,
        uint256 nonce
    ) external onlyAuthorizedExecutor nonReentrant {
        // Phase 5: vault.settleBatch reverts unless legacySettleBatchEnabled — prefer applyFdcSettlement.
        _validateAndConsumeNonce(nonce);
        vault.settleBatch(settlements);
        emit SettlementForwarded(nonce, settlements.length);
    }

    function accrueFees(FeeAccrual[] calldata accruals, uint256 nonce) external onlyAuthorizedExecutor nonReentrant {
        _validateAndConsumeNonce(nonce);
        uint256 count = accruals.length;
        for (uint256 i = 0; i < count; ++i) {
            FeeAccrual calldata a = accruals[i];
            fee.accrueFee(a.lead, a.follower, a.profit, a.epochId);
        }
        emit FeeAccrualForwarded(nonce, count);
    }

    function finalizeWithdrawal(address follower, address lead, uint256 nonce)
        external
        onlyAuthorizedExecutor
        nonReentrant
    {
        _validateAndConsumeNonce(nonce);
        vault.finalizeWithdrawal(follower, lead);
    }

    function _validateAndConsumeNonce(uint256 nonce) internal {
        if (nonce != batchNonce) revert InvalidNonce();
        if (usedBatchNonces[nonce]) revert NonceAlreadyUsed();
        usedBatchNonces[nonce] = true;
        unchecked {
            ++batchNonce;
        }
    }
}
