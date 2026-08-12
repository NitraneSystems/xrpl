# Execution venues (Coston2)

Primary path is `MockSparkDexRouter` (`executionVenue: "mock-sparkdex"`). SparkDEX V3 has no bytecode on chain ID 114.

```bash
npm run deploy:venue          # MockSparkDexRouter + rewired Vault/Fee/InstructionSender
npm run venues:swap-loop      # 21 FTSO-priced swaps against the mock
npm run venues:seed-blazeswap # Phase 4B: self-seeded USDT0/FXRP test liquidity + one V2 swap
```

BlazeSwap liquidity created by `seed-blazeswap-pool.ts` is **self-seeded test liquidity**, not third-party depth.
