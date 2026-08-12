// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ContractRegistry } from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import { TestFtsoV2Interface } from "@flarenetwork/flare-periphery-contracts/coston2/TestFtsoV2Interface.sol";
import { IPriceSource } from "./interfaces/IPriceSource.sol";

/**
 * Thin wrapper around Flare's TestFtsoV2Interface for MVP price readability.
 *
 * Notes:
 * - We intentionally use `TestFtsoV2Interface` because it exposes view methods
 *   suitable for on-chain read-only consumption patterns.
 * - Feed IDs are hardcoded only after sourcing them from the official feed list.
 */
contract FtsoPriceReader is IPriceSource {
    // "XRP/USD" feed id from dev.flare.network/ftso/feeds. We use this as the proxy for "FXRP/USD".
    bytes21 public constant FXRP_USD_FEED_ID = 0x015852502f55534400000000000000000000000000;
    // "USDT/USD" feed id from dev.flare.network/ftso/feeds. We use this as the proxy for "USDT0/USD".
    bytes21 public constant USDT0_USD_FEED_ID = 0x01555344542f555344000000000000000000000000;

    function getFxrpUsdInWei()
        external
        view
        override
        returns (uint256 valueWei, uint64 timestamp)
    {
        TestFtsoV2Interface ftsoV2 = ContractRegistry.getTestFtsoV2();
        (valueWei, timestamp) = ftsoV2.getFeedByIdInWei(FXRP_USD_FEED_ID);
    }

    function getUsdt0UsdInWei()
        external
        view
        override
        returns (uint256 valueWei, uint64 timestamp)
    {
        TestFtsoV2Interface ftsoV2 = ContractRegistry.getTestFtsoV2();
        (valueWei, timestamp) = ftsoV2.getFeedByIdInWei(USDT0_USD_FEED_ID);
    }
}

