// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IPriceSource} from "../interfaces/IPriceSource.sol";

/// @notice Injectable FTSO stand-in for Hardhat tests of MockSparkDexRouter.
contract MockPriceSource is IPriceSource {
    uint256 public fxrpUsdWei = 2e18; // $2
    uint256 public usdt0UsdWei = 1e18; // $1
    uint64 public fxrpTs;
    uint64 public usdt0Ts;

    function setPrices(uint256 fxrpUsdWei_, uint256 usdt0UsdWei_, uint64 ts) external {
        fxrpUsdWei = fxrpUsdWei_;
        usdt0UsdWei = usdt0UsdWei_;
        fxrpTs = ts;
        usdt0Ts = ts;
    }

    function getFxrpUsdInWei() external view returns (uint256 valueWei, uint64 timestamp) {
        return (fxrpUsdWei, fxrpTs == 0 ? uint64(block.timestamp) : fxrpTs);
    }

    function getUsdt0UsdInWei() external view returns (uint256 valueWei, uint64 timestamp) {
        return (usdt0UsdWei, usdt0Ts == 0 ? uint64(block.timestamp) : usdt0Ts);
    }
}
