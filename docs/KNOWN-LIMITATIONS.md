# Known Limitations on Testnet

This document lists venues and features explicitly deferred or mocked on Coston2 (chain ID 114), per [phaseImplementation.md](./phaseImplementation.md).

## Deferred / Mocked (not real on Coston2 for MVP)

| Venue / Feature | Status | Reason |
|-----------------|--------|--------|
| **SparkDEX spot V3** | Mocked (Phase 4A) | `SwapRouter`, `V3Factory`, FXRP/USDT0 pool have no bytecode on Coston2. Deployed `MockSparkDexRouter` on Coston2: `0x6F3A431c74Ef7Ff30ed93569D4e8A43466E7F9e1` (fills at live FTSO prices). |
| **BlazeSwap FXRP/USDT0** | Self-seeded test liquidity (Phase 4B) | Pair `0xa0B211953a3d8f42E82AfB01303933DdA5c434fe` created/funded by `scripts/venues/seed-blazeswap-pool.ts`. This is **not** third-party depth — the deployer is the LP. BlazeSwap `addLiquidity` uses extra `feeBipsA/feeBipsB` args (not Uniswap V2). Default `EXECUTION_VENUE` remains `mock-sparkdex`. |
| **AI agent TEE-to-TEE channel** | Stub (Phase 6) | Matching engine `GET /internal/outcome-log` gated by `TEE_INTERNAL_TOKEN`. Full enclave-to-enclave channel deferred until both FCEs run under live FCC. |
| **Web2Json dual-attestation canary** | Derived 2nd id | `ai:score-canary` uses one live Web2Json DA proof; lead2 `attestationId = keccak256(attBase, lead)`. Second full FDC round optional for demos. |
| **FSA XRPL path** | Live (Phase 8) | `MasterAccountController` + FDC Payment + `MirrorFsaOnboarder`. Combined Core Vault `0xFE` mint+onboard needs mint liquidity; canary covers FDC Payment + onboarder. Operator: `rEyj8nsHLdgt79KJWzXR5BgF7ZbaohbXwq`. |
| **Kinetic** | Mocked (Phase 9) | `MockKineticPool` `0x6ce64f1F6D60198281a4eA0aA639cAA10202554A` — stand-in until Kinetic Coston2 addresses verified |
| **Drift thresholds** | Configurable | `DRIFT_CONFIDENCE_THRESHOLD` default 0.55; `LIQUIDATION_ALERT_BPS` default 13000 (alert before mock liquidate at 11000) |
| **Enosys** | Mocked (Phase 10) | No usable Coston2 deployment (Enosys tests on Coston/Songbird). Deployed `MockEnosysCDP` `0xB2f32371D761F52895E697C8b2910098cf57FA60`. Routed when `MIRROR_MOCK_VENUES=true`. Demo CR params are **not** real Enosys risk. |
| **Firelight (passive staking)** | Mocked for MVP (Phase 10) | Real vault exists on Coston2 (`0xC90D6847747b85d1fa2E07859869fb9fB72c0361` = `firelightVaultReal`) but passive-staking UX is out of MVP. MVP router uses `MockFirelightStrategy` `0xa652DFD628be13feC4D56710D1cf281692deCE02`. |
| **FBTC market** | Unconfirmed | Not verified on Coston2 |
| **Flare mainnet SparkDEX spot** | Deferred | Real execution on chain ID 14 only. Hub guide / mainnet `SwapRouter` `0x8a1E35F5c98C4E85B36B7B253222eE17773b2781` — do **not** point Coston2 configs at these. |
| **Songbird canary FCC** | Deferred | Out of MVP scope |
| **FCC tooling** | Bleeding-edge | Extension SDKs, compose images, and registry helpers may shift; pin versions used in canaries and re-verify after FCC upgrades. |
| **Live FCC extension registration** | Operator step | Matching-engine / AI-agent FCEs are developed & canaried locally (`fce:smoke`, `fce:compare-hashes` → `config/fce-code-hashes.json`). Publishing queryable on-chain code hashes requires `docker compose` register against TeeExtensionRegistry on Coston2 — run when FCC images are available; not auto-done by app deploys. |
| **PMW executable batch signing** | Partial | Stage B assembles venue calldata `{to,data,venue}`; full TEE-resident PMW signing of the settlement tx depends on live tee-node `SIGN_PORT` in the FCC stack. |
| **Vault settleBatch** | Gated (Phase 5) | Default `legacySettleBatchEnabled=false` — proof-free settleBatch reverts; use `settleFromProof` / `applyFdcSettlement`. |

## Real on Coston2 (used or planned)

- FTSO v2, FDC, FAssets/FXRP, Flare Smart Accounts, FCC/FCE
- Firelight vault (`0xC90D6847747b85d1fa2E07859869fb9fB72c0361`) — real address reserved; MVP staking deferred
- BlazeSwap factory/router — deployed; insufficient FXRP/USDT0 liquidity for copy-trading fills without self-seed

## Phase 11 packaging scripts

| Script | Purpose |
|--------|---------|
| `npm run e2e:load-followers` | 1 lead + 5 followers Stage B fan-out |
| `npm run e2e:adversarial-plaintext` | Ciphertext-only public surfaces (prod path; no plaintext-fallback smoke) |
| `npm run demo:lifecycle` | One-command lifecycle demo (`DEMO_SKIP_SLOW_FDC=1` optional) |
| `npm run tee:proxy` | Phase 3 operator proxy to matching-engine FCE |
| `npm run ai:drift-monitor` / `ai:health-monitor` | Continuous Phase 9 loops (`DRIFT_MONITOR_CYCLES=3` for smoke) |
| `npm run fce:compare-hashes` | Rebuild-twice + ME≠AI digests → `config/fce-code-hashes.json` |

Bounty mapping: [SUBMISSION.md](./SUBMISSION.md).

## Remaining operator checklist (not auto-closed by code)

1. Fund all personas (faucet) until `npm run smoke` shows non-zero C2FLR.
2. Register FCEs on Coston2 TeeExtensionRegistry; record extension IDs next to `config/fce-code-hashes.json`.
3. Run full `npm run fdc:cycle` (10 live rounds) outside PR CI and keep the console log for submission.
4. Independent reviewer re-runs `e2e:adversarial-plaintext`.

## Verification method

Venue state verified via `eth_getCode` / `eth_call` against Coston2 RPC (`https://coston2-api.flare.network/ext/C/rpc`), August 2026 — not docs alone. See Appendix A in phaseImplementation.md.
