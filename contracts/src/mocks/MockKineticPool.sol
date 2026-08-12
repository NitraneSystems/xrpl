// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MockKineticPool
 * @notice Stand-in for Kinetic's lending pool interface on Coston2.
 *
 * This is a stand-in for Kinetic, which has no usable Coston2 deployment as of this build.
 * Replace with the real integration once Kinetic ships verified Coston2 addresses or Mirror
 * moves to mainnet. Interface shape (supply / borrow / account liquidity) is intentionally
 * Kinetic-like so swapping addresses later is a config change, not a rewrite.
 */
contract MockKineticPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error InsufficientCollateral();
    error InsufficientLiquidity();
    error HealthyPosition();

    event Supplied(address indexed user, uint256 amount);
    event Borrowed(address indexed user, uint256 amount);
    event Repaid(address indexed user, uint256 amount);
    event PriceUpdated(uint256 priceWei);
    event Liquidated(address indexed user, uint256 repayAmount, uint256 seizeAmount);

    IERC20 public immutable asset;

    /// @notice Collateral factor in bps (e.g. 7500 = 75%).
    uint256 public collateralFactorBps = 7500;
    /// @notice Liquidation threshold in bps (e.g. 11000 = 1.10× collateral/debt in value terms stored as ratio*10000).
    uint256 public liquidationThresholdBps = 11000;
    /// @notice Asset price in USD wei (1e18 = $1).
    uint256 public priceWei = 1e18;

    mapping(address => uint256) public supplyBalance;
    mapping(address => uint256) public borrowBalance;
    uint256 public totalSupply;
    uint256 public totalBorrow;

    constructor(address asset_, address initialOwner) Ownable(initialOwner) {
        asset = IERC20(asset_);
    }

    function setCollateralFactorBps(uint256 bps) external onlyOwner {
        collateralFactorBps = bps;
    }

    function setLiquidationThresholdBps(uint256 bps) external onlyOwner {
        liquidationThresholdBps = bps;
    }

    /// @notice Test/canary hook to simulate price drops.
    function setPrice(uint256 priceWei_) external onlyOwner {
        priceWei = priceWei_;
        emit PriceUpdated(priceWei_);
    }

    function supply(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        supplyBalance[msg.sender] += amount;
        totalSupply += amount;
        emit Supplied(msg.sender, amount);
    }

    function borrow(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        borrowBalance[msg.sender] += amount;
        if (_collateralRatioBps(msg.sender) < liquidationThresholdBps) {
            borrowBalance[msg.sender] -= amount;
            revert InsufficientCollateral();
        }
        if (asset.balanceOf(address(this)) < amount) revert InsufficientLiquidity();
        totalBorrow += amount;
        asset.safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 debt = borrowBalance[msg.sender];
        uint256 pay = amount > debt ? debt : amount;
        asset.safeTransferFrom(msg.sender, address(this), pay);
        borrowBalance[msg.sender] = debt - pay;
        totalBorrow -= pay;
        emit Repaid(msg.sender, pay);
    }

    /// @notice Collateral ratio in bps: (supplyValue * 10000) / borrowValue. Max if no debt.
    function getCollateralRatioBps(address user) external view returns (uint256) {
        return _collateralRatioBps(user);
    }

    /// @notice Kinetic-shaped liquidity view: (liquidity shortfall semantics simplified).
    /// @return liquidity Excess collateral value in asset units (0 if underwater).
    /// @return shortfall Deficit in asset units (0 if healthy).
    function getAccountLiquidity(address user) external view returns (uint256 liquidity, uint256 shortfall) {
        uint256 supplyVal = (supplyBalance[user] * priceWei) / 1e18;
        uint256 borrowVal = (borrowBalance[user] * priceWei) / 1e18;
        uint256 maxBorrow = (supplyVal * collateralFactorBps) / 10000;
        if (maxBorrow >= borrowVal) {
            liquidity = ((maxBorrow - borrowVal) * 1e18) / priceWei;
            shortfall = 0;
        } else {
            liquidity = 0;
            shortfall = ((borrowVal - maxBorrow) * 1e18) / priceWei;
        }
    }

    function isLiquidatable(address user) public view returns (bool) {
        if (borrowBalance[user] == 0) return false;
        return _collateralRatioBps(user) < liquidationThresholdBps;
    }

    function liquidate(address user, uint256 repayAmount) external nonReentrant {
        if (!isLiquidatable(user)) revert HealthyPosition();
        uint256 debt = borrowBalance[user];
        uint256 pay = repayAmount > debt ? debt : repayAmount;
        asset.safeTransferFrom(msg.sender, address(this), pay);
        borrowBalance[user] = debt - pay;
        totalBorrow -= pay;
        uint256 seize = pay;
        uint256 supplied = supplyBalance[user];
        if (seize > supplied) seize = supplied;
        supplyBalance[user] = supplied - seize;
        totalSupply -= seize;
        asset.safeTransfer(msg.sender, seize);
        emit Liquidated(user, pay, seize);
    }

    function _collateralRatioBps(address user) internal view returns (uint256) {
        uint256 debt = borrowBalance[user];
        if (debt == 0) return type(uint256).max;
        // Price applies to collateral only (debt fixed in asset units) so oracle drops can liquidate.
        uint256 supplyVal = (supplyBalance[user] * priceWei) / 1e18;
        return (supplyVal * 10000) / debt;
    }
}
