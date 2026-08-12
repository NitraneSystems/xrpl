// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IPriceSource {
    function getFxrpUsdInWei() external view returns (uint256 valueWei, uint64 timestamp);
    function getUsdt0UsdInWei() external view returns (uint256 valueWei, uint64 timestamp);
}
