// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockFXRP
/// @notice Test ERC-20 stand-in for FXRP in local Hardhat tests.
contract MockFXRP is ERC20 {
    constructor() ERC20("Mock FXRP", "mFXRP") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
