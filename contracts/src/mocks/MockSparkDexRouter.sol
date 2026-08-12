// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISwapRouter} from "../interfaces/ISwapRouter.sol";
import {IPriceSource} from "../interfaces/IPriceSource.sol";
import {AnchorDivergenceGuard} from "../AnchorDivergenceGuard.sol";

/**
 * @title MockSparkDexRouter
 * @notice FTSO-priced stand-in for SparkDEX V3 SwapRouter on Coston2.
 * Interface-compatible with Uniswap V3 `exactInputSingle` / `exactOutputSingle` (struct form).
 */
contract MockSparkDexRouter is ISwapRouter, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error DeadlineExpired();
    error InsufficientOutput();
    error ExcessiveInput();
    error UnsupportedPair();
    error ZeroAmount();

    event Swap(
        address indexed sender,
        address indexed recipient,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    uint24 public constant POOL_FEE = 500;
    uint64 public constant ANCHOR_INTERVAL = 90;

    IERC20 public immutable fxrp;
    IERC20 public immutable usdt0;
    IPriceSource public immutable priceSource;
    AnchorDivergenceGuard public immutable divergenceGuard;

    uint256 public lastAnchorFxrpWei;
    uint256 public lastAnchorUsdt0Wei;
    uint64 public lastAnchorTimestamp;

    constructor(
        address fxrp_,
        address usdt0_,
        address priceSource_,
        address divergenceGuard_,
        address initialOwner
    ) Ownable(initialOwner) {
        fxrp = IERC20(fxrp_);
        usdt0 = IERC20(usdt0_);
        priceSource = IPriceSource(priceSource_);
        divergenceGuard = AnchorDivergenceGuard(divergenceGuard_);
    }

    function setAnchorSnapshot(uint256 fxrpWei, uint256 usdt0Wei, uint64 ts) external onlyOwner {
        lastAnchorFxrpWei = fxrpWei;
        lastAnchorUsdt0Wei = usdt0Wei;
        lastAnchorTimestamp = ts;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        nonReentrant
        returns (uint256 amountOut)
    {
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        if (params.amountIn == 0) revert ZeroAmount();

        amountOut = _quoteAndGuard(params.tokenIn, params.tokenOut, params.amountIn);
        if (amountOut < params.amountOutMinimum) revert InsufficientOutput();

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);

        emit Swap(msg.sender, params.recipient, params.tokenIn, params.tokenOut, params.amountIn, amountOut);
    }

    function exactOutputSingle(ExactOutputSingleParams calldata params)
        external
        payable
        override
        nonReentrant
        returns (uint256 amountIn)
    {
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        if (params.amountOut == 0) revert ZeroAmount();

        amountIn = _quoteOutAndGuard(params.tokenIn, params.tokenOut, params.amountOut);
        if (amountIn > params.amountInMaximum) revert ExcessiveInput();

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(params.tokenOut).safeTransfer(params.recipient, params.amountOut);

        emit Swap(msg.sender, params.recipient, params.tokenIn, params.tokenOut, amountIn, params.amountOut);
    }

    function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn)
        public
        view
        returns (uint256 amountOut)
    {
        (uint256 priceIn, uint256 priceOut) = _spotPrices(tokenIn, tokenOut);
        amountOut = (amountIn * priceIn) / priceOut;
    }

    function quoteExactOutput(address tokenIn, address tokenOut, uint256 amountOut)
        public
        view
        returns (uint256 amountIn)
    {
        (uint256 priceIn, uint256 priceOut) = _spotPrices(tokenIn, tokenOut);
        amountIn = (amountOut * priceOut) / priceIn;
        if (amountIn == 0) revert ZeroAmount();
    }

    function _quoteAndGuard(address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256) {
        (uint256 priceIn, uint256 priceOut) = _spotAndGuard(tokenIn, tokenOut, amountIn);
        return (amountIn * priceIn) / priceOut;
    }

    function _quoteOutAndGuard(address tokenIn, address tokenOut, uint256 amountOut) internal returns (uint256) {
        (uint256 priceIn, uint256 priceOut) = _spotAndGuard(tokenIn, tokenOut, amountOut);
        uint256 amountIn = (amountOut * priceOut) / priceIn;
        if (amountIn == 0) revert ZeroAmount();
        return amountIn;
    }

    function _spotPrices(address tokenIn, address tokenOut) internal view returns (uint256 priceIn, uint256 priceOut) {
        (uint256 fxrpUsd,) = priceSource.getFxrpUsdInWei();
        (uint256 usdt0Usd,) = priceSource.getUsdt0UsdInWei();
        bool inFxrp = tokenIn == address(fxrp);
        bool outFxrp = tokenOut == address(fxrp);
        bool inUsdt = tokenIn == address(usdt0);
        bool outUsdt = tokenOut == address(usdt0);
        if (!((inFxrp && outUsdt) || (inUsdt && outFxrp))) revert UnsupportedPair();
        priceIn = inFxrp ? fxrpUsd : usdt0Usd;
        priceOut = outFxrp ? fxrpUsd : usdt0Usd;
    }

    function _spotAndGuard(address tokenIn, address tokenOut, uint256 amount)
        internal
        returns (uint256 priceIn, uint256 priceOut)
    {
        (uint256 fxrpUsd, uint64 fxrpTs) = priceSource.getFxrpUsdInWei();
        (uint256 usdt0Usd, uint64 usdt0Ts) = priceSource.getUsdt0UsdInWei();
        uint64 ts = fxrpTs < usdt0Ts ? fxrpTs : usdt0Ts;

        if (lastAnchorTimestamp == 0) {
            lastAnchorFxrpWei = fxrpUsd;
            lastAnchorUsdt0Wei = usdt0Usd;
            lastAnchorTimestamp = ts;
        }

        (priceIn, priceOut) = _spotPrices(tokenIn, tokenOut);
        bool inFxrp = tokenIn == address(fxrp);
        uint256 anchorIn = inFxrp ? lastAnchorFxrpWei : lastAnchorUsdt0Wei;
        uint256 notionalUsdWei = (amount * priceIn) / 1e18;
        divergenceGuard.checkDivergence(priceIn, anchorIn, notionalUsdWei);

        if (ts >= lastAnchorTimestamp + ANCHOR_INTERVAL) {
            lastAnchorFxrpWei = fxrpUsd;
            lastAnchorUsdt0Wei = usdt0Usd;
            lastAnchorTimestamp = ts;
        }
    }
}
