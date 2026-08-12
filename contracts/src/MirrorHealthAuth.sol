// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MirrorHealthAuth
/// @notice Pre-authorization for autonomous collateral top-ups (Phase 9).
contract MirrorHealthAuth is Ownable {
    error ZeroAddress();

    event TopUpAuthorized(address indexed follower, address indexed lead, uint256 maxTopUp, bool enabled);
    event HealthMonitorUpdated(address indexed previous, address indexed next);

    address public healthMonitor;

    struct Auth {
        uint256 maxTopUp;
        bool enabled;
    }

    mapping(address => mapping(address => Auth)) public authorizations;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setHealthMonitor(address monitor) external onlyOwner {
        address previous = healthMonitor;
        healthMonitor = monitor;
        emit HealthMonitorUpdated(previous, monitor);
    }

    /// @notice Follower opts in to pre-authorized top-ups for a lead position.
    function preAuthorizeTopUp(address lead, uint256 maxTopUp, bool enabled) external {
        if (lead == address(0)) revert ZeroAddress();
        authorizations[msg.sender][lead] = Auth({maxTopUp: maxTopUp, enabled: enabled});
        emit TopUpAuthorized(msg.sender, lead, maxTopUp, enabled);
    }

    function getAuth(address follower, address lead) external view returns (Auth memory) {
        return authorizations[follower][lead];
    }

    function isAuthorized(address follower, address lead, uint256 amount) external view returns (bool) {
        Auth memory a = authorizations[follower][lead];
        return a.enabled && amount > 0 && amount <= a.maxTopUp;
    }
}
