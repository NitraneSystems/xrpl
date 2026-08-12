// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MirrorVault} from "./MirrorVault.sol";
import {MirrorFee} from "./MirrorFee.sol";
import {MirrorRegistry} from "./MirrorRegistry.sol";
import {ITeeExtensionRegistry} from "./interfaces/ITeeExtensionRegistry.sol";
import {ITeeMachineRegistry} from "./interfaces/ITeeMachineRegistry.sol";

/// @title InstructionSender
/// @notice Sole authorized forwarder for vault settlements and fee accrual. Enforces nonce ordering.
contract InstructionSender is Ownable, ReentrancyGuard {
    struct FeeAccrual {
        address lead;
        address follower;
        uint256 profit;
        uint256 epochId;
    }

    error UnauthorizedExecutor();
    error InvalidNonce();
    error NonceAlreadyUsed();

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

    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000; // 65536

    ITeeExtensionRegistry public teeExtensionRegistry;
    ITeeMachineRegistry public teeMachineRegistry;
    uint256 private _extensionId;

    address public authorizedExecutor;
    uint256 public batchNonce;
    mapping(uint256 => bool) public usedBatchNonces;

    error TeeRegistriesNotSet();
    error ExtensionIdNotSet();
    error TEERegistryAlreadySet();

    event TeeRegistriesSet(address indexed extensionRegistry, address indexed machineRegistry);
    event ExtensionIdSet(uint256 indexed extensionId);

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

    function settleBatch(
        MirrorVault.Settlement[] calldata settlements,
        uint256 nonce
    ) external onlyAuthorizedExecutor nonReentrant {
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
