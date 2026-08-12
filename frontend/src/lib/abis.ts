export const leaderboardAbi = [
  {
    type: "function",
    name: "getRankedLeads",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "getScore",
    stateMutability: "view",
    inputs: [{ name: "lead", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "score", type: "uint8" },
          { name: "attestationId", type: "bytes32" },
          { name: "updatedAt", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export const registryAbi = [
  {
    type: "function",
    name: "registerLead",
    stateMutability: "nonpayable",
    inputs: [
      { name: "strategyType", type: "uint8" },
      { name: "feeRateBps", type: "uint16" },
      { name: "minAllocation", type: "uint256" },
      { name: "teePublicKeyHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "registerFollower",
    stateMutability: "nonpayable",
    inputs: [{ name: "riskProfile", type: "uint8" }],
    outputs: [],
  },
  {
    type: "function",
    name: "followLead",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lead", type: "address" },
      { name: "allocation", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getLead",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "wallet", type: "address" },
          { name: "strategyType", type: "uint8" },
          { name: "feeRateBps", type: "uint16" },
          { name: "minAllocation", type: "uint256" },
          { name: "teePublicKeyHash", type: "bytes32" },
          { name: "verified", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getFollower",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "wallet", type: "address" },
          { name: "riskProfile", type: "uint8" },
          { name: "registered", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getFollowedLeads",
    stateMutability: "view",
    inputs: [{ name: "follower", type: "address" }],
    outputs: [{ type: "address[]" }],
  },
] as const;

export const vaultAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lead", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "requestWithdrawal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "lead", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getBalance",
    stateMutability: "view",
    inputs: [
      { name: "follower", type: "address" },
      { name: "lead", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getPendingWithdrawal",
    stateMutability: "view",
    inputs: [
      { name: "follower", type: "address" },
      { name: "lead", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const instructionSenderAbi = [
  {
    type: "function",
    name: "sendMirrorMatchStageB",
    stateMutability: "payable",
    inputs: [{ name: "encryptedSignal", type: "bytes" }],
    outputs: [{ name: "instructionId", type: "bytes32" }],
  },
] as const;
