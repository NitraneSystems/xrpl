// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MockFirelightStrategy
 * @notice IStrategy-style stand-in for Firelight passive staking on Coston2.
 *
 * This is a stand-in for Firelight's strategy interface used by Mirror's passive tier.
 * A real Firelight vault exists on Coston2 (`0xC90D6847747b85d1fa2E07859869fb9fB72c0361`) but
 * passive-staking UX is out of MVP scope — swap this address in config when that tier ships.
 * Replace with the real integration once Mirror enables Firelight staking or moves to mainnet.
 */
contract MockFirelightStrategy is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error InsufficientShares();

    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 assets, uint256 shares);
    event YieldSet(uint256 yieldAmount);

    IERC20 public immutable asset;
    mapping(address => uint256) public balanceOf;
    uint256 public totalShares;
    uint256 public totalAssets;
    /// @notice Simulated yield credited to totalAssets (demo only).
    uint256 public yieldAmount;

    constructor(address asset_, address initialOwner) Ownable(initialOwner) {
        asset = IERC20(asset_);
    }

    function setYieldAmount(uint256 amount) external onlyOwner {
        if (amount >= yieldAmount) {
            totalAssets += (amount - yieldAmount);
        } else {
            uint256 dec = yieldAmount - amount;
            if (totalAssets > dec) totalAssets -= dec;
            else totalAssets = 0;
        }
        yieldAmount = amount;
        emit YieldSet(amount);
    }

    function deposit(uint256 assets) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), assets);
        shares = totalShares == 0 || totalAssets == 0 ? assets : (assets * totalShares) / totalAssets;
        if (shares == 0) shares = assets;
        balanceOf[msg.sender] += shares;
        totalShares += shares;
        totalAssets += assets;
        emit Deposited(msg.sender, assets, shares);
    }

    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf[msg.sender] < shares) revert InsufficientShares();
        assets = totalShares == 0 ? 0 : (shares * totalAssets) / totalShares;
        balanceOf[msg.sender] -= shares;
        totalShares -= shares;
        totalAssets -= assets;
        asset.safeTransfer(msg.sender, assets);
        emit Withdrawn(msg.sender, assets, shares);
    }

    function convertToAssets(uint256 shares) external view returns (uint256) {
        if (totalShares == 0) return shares;
        return (shares * totalAssets) / totalShares;
    }
}
