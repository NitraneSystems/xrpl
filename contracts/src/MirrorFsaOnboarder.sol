// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MirrorRegistry} from "./MirrorRegistry.sol";
import {MirrorVault} from "./MirrorVault.sol";

/// @title MirrorFsaOnboarder
/// @notice Single-call XRPL Smart Account onboarding into Mirror (register + deposit + follow).
/// @dev Invoked by the FSA PersonalAccount via custom instruction (0xFE). msg.sender is the follower.
contract MirrorFsaOnboarder is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error ZeroAddress();
    error AllocationBelowMinimum();
    error InvalidLead();

    event FsaOnboarded(address indexed personalAccount, address indexed lead, uint256 amount, uint8 riskProfile);

    IERC20 public immutable fxrpToken;
    MirrorRegistry public immutable registry;
    MirrorVault public immutable vault;

    constructor(address fxrpToken_, address registry_, address vault_, address initialOwner)
        Ownable(initialOwner)
    {
        if (fxrpToken_ == address(0) || registry_ == address(0) || vault_ == address(0)) {
            revert ZeroAddress();
        }
        fxrpToken = IERC20(fxrpToken_);
        registry = MirrorRegistry(registry_);
        vault = MirrorVault(vault_);
    }

    /// @notice Register (if needed), deposit FXRP, and follow a lead. Caller = PersonalAccount.
    /// @dev Caller must `approve` this contract for `amount` FXRP before calling.
    function onboard(address lead, uint256 amount, uint8 riskProfile) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (lead == address(0)) revert ZeroAddress();

        address follower = msg.sender;

        MirrorRegistry.LeadTrader memory leadInfo = registry.getLead(lead);
        if (leadInfo.wallet == address(0)) revert InvalidLead();
        if (amount < leadInfo.minAllocation) revert AllocationBelowMinimum();

        MirrorRegistry.FollowerProfile memory profile = registry.getFollower(follower);
        if (!profile.registered) {
            registry.registerFollowerAs(follower, riskProfile);
        }

        MirrorRegistry.FollowAllocation memory alloc = registry.getFollowAllocation(follower, lead);
        if (!alloc.active) {
            registry.followLeadAs(follower, lead, amount);
        }

        fxrpToken.safeTransferFrom(follower, address(this), amount);
        fxrpToken.forceApprove(address(vault), amount);
        vault.depositFor(follower, lead, amount);

        emit FsaOnboarded(follower, lead, amount, riskProfile);
    }
}
