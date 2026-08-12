// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IEVMTransaction} from "@flarenetwork/flare-periphery-contracts/coston2/IEVMTransaction.sol";

/// @notice Test double for IFdcVerification.verifyEVMTransaction.
contract MockFdcVerification {
    bool public shouldProve = true;

    function setShouldProve(bool v) external {
        shouldProve = v;
    }

    function verifyEVMTransaction(IEVMTransaction.Proof calldata) external view returns (bool) {
        return shouldProve;
    }
}
