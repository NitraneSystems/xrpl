// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * Anchor divergence guard helper.
 *
 * For positions above a configured notional, we compare a block-latency price
 * vs an anchor price (both expressed in the same "inWei" scale) and revert if
 * their relative divergence exceeds a max tolerance.
 */
contract AnchorDivergenceGuard {
    error DivergenceExceeded(uint256 blockPriceWei, uint256 anchorPriceWei);
    error InvalidAnchorPrice();

    // Compare divergence above this notional only.
    uint256 public immutable notionalThresholdWei;
    // Divergence tolerance in basis points (1 bps = 0.01%).
    uint256 public immutable maxDivergenceBps;

    constructor(uint256 _notionalThresholdWei, uint256 _maxDivergenceBps) {
        notionalThresholdWei = _notionalThresholdWei;
        maxDivergenceBps = _maxDivergenceBps;
    }

    /**
     * @dev Reverts if divergence > maxDivergenceBps.
     * @param blockPriceWei Block-latency feed price, already normalized to "inWei".
     * @param anchorPriceWei Anchor feed price, already normalized to "inWei".
     * @param notionalWei Position notional, already normalized to "inWei" scale.
     */
    function checkDivergence(
        uint256 blockPriceWei,
        uint256 anchorPriceWei,
        uint256 notionalWei
    ) external view {
        if (notionalWei < notionalThresholdWei) return;
        if (anchorPriceWei == 0) revert InvalidAnchorPrice();

        uint256 diff = blockPriceWei >= anchorPriceWei
            ? blockPriceWei - anchorPriceWei
            : anchorPriceWei - blockPriceWei;

        // divergenceBps = diff / anchorPriceWei * 10_000
        uint256 divergenceBps = (diff * 10_000) / anchorPriceWei;
        if (divergenceBps > maxDivergenceBps) {
            revert DivergenceExceeded(blockPriceWei, anchorPriceWei);
        }
    }
}

