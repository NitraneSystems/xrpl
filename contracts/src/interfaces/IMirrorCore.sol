// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IMirrorVault {
    struct Settlement {
        address follower;
        address lead;
        int256 balanceDelta;
        uint256 nonce;
    }

    function settleBatch(Settlement[] calldata settlements) external;
}

interface IMirrorFee {
    function accrueFee(
        address lead,
        address follower,
        uint256 profit,
        uint256 epochId
    ) external;
}
