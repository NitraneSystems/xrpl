// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MirrorRegistry
/// @notice Lead and follower registration with strategy metadata.
contract MirrorRegistry is Ownable {
    struct LeadTrader {
        address wallet;
        uint8 strategyType;
        uint16 feeRateBps;
        uint256 minAllocation;
        bytes32 teePublicKeyHash;
        bool verified;
    }

    struct FollowerProfile {
        address wallet;
        uint8 riskProfile;
        bool registered;
    }

    struct FollowAllocation {
        address lead;
        uint256 allocation;
        bool active;
    }

    error AlreadyRegisteredLead();
    error AlreadyRegisteredFollower();
    error NotRegisteredLead();
    error NotRegisteredFollower();
    error InvalidFeeRate();
    error AllocationBelowMinimum();
    error AlreadyFollowing();
    error NotFollowing();
    error InvalidLead();

    event LeadRegistered(
        address indexed wallet,
        uint8 strategyType,
        uint16 feeRateBps,
        uint256 minAllocation,
        bytes32 teePublicKeyHash
    );
    event FollowerRegistered(address indexed wallet, uint8 riskProfile);
    event LeadFollowed(address indexed follower, address indexed lead, uint256 allocation);
    event LeadUnfollowed(address indexed follower, address indexed lead);
    event LeadVerified(address indexed lead, bool verified);

    mapping(address => LeadTrader) public leads;
    mapping(address => FollowerProfile) public followers;
    mapping(address => mapping(address => FollowAllocation)) public followAllocations;
    mapping(address => address[]) private _followerLeads;
    mapping(address => address[]) private _leadFollowers;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function registerLead(
        uint8 strategyType,
        uint16 feeRateBps,
        uint256 minAllocation,
        bytes32 teePublicKeyHash
    ) external {
        if (leads[msg.sender].wallet != address(0)) revert AlreadyRegisteredLead();
        if (feeRateBps > 2000) revert InvalidFeeRate();

        leads[msg.sender] = LeadTrader({
            wallet: msg.sender,
            strategyType: strategyType,
            feeRateBps: feeRateBps,
            minAllocation: minAllocation,
            teePublicKeyHash: teePublicKeyHash,
            verified: false
        });

        emit LeadRegistered(msg.sender, strategyType, feeRateBps, minAllocation, teePublicKeyHash);
    }

    function registerFollower(uint8 riskProfile) external {
        if (followers[msg.sender].registered) revert AlreadyRegisteredFollower();

        followers[msg.sender] = FollowerProfile({
            wallet: msg.sender,
            riskProfile: riskProfile,
            registered: true
        });

        emit FollowerRegistered(msg.sender, riskProfile);
    }

    function followLead(address lead, uint256 allocation) external {
        FollowerProfile storage follower = followers[msg.sender];
        if (!follower.registered) revert NotRegisteredFollower();

        LeadTrader storage leadTrader = leads[lead];
        if (leadTrader.wallet == address(0)) revert InvalidLead();
        if (allocation < leadTrader.minAllocation) revert AllocationBelowMinimum();

        FollowAllocation storage existing = followAllocations[msg.sender][lead];
        if (existing.active) revert AlreadyFollowing();

        followAllocations[msg.sender][lead] = FollowAllocation({
            lead: lead,
            allocation: allocation,
            active: true
        });

        _followerLeads[msg.sender].push(lead);
        _leadFollowers[lead].push(msg.sender);

        emit LeadFollowed(msg.sender, lead, allocation);
    }

    function unfollowLead(address lead) external {
        FollowAllocation storage allocation = followAllocations[msg.sender][lead];
        if (!allocation.active) revert NotFollowing();

        allocation.active = false;
        allocation.allocation = 0;

        emit LeadUnfollowed(msg.sender, lead);
    }

    function setLeadVerified(address lead, bool verified) external onlyOwner {
        if (leads[lead].wallet == address(0)) revert InvalidLead();
        leads[lead].verified = verified;
        emit LeadVerified(lead, verified);
    }

    function getLead(address wallet) external view returns (LeadTrader memory) {
        return leads[wallet];
    }

    function getFollower(address wallet) external view returns (FollowerProfile memory) {
        return followers[wallet];
    }

    function getFollowAllocation(address follower, address lead)
        external
        view
        returns (FollowAllocation memory)
    {
        return followAllocations[follower][lead];
    }

    function getFollowedLeads(address follower) external view returns (address[] memory) {
        return _followerLeads[follower];
    }

    function getFollowers(address lead) external view returns (address[] memory) {
        return _leadFollowers[lead];
    }
}
