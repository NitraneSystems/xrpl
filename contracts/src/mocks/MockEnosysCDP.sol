// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MockEnosysCDP
 * @notice Minimal Enosys-Loans-shaped CDP stand-in for Coston2.
 *
 * This is a stand-in for Enosys, which has no usable Coston2 deployment as of this build.
 * Real Enosys tests on Coston (Songbird testnet), a different chain. Replace with the real
 * integration once Enosys ships Coston2 parity or Mirror moves to mainnet.
 *
 * NON-GOAL: parameters and liquidation math here are NOT representative of real Enosys risk.
 */
contract MockEnosysCDP is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error InsufficientCollateral();
    error NoPosition();
    error DebtOutstanding();

    event CdpOpened(address indexed user, uint256 collateral, uint256 debt);
    event CollateralAdjusted(address indexed user, uint256 collateral, uint256 debt);
    event StableMinted(address indexed user, uint256 amount);
    event StableRepaid(address indexed user, uint256 amount);
    event PriceUpdated(uint256 priceWei);

    IERC20 public immutable collateralToken;
    /// @notice Mock stablecoin balance credited on mint (internal accounting; no separate ERC20 required).
    mapping(address => uint256) public stableBalance;
    mapping(address => uint256) public collateralOf;
    mapping(address => uint256) public debtOf;

    uint256 public liquidationThresholdBps = 15000; // 1.5x — DEMO ONLY, not Enosys params
    uint256 public priceWei = 1e18;

    constructor(address collateralToken_, address initialOwner) Ownable(initialOwner) {
        collateralToken = IERC20(collateralToken_);
    }

    function setPrice(uint256 priceWei_) external onlyOwner {
        priceWei = priceWei_;
        emit PriceUpdated(priceWei_);
    }

    function setLiquidationThresholdBps(uint256 bps) external onlyOwner {
        liquidationThresholdBps = bps;
    }

    /// @notice Open or top-up a CDP and optionally mint stable against FXRP collateral.
    function openCdp(uint256 collateralAmount, uint256 mintAmount) external nonReentrant {
        if (collateralAmount == 0 && mintAmount == 0) revert ZeroAmount();
        if (collateralAmount > 0) {
            collateralToken.safeTransferFrom(msg.sender, address(this), collateralAmount);
            collateralOf[msg.sender] += collateralAmount;
        }
        if (mintAmount > 0) {
            debtOf[msg.sender] += mintAmount;
            if (_collateralRatioBps(msg.sender) < liquidationThresholdBps) {
                debtOf[msg.sender] -= mintAmount;
                revert InsufficientCollateral();
            }
            stableBalance[msg.sender] += mintAmount;
            emit StableMinted(msg.sender, mintAmount);
        }
        emit CdpOpened(msg.sender, collateralOf[msg.sender], debtOf[msg.sender]);
    }

    function adjustCollateral(uint256 addAmount, uint256 removeAmount) external nonReentrant {
        if (addAmount > 0) {
            collateralToken.safeTransferFrom(msg.sender, address(this), addAmount);
            collateralOf[msg.sender] += addAmount;
        }
        if (removeAmount > 0) {
            if (collateralOf[msg.sender] < removeAmount) revert InsufficientCollateral();
            collateralOf[msg.sender] -= removeAmount;
            if (debtOf[msg.sender] > 0 && _collateralRatioBps(msg.sender) < liquidationThresholdBps) {
                collateralOf[msg.sender] += removeAmount;
                revert InsufficientCollateral();
            }
            collateralToken.safeTransfer(msg.sender, removeAmount);
        }
        emit CollateralAdjusted(msg.sender, collateralOf[msg.sender], debtOf[msg.sender]);
    }

    function mintStable(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (collateralOf[msg.sender] == 0) revert NoPosition();
        debtOf[msg.sender] += amount;
        if (_collateralRatioBps(msg.sender) < liquidationThresholdBps) {
            debtOf[msg.sender] -= amount;
            revert InsufficientCollateral();
        }
        stableBalance[msg.sender] += amount;
        emit StableMinted(msg.sender, amount);
    }

    function repayStable(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 debt = debtOf[msg.sender];
        uint256 pay = amount > debt ? debt : amount;
        uint256 bal = stableBalance[msg.sender];
        if (bal < pay) revert InsufficientCollateral();
        stableBalance[msg.sender] = bal - pay;
        debtOf[msg.sender] = debt - pay;
        emit StableRepaid(msg.sender, pay);
    }

    function closeCdp() external nonReentrant {
        if (debtOf[msg.sender] != 0) revert DebtOutstanding();
        uint256 col = collateralOf[msg.sender];
        collateralOf[msg.sender] = 0;
        if (col > 0) collateralToken.safeTransfer(msg.sender, col);
    }

    function getCollateralRatio(address user) external view returns (uint256) {
        return _collateralRatioBps(user);
    }

    function _collateralRatioBps(address user) internal view returns (uint256) {
        uint256 debt = debtOf[user];
        if (debt == 0) return type(uint256).max;
        uint256 colVal = (collateralOf[user] * priceWei) / 1e18;
        return (colVal * 10000) / debt;
    }
}
