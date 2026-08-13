export const STRATEGY_LABELS = ["momentum", "mean-reversion", "yield-arb"] as const;
export const RISK_LABELS = ["conservative", "moderate", "aggressive"] as const;
export const FXRP_DECIMALS = 6;

export const config = {
  chainId: 114,
  rpcUrl: process.env.NEXT_PUBLIC_FLARE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc",
  registry: (process.env.NEXT_PUBLIC_MIRROR_REGISTRY_ADDRESS ??
    "0xfF4f9a603ebd126Db2BEc88A88a0fae6B2fB8065") as `0x${string}`,
  vault: (process.env.NEXT_PUBLIC_MIRROR_VAULT_ADDRESS ??
    "0x283aA87660cB02D1ffcEDd028B401766C076BdB4") as `0x${string}`,
  fee: (process.env.NEXT_PUBLIC_MIRROR_FEE_ADDRESS ??
    "0x8941c5ecA5Be7509Adf77e73A69187454Fcf1dEC") as `0x${string}`,
  leaderboard: (process.env.NEXT_PUBLIC_MIRROR_LEADERBOARD_ADDRESS ??
    "0x9cBcDf16521b3705687349278990015886c957c9") as `0x${string}`,
  instructionSender: (process.env.NEXT_PUBLIC_INSTRUCTION_SENDER_ADDRESS ??
    "0xf082D53B50D08f0fdC06B0B4C6A1932DB589d91f") as `0x${string}`,
  fsaOnboarder: (process.env.NEXT_PUBLIC_MIRROR_FSA_ONBOARDER ??
    "0x899921CB2d74B45BDC95baC8b8675757dE952671") as `0x${string}`,
  healthAuth: (process.env.NEXT_PUBLIC_MIRROR_HEALTH_AUTH ??
    "0xe7eBb372Ef34119874f55d2132e1f3F651e23612") as `0x${string}`,
  mockKinetic: (process.env.NEXT_PUBLIC_MOCK_KINETIC_POOL ??
    "0x6ce64f1F6D60198281a4eA0aA639cAA10202554A") as `0x${string}`,
  masterAccountController: (process.env.NEXT_PUBLIC_MASTER_ACCOUNT_CONTROLLER ??
    "0x434936d47503353f06750Db1A444DBDC5F0AD37c") as `0x${string}`,
  fxrp: (process.env.NEXT_PUBLIC_FXRP_ADDRESS ??
    "0x0b6A3645c240605887a5532109323A3E12273dc7") as `0x${string}`,
  teeEncryptPubKey: process.env.NEXT_PUBLIC_TEE_ENCRYPT_PUBKEY ?? "",
  xrplOperator: process.env.NEXT_PUBLIC_XRPL_OPERATOR_ADDRESS ?? "rEyj8nsHLdgt79KJWzXR5BgF7ZbaohbXwq",
  monitorUrl: (process.env.NEXT_PUBLIC_XRPL_MONITOR_URL ?? "").replace(/\/$/, ""),
  matchingEngineUrl: (process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL ?? "").replace(/\/$/, ""),
  alertsUrl: process.env.NEXT_PUBLIC_MIRROR_ALERTS_URL ?? "/api/alerts",
};
