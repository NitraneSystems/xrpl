# Mirror — Phase-Wise Testnet Implementation Plan

**Target network:** Flare Testnet Coston2 (chain ID 114) for everything except XRPL-side Smart Account flows, which target **XRPL Testnet**.

**Ground rule set by the feasibility research (verified by direct `eth_getCode`/`eth_call`/`getPool` checks against Coston2 RPC `https://coston2-api.flare.network/ext/C/rpc` and Flare mainnet RPC `https://flare-api.flare.network/ext/C/rpc`, August 2026 — not just docs):**

- **Real on Coston2, build for real:** FTSO v2, FDC, FAssets/FXRP, Flare Smart Accounts, FCC/FCE (bleeding-edge but genuinely Coston2-targeted), and — corrected from an earlier pass — **Firelight**. Flare's own dev hub publishes a live Firelight vault address on Coston2 (`0xC90D6847747b85d1fa2E07859869fb9fB72c0361`); an outdated third-party doc had claimed otherwise. **Upshift** (an FXRP yield vault not in the original PRD) is also confirmed real on Coston2 and available as an optional addition.
- **Deployed on Coston2 but unusable for Mirror's FXRP/USDT0 MVP without self-seeding:**
  - **SparkDEX spot swap (V2/V3.1 DEX):** SparkDEX's published `SwapRouter` (`0x8a1E35F5c98C4E85B36B7B253222eE17773b2781`), `V3Factory` (`0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652`), `UniversalRouter`, `NFTPositionManager`, and the mainnet FXRP/USDT0 pool (`0x88d46717b16619b37fa2dfd2f038defb4459f1f7`) all have live bytecode and liquidity on **Flare mainnet (chain ID 14)**; the same addresses return **no code on Coston2 (chain ID 114)**. The address SparkDEX's docs list as "V2Factory" (`0x16b619B04c961E8f4F06C10B42FDAbb328980A89`) does have bytecode on Coston2, but it is **not** a Uniswap V2 factory — it exposes `getAddress(string)` (address-book semantics); calling `factory()` on the published V2 router against it reverts. **Do not trust** Flare's smart-account guide that hardcodes the mainnet `SwapRouter` for Coston2 USDT0/FXRP swaps — that address is empty on Coston2. SparkDEX's only *confirmed* Coston2 product is **Perps/Eternal** (roadmap item); Perps contracts are explicitly labeled **Flare Mainnet** in SparkDEX docs and are not a substitute for spot FXRP/USDT0 execution.
  - **BlazeSwap:** Contracts are live and functional as a V2-style DEX on Coston2 (122 pairs on the active factory). However, there is **no USDT0/FXRP direct pool**, and the only FXRP pools are dust-liquidity test pairs (~4.75 FXRP in WC2FLR/FXRP, ~8 FXRP in FXRP/test-token). A thin USDT0/WC2FLR hop exists (~490 USDT0 / ~33 WC2FLR) but cannot support copy-trading-sized FXRP/USDT0 fills. BlazeSwap is **not** globally dead — it is **liquidity-starved for Mirror's pair**. See [Appendix A](#appendix-a--verified-execution-venue-state-august-2026) for addresses and on-chain reserves.
- **Mocked — no usable Coston2 deployment exists:** **Kinetic** (mainnet-only per their own current contract docs), **Enosys** (testnet exists, but on Coston — Songbird's testnet, a different chain from the rest of this stack).

**Liquidity strategy:** Mirror cannot rely on third-party Coston2 liquidity for FXRP/USDT0. The primary Phase 4 path is **`MockSparkDexRouter`** — a self-deployed router implementing SparkDEX V3's `exactInputSingle` interface, filling at live FTSO prices. Optionally (Phase 4B), the team can **self-seed a BlazeSwap USDT0/FXRP V2 pool** with faucet tokens to demonstrate one real external DEX transaction; this is a separate code path (V2 router calldata, not SparkDEX V3) and still routes against the team's own LP.

Rather than silently dropping unreachable venues or blocking the project on protocols we don't control, every phase below builds the **real** thing wherever Coston2 support is verified, and explicitly **mocks** the venues that aren't — including Mirror's primary execution venue (SparkDEX spot). Nothing is skipped; everything is labeled honestly, and every mock preserves the real protocol's interface so swapping in verified live addresses later is a config change, not a rewrite.

---

## Phase 0 — Foundations, Topology, and Environment

**Objective:** Stand up the repo layout, Coston2 personas, RPC/faucet access, FCC scaffold clone, and `accounts.testnet.json` — before writing any contract or TEE logic.

**Deliverables**

- **Repo layout**:
  - `contracts/` — `MirrorRegistry.sol`, `MirrorVault.sol`, `MirrorFee.sol`, `MirrorLeaderboard.sol`, `InstructionSender.sol`, mocks (`MockSparkDexRouter.sol` — Phase 4; `MockEnosysCDP.sol`, `MockFirelightStrategy.sol`, `MockKineticPool.sol` — Phase 10)
  - `fce-matching-engine/` — forked from `fce-extension-scaffold`, houses the signal-decryption + sizing + PMW-signing TEE service
  - `fce-ai-agent/` — second, independent FCE (own code hash), houses scoring/classification/matching logic
  - `frontend/` — Next.js app: discovery, lead profile, portfolio, signal submission, XRPL onboarding
  - `scripts/deploy/` — numbered deploy scripts per phase
  - `scripts/relayer/` — TEE proxy + XRPL monitor + FDC proof relayer (operator layer from PRD §5.1)
- **Persona provisioning** on Coston2:
  - `deployer`, `lead-trader-1`, `lead-trader-2` (for drift-detection testing in Phase 9), `follower-evm-1..3`, `operator/relayer`, `tee-signing-key` (PMW-controlled, never held by a human)
  - Fund each from the Coston2 faucet (C2FLR, FXRP, USDT0 — all dispensed directly by the faucet, no minting flow needed for base testing)
  - Write addresses to `config/accounts.testnet.json`
- **XRPL Testnet persona** (for Phase 8): one funded XRPL testnet account for the FSA follower flow
- **Env template**:
  ```
  FLARE_NETWORK=coston2
  FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc
  FLARE_CHAIN_ID=114
  FLARE_CONTRACT_REGISTRY=0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019
  DEPLOYER_PRIVATE_KEY=
  TEE_MATCHING_ENGINE_ENDPOINT=
  TEE_AI_AGENT_ENDPOINT=
  FDC_VERIFIER_API_KEY=
  FDC_DA_LAYER_URL=
  XRPL_TESTNET_RPC_URL=wss://s.altnet.rippletest.net:51233
  XRPL_OPERATOR_ADDRESS=
  COINGECKO_API_KEY=
  DEFILLAMA_API_BASE=
  NEXT_PUBLIC_MIRROR_REGISTRY_ADDRESS=
  NEXT_PUBLIC_MIRROR_VAULT_ADDRESS=
  NEXT_PUBLIC_MIRROR_FEE_ADDRESS=
  NEXT_PUBLIC_MIRROR_LEADERBOARD_ADDRESS=
  EXECUTION_VENUE=mock-sparkdex          # mock-sparkdex | blazeswap-v2 (optional Phase 4B)
  MOCK_SPARKDEX_ROUTER_ADDRESS=          # set after Phase 4 deploy
  BLAZESWAP_ROUTER_ADDRESS=0x8D29b61C41CF318d15d031BE2928F79630e068e6
  BLAZESWAP_FACTORY_ADDRESS=0xf0f5e4cde15b22a423e995415f373fedc1f8f431
  C2_USDT0_ADDRESS=0xC1A5B41512496B80903D1f32d6dEa3a73212E71F
  C2_FXRP_ADDRESS=                        # resolve via AssetManagerFXRP.fAsset(), do not hardcode from memory
  ```
- **Smoke script** `scripts/coston2-smoke.ts`:
  - Connect via viem/ethers to Coston2 RPC, print block number and confirm chain ID `114`
  - Resolve `FtsoV2`, `FdcHub`, and `AssetManagerFXRP` addresses via `FlareContractRegistry` (`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`)
  - Resolve canonical FXRP via `AssetManagerFXRP.fAsset()` — do **not** assume mainnet FXRP address
  - **Venue sanity check:** `eth_getCode` on SparkDEX `SwapRouter` and `V3Factory` — expect **zero bytecode** on Coston2; log a warning if non-zero (would mean SparkDEX shipped testnet spot since last verification)
  - **BlazeSwap sanity check:** call active factory `allPairsLength()` — expect a non-zero count; call `getPair(USDT0, FXRP)` — expect zero address (no direct pool) until Phase 4B seeds one
  - Print C2FLR/FXRP/USDT0 balances for every persona
  - Ping `fce-extension-scaffold` hello-world endpoint once cloned
- **CI**: install, Hardhat/Foundry compile, run `coston2-smoke.ts` against a pinned RPC, fail if `FLARE_CHAIN_ID` ≠ `114` anywhere outside the XRPL-testnet or mock-contract paths

**Testing**

- Manual: every persona shows non-zero C2FLR after faucet request; deployer shows non-zero FXRP/USDT0
- CI grep check: fail if any mainnet Flare address (chain ID 14) or Songbird-only address appears in `contracts/` or `scripts/deploy/`

**Exit Criteria**

- All personas funded and resolvable in `accounts.testnet.json`
- Smoke script passes against live Coston2 RPC
- `fce-extension-scaffold` cloned, builds locally, hello-world `/action` endpoint responds
- **Explicitly documented as deferred:** Flare mainnet SparkDEX spot execution, Songbird canary FCC, real Enosys, real Kinetic, real FBTC market (unconfirmed on Coston2). Firelight is real on Coston2 but out of MVP scope until Phase 10 wiring.

---

## Phase 1 — Smart Contracts: Registry, Vault, Fee, Leaderboard (MVP Core)

**Objective:** Deploy the four PRD-scoped contracts (§11) to Coston2 with single-asset (FXRP) custody and the `InstructionSender` gate that makes the TEE the only party that can move funds.

**Deliverables**

- `MirrorRegistry.sol` — lead + follower registration, strategy metadata, fee rate (0–20 bps of profit), min follow allocation
  ```solidity
  struct LeadTrader {
      address wallet;
      uint8   strategyType;      // 0=momentum, 1=mean-reversion, 2=yield-arb (Phase 6 classifier output)
      uint16  feeRateBps;        // 0-2000 (0-20%)
      uint256 minAllocation;
      bytes32 teePublicKeyHash;  // signal encryption target
      bool    verified;          // set by AI agent after 30-day history check (Phase 6)
  }
  ```
- `MirrorVault.sol` — single-asset FXRP sub-account custody; `deposit`, `requestWithdrawal`, `settleBatch` (callable **only** by `InstructionSender`)
- `MirrorFee.sol` — fee accrual keyed by lead/epoch, `claim()`, and a `releaseFee(bytes32 fdcProofId)` gated on FDC proof verification (wired in Phase 5)
- `MirrorLeaderboard.sol` — `updateScore(address lead, uint8 score, bytes32 attestationId)`, callable only by the AI Agent FCE's registered signer
- `InstructionSender.sol` — the sole address permitted to call vault/fee state-changing functions; holds the TEE's signing address, enforces nonce ordering
- Hardhat/Foundry project targeting Coston2, EVM version **cancun** (matches Flare's own tooling requirement)

**Testing**

- Unit tests: registration flows, deposit/withdrawal accounting, fee accrual math, and — critically — that **no function moving funds is callable by any address except `InstructionSender`** (explicit revert tests for direct calls from `deployer`, `lead-trader-1`, etc.)
- Fuzz test `MirrorVault.settleBatch` against malformed/oversized follower arrays

**Exit Criteria**

- All four contracts deployed and verified on Coston2 explorer
- 100% of "only-TEE-can-move-funds" negative tests pass
- Addresses written into `config/coston2.json` and consumed by the smoke script

---

## Phase 2 — FTSO v2 Integration (Price Feed Layer)

**Objective:** Wire real Coston2 FTSO feeds into both the contracts and the future TEE sizing logic, since position sizing is meaningless without live prices.

**Deliverables**

- `FtsoPriceReader.sol` helper contract wrapping `TestFtsoV2Interface` (block-latency ~1.8s feeds) for FXRP/USD and USDT0/USD, resolved via `ContractRegistry`
- Anchor feed (90s) cross-check helper used only for orders above a configurable notional threshold — implements the PRD's "volatility circuit breaker" concept as a simple revert-if-feeds-diverge-beyond-X% guard
- Offchain TS/Go reader (`scripts/ftso/read-feeds.ts`) so the FCE matching engine (Phase 3) can pull the same feed IDs outside Solidity
- Feed ID constants file, sourced from `dev.flare.network/ftso/feeds` — do not hardcode from memory, feed IDs can be added/changed

**Testing**

- Read FXRP/USD and USDT0/USD on Coston2 every block for 10 minutes, log for staleness/gaps
- Unit test: circuit breaker helper reverts when a synthetic divergence between block-latency and anchor price exceeds threshold

**Exit Criteria**

- Both feed types readable on-chain and off-chain against live Coston2 data
- Divergence guard demonstrably reverts on injected bad data in a forked-mainnet-style Hardhat test

---

## Phase 3 — FCE 1: Matching Engine — From Hello World to Real Signal Flow

**Objective:** This is the highest-risk phase — FCC on Coston2 is bleeding-edge tooling, not a mature service. Build incrementally: prove the TEE round-trip first, only then add real logic.

**Deliverables — Stage A (round-trip proof)**

- Deploy `fce-extension-scaffold` unmodified to Coston2, register it in `TeeExtensionRegistry` / `TeeMachineRegistry`
- Send a trivial instruction through `InstructionSender` → confirm the extension's `/action` handler fires and a signed no-op response returns
- Document the extension's **code hash** and confirm it's queryable on-chain (this is the mechanism your PRD's §12 "published code hash" claim depends on — prove it works before relying on it)

**Deliverables — Stage B (real matching engine)**

- Signal encryption/decryption: lead encrypts `(asset, direction, size-pct, nonce)` client-side against the FCE's public key; TEE decrypts inside the enclave only
- FTSO consumption inside the TEE (reuses Phase 2's feed-reading logic, ported to the extension's runtime)
- Position sizer for a **single follower sub-account** (per MVP scope) — proportional scaling against `MirrorVault` allocation and a hardcoded cap
- Batch tx assembler + PMW signer: constructs the SparkDEX swap calldata (target venue wired in Phase 4) and signs with the TEE-resident key
- `types server /decode` endpoint so external tooling can inspect (non-sensitive) instruction shapes without touching plaintext signal content

**Testing**

- Stage A: instruction round-trip succeeds 10/10 times across a fresh deploy
- Stage B: submit a synthetic encrypted signal, confirm the TEE never logs or exposes plaintext outside the enclave boundary (verify via TEE proxy logs — should show only ciphertext in, signed tx out)
- Reproducible build check: rebuild the extension twice with `SOURCE_DATE_EPOCH` pinned, confirm identical code hash

**Exit Criteria**

- Extension registered on Coston2 with a stable, reproducible code hash
- End-to-end: encrypted signal in → correctly sized, correctly signed batch swap calldata out, with zero plaintext signal data ever touching a public log or contract
- **Explicitly flagged as a live risk:** FCC tooling may change under you mid-build; keep the Stage A round-trip test in CI as a canary for scaffold breakage

---

## Phase 4 — Execution Venue Integration: Mock SparkDEX Router (Coston2)

**Objective:** Take the matching engine's signed batch swap output and settle it. **Verified finding overrides the original PRD assumption** ("Signed swap output to SparkDEX on Coston2"): there is **no live SparkDEX V3 spot infrastructure on Coston2** and **no third-party FXRP/USDT0 liquidity** on BlazeSwap. Build a mock that mirrors the real SparkDEX interface so mainnet migration is a config change, not a rewrite.

**Why a mock, not BlazeSwap as primary?**

| Option | Viable for MVP? | Reason |
|---|---|---|
| SparkDEX V3 on Coston2 | **No** | `SwapRouter`, `V3Factory`, pool — all empty addresses on chain ID 114 |
| BlazeSwap as-is | **No** | No USDT0/FXRP pool; FXRP depth ~4.75 tokens; 2-hop via WC2FLR is dust |
| Self-seeded BlazeSwap pool (Phase 4B) | **Optional** | Real V2 AMM tx, but V2 calldata ≠ SparkDEX V3; you are the only LP |
| **`MockSparkDexRouter` (primary)** | **Yes** | Same `exactInputSingle` ABI as mainnet SparkDEX; fills at live FTSO prices |

**Deliverables — Phase 4A (primary path)**

- `MockSparkDexRouter.sol` — deployed fresh on Coston2, implementing the same `exactInputSingle`/`exactOutputSingle` function signatures as SparkDEX's real `SwapRouter` (`0x8a1E35F5c98C4E85B36B7B253222eE17773b2781` on mainnet), so the matching engine's calldata construction is identical to production
- Internal oracle-priced fill logic inside the mock, sourced from Phase 2's FTSO feeds (block-latency + anchor) — swaps settle at real, live FXRP/USD and USDT0/USD prices even though counterparty liquidity is simulated (the mock holds or mints test tokens from a deployer-funded reserve)
- Slippage/minimum-out guard sourced from the anchor feed (not just block-latency), preserved exactly as originally planned, so this protection is validated against the mock now and needs no rework when the real router is wired in
- `config/coston2.json` entry: `executionVenue: "mock-sparkdex"`, `mockSparkDexRouter: <deployed>`, with commented mainnet SparkDEX addresses for future swap:
  ```
  # Mainnet only (verified live, chain ID 14) — do NOT use on Coston2
  SPARKDEX_SWAP_ROUTER=0x8a1E35F5c98C4E85B36B7B253222eE17773b2781
  SPARKDEX_V3_FACTORY=0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652
  SPARKDEX_FXRP_USDT0_POOL=0x88d46717b16619b37fa2dfd2f038defb4459f1f7
  SPARKDEX_POOL_FEE=500
  ```
- README in `contracts/mocks/` stating explicitly: *"This stands in for SparkDEX's V3.1 spot swap router, which has no live bytecode on Coston2 as of August 2026 (verified via `eth_getCode` against chain ID 114). Real SparkDEX V3 is confirmed live only on Flare mainnet (chain ID 14). SparkDEX Perps/Eternal on Coston2 does not serve spot FXRP/USDT0. Replace `MockSparkDexRouter` with the real `SwapRouter` address once SparkDEX deploys spot swap to Coston2, or move this integration to mainnet."*
- Wire Phase 3's PMW-signed batch tx to submit against `MockSparkDexRouter` using the real interface shape

**Deliverables — Phase 4B (optional stretch: real BlazeSwap pool)**

Only pursue if the demo needs at least one **real external DEX transaction** for FDC attestation narrative. Not required for MVP exit criteria.

- `scripts/venues/seed-blazeswap-pool.ts`:
  1. Resolve FXRP via `AssetManagerFXRP.fAsset()` on Coston2
  2. If `getPair(USDT0, FXRP)` on BlazeSwap factory `0xf0f5e4cde15b22a423e995415f373fedc1f8f431` returns zero, call `createPair`
  3. Approve + `addLiquidity` via BlazeSwap router `0x8D29b61C41CF318d15d031BE2928F79630e068e6` using faucet USDT0 + FXRP (recommend seeding ≥10,000 USDT0 / proportional FXRP at FTSO price so copy-trading demos don't drain the pool in one swap)
  4. Write pair address to `config/coston2.json`
- Separate matching-engine code path: `swapExactTokensForTokens` (V2) behind `EXECUTION_VENUE=blazeswap-v2` — **do not** mix V2 calldata into the primary SparkDEX V3 path
- Document that BlazeSwap's published addresses on blazeswap.top (`Factory 0x440602…`, `Router 0xe3A1…`) are **stale**; routers on Coston2 resolve to factory `0xf0f5e4…` — always verify via `router.factory()` at deploy time

**Testing**

- Execute 20+ small swaps through the TEE-signed path against `MockSparkDexRouter`, confirm fills land within expected slippage band against live FTSO prices
- Adversarial test: feed the sizer an intentionally stale block-latency price, confirm the anchor-feed guard blocks execution
- Interface-parity test: confirm `MockSparkDexRouter`'s function selectors exactly match the real mainnet `SwapRouter` ABI (compare against Flare mainnet artifact or SparkDEX docs), so a future address swap requires zero calldata changes upstream
- **Phase 4B only:** execute one USDT0→FXRP swap through the seeded BlazeSwap pool, confirm reserves move and slippage is acceptable for demo-sized amounts

**Exit Criteria**

- Full loop works on **Phase 4A**: encrypted signal → TEE decrypt/size/sign → FTSO-priced swap on `MockSparkDexRouter` → follower sub-account balance updates in `MirrorVault`
- Zero unguarded executions in the adversarial test suite
- Submission documentation explicitly states SparkDEX spot is mocked and why, citing RPC bytecode verification (Appendix A) rather than asserting from docs alone
- **Phase 4B:** optional; if implemented, one real BlazeSwap swap round-trip passes and is labeled as self-seeded test liquidity in demo narration

---

## Phase 5 — FDC Attestation Loop (Settlement Proof + Fee Release)

**Objective:** Close the trust loop — prove on-chain that the TEE's private execution actually happened as claimed, and gate lead fee payouts on that proof.

**Deliverables**

- FDC EVMTransaction attestation request flow (`scripts/relayer/fdc-proof-relayer.ts`): after a swap confirms (against `MockSparkDexRouter` on the primary path, or BlazeSwap if Phase 4B is enabled), request attestation from the FDC verifier, wait for voting round finalization, fetch the Merkle proof from the DA Layer
- `MirrorFee.releaseFee(bytes proof)` — verifies the proof against `FdcVerification` (via `ContractRegistry`), decodes the swap details, matches them against the pending fee record, releases funds to the lead
- Follower balance delta reconciliation: `MirrorVault` updates the follower's recorded balance only after the same proof lands, not optimistically at swap time

**Testing**

- Full round trip on real Coston2 FDC infrastructure: request → voting round → proof fetch → on-chain verify → fee release, timed end-to-end
- Negative test: malformed or mismatched proof (wrong tx hash, wrong amount) is rejected by `MirrorFee`

**Exit Criteria**

- At least 10 consecutive signal→swap→proof→fee-release cycles complete successfully against live Coston2 FDC
- Fee release is provably impossible without a valid, matching FDC proof

---

## Phase 6 — FCE 2: AI Agent — Scoring, Classification, and the Onchain Leaderboard

**Objective:** Deploy the second, independently-code-hashed FCE that turns private signal history into public, attested leaderboard scores.

**Deliverables**

- Second FCE deployment (`fce-ai-agent/`), separate registration in `TeeExtensionRegistry`, own published code hash — must be provably distinct from the matching engine's
- Performance scorer: Sharpe-equivalent ratio (rolling 30-day), max drawdown, consistency score — computed from the matching engine's private outcome log (read via a TEE-to-TEE channel, never touching public chain state)
- Strategy classifier: 3 categories per MVP scope (momentum / mean-reversion / yield-arb)
- FDC Web2Json attestation requester: pulls CoinGecko FXRP/USDT0 volatility and DeFiLlama TVL snapshots, embeds attestation IDs alongside the computed score
- `MirrorLeaderboard.updateScore()` call, gated to the AI agent's registered signer only

**Testing**

- Feed the AI agent a synthetic signal history with a known Sharpe ratio, confirm computed score matches expected value within tolerance
- Confirm `MirrorRegistry` and matching-engine FCE **cannot** call `updateScore` directly (only the AI agent's signer can)
- Confirm Web2Json attestation IDs recorded on `MirrorLeaderboard` resolve to real, verifiable external data via the DA Layer

**Exit Criteria**

- Leaderboard reflects real, attested scores for at least 2 lead traders with distinct synthetic histories
- Two FCEs (matching engine, AI agent) provably run under different code hashes, independently auditable

---

## Phase 7 — Web App: Core Lead and Follower Flows (EVM Path)

**Objective:** Ship the UI surfaces needed to actually demo the product — discovery, lead onboarding, follower onboarding, signal submission, portfolio.

**Deliverables**

- Home/discovery screen: leaderboard sorted by AI Score, filterable by risk profile/strategy type, reading live from `MirrorLeaderboard`
- Lead onboarding: wallet connect → `MirrorRegistry.register()` → display TEE public key for client-side signal encryption
- Signal submission form: asset selector, direction, size-pct slider; encrypts client-side (Web Crypto against the FCE public key) before ever leaving the browser
- Follower onboarding: wallet connect → risk profile → deposit FXRP into `MirrorVault` → browse leaderboard → follow
- Portfolio dashboard: per-lead position summary, epoch P&L, plain-language trade summaries (classification-level only, per PRD §6.2/§7)
- Withdrawal flow wired to `MirrorVault.requestWithdrawal`

**Testing**

- End-to-end Playwright/Cypress run: register a lead, submit a signal, onboard a follower, confirm dashboard reflects the Phase 3–5 pipeline's real on-chain state within one epoch
- Manual accessibility/mobile-responsive pass (PRD §10.2 requires mobile-equivalent via responsive web)

**Exit Criteria**

- A first-time user can go from empty wallet (post-faucet) to an active followed position entirely through the UI, with every number on screen traceable to real Coston2 state

---

## Phase 8 — Flare Smart Accounts / XRPL Onboarding Path

**Objective:** Add the no-FLR-needed XRPL follower path, since `MasterAccountController` is confirmed deployed on Coston2 — this is genuinely testable, not a mock.

**Deliverables**

- XRPL onboarding flow: generate the 32-byte instruction payment reference, render QR for Xaman (testnet mode) or CLI signing
- `scripts/relayer/xrpl-monitor.ts`: watches XRPL testnet for the operator-address payment, requests FDC Payment attestation, submits to `MasterAccountController` on Coston2
- FXRP minting + `MirrorVault` sub-account creation triggered by the attested payment
- Real-time UI status stepper: "Waiting for XRPL confirmation → Requesting FDC proof → Minting FXRP → Sub-account active"

**Testing**

- Full round trip on XRPL testnet + Coston2: send test-XRP with encoded reference → confirm FXRP lands in a fresh `MirrorVault` sub-account with zero prior EVM wallet interaction
- Failure-path test: malformed reference is rejected without minting

**Exit Criteria**

- A wallet with **only** XRPL testnet XRP (no C2FLR, no prior EVM address) can reach an active followed position through the FSA path alone

---

## Phase 9 — Drift Detection and Position Health Monitoring

**Objective:** Ship the AI agent's protective features — the PRD calls drift detection "the single most important protection feature," so it earns its own phase rather than being bolted onto Phase 6.

**Deliverables**

- Drift detector: AI agent continuously compares each lead's live strategy classification against their registered baseline; flags divergence beyond a configurable threshold
- In-app alert delivery (webhook/notification stub is fine for testnet — real push infra is out of scope)
- Position health monitor for lending-style strategies: since **Kinetic's Coston2 addresses are unverified/stale** (research flagged this), build `MockKineticPool.sol` — a minimal supply/borrow/collateral-ratio contract matching Kinetic's public interface shape, clearly labeled as a stand-in until Kinetic's current Coston2 deployment is verified
- Collateral ratio monitoring against Phase 2 FTSO feeds, with a pre-authorized auto top-up path routed back through the matching engine FCE

**Testing**

- Synthetic drift injection: switch a lead's simulated signal pattern mid-test, confirm the agent flags it within one scoring cycle
- Synthetic price-drop test against `MockKineticPool`: confirm liquidation-risk alert fires before the configured threshold, and (if pre-authorized) the auto top-up executes through the TEE

**Exit Criteria**

- Drift detection demonstrably fires on injected strategy changes, silent on stable strategies (no false positives across a 50-cycle synthetic run)
- Health monitoring loop functions against the mock lending pool with the same contract interface Kinetic would expose, so swapping in verified real addresses later is a config change, not a rewrite

---

## Phase 10 — Mock Layer for Unreachable Venues: Enosys CDP (+ Optional Firelight Wiring)

**Objective:** Give the product's full surface area (per PRD §3) something to point at for Enosys, without pretending that integration is real — because Enosys tests on Coston (Songbird testnet), not Coston2. **Firelight is confirmed live on Coston2** (`0xC90D6847747b85d1fa2E07859869fb9fB72c0361`); wire the real vault if the passive-staking tier is in scope, otherwise defer to post-MVP.

**Deliverables**

- `MockEnosysCDP.sol`: minimal collateral-ratio/mint-stablecoin interface matching Enosys Loans' public shape, deployed fresh on Coston2 (real Enosys tests on Coston, a different chain, so no bridging shortcut exists)
- **Firelight (choose one):**
  - **Preferred if in scope:** integrate real Coston2 Firelight vault address from Flare dev hub; no mock needed
  - **If out of MVP scope:** `MockFirelightStrategy.sol` — same pattern as originally planned (`IStrategy` interface, `setYieldAmount()` for simulated yield), clearly labeled as stand-in
- Enosys mock (and Firelight mock if used) wired into the matching engine's venue router behind a feature flag (`MIRROR_MOCK_VENUES=true`), so the routing logic itself is real even though unreachable venues are simulated
- README section in each mock's directory stating explicitly: *"This is a stand-in for [protocol], which has no usable Coston2 deployment as of this build. Replace with the real integration once [protocol] ships testnet parity or Mirror moves to mainnet."*

**Testing**

- Confirm the matching engine can route a CDP-management signal through the Enosys mock exactly as it would through a real venue (same calldata shape, same PMW signing path)
- Explicit non-goal check: no test in the suite claims mock venue behavior is representative of real Enosys risk parameters

**Exit Criteria**

- Full PRD feature surface (§3 table) has *something* runnable behind it on Coston2, with every mock clearly and permanently labeled as such in code, docs, and any demo narration

---

## Phase 11 — End-to-End Integration Testing, Demo Script, and Submission Packaging

**Objective:** Prove the whole system works together under realistic conditions, and package it the way the bounty criteria (PRD §12) actually asks for.

**Deliverables**

- Multi-follower load test: 1 lead, 5+ followers with varying allocations, one signal fans out correctly through Phase 3's sizer to all sub-accounts
- Full adversarial pass: attempt to read plaintext signal content from any public log, mempool trace, or contract event — confirm nothing leaks (this is the core claim of the entire product; test it directly, don't assume it)
- Demo script covering: lead registration → signal submission → private matching → **execution venue swap** (mock SparkDEX primary; optional BlazeSwap if seeded) → FDC proof → fee release → AI leaderboard update → follower withdrawal → drift-detection trigger → XRPL onboarding
- Submission doc mapping directly to PRD §12's four bounty questions (what's private, what's verified onchain, trust assumptions, why not normal smart contracts) — each claim linked to the specific test that proves it
- Explicit **"Known Limitations on Testnet"** section:
  - SparkDEX spot V3 **mocked** on Coston2 — no bytecode at published addresses (Appendix A)
  - BlazeSwap FXRP/USDT0 **not available** without self-seeded liquidity (Phase 4B optional)
  - Flare dev hub Coston2 swap guide references a mainnet-only `SwapRouter` — do not cite as Coston2 truth
  - FBTC market unconfirmed on Coston2
  - Kinetic mocked pending address verification; Enosys fully mocked (Coston ≠ Coston2)
  - Firelight is real on Coston2 but passive-staking tier is out of MVP scope
  - FCC tooling is bleeding-edge and may shift before mainnet

**Testing**

- Full demo script run start-to-finish with no manual intervention, timed
- Independent reviewer (someone who didn't write the code) attempts the plaintext-leak adversarial test fresh, confirms same result

**Exit Criteria**

- One-command or one-script full lifecycle demo runs cleanly against live Coston2 + XRPL testnet state
- Every bounty claim in §12 has a corresponding passing test cited next to it in the submission doc
- Nothing in the submission overstates what's real vs. mocked — the limitations section is as prominent as the feature list

---

## Appendix A — Verified Execution Venue State (August 2026)

Re-verify before mainnet migration or if SparkDEX announces Coston2 spot deployment. Method: `eth_getCode`, `eth_call` against live RPCs.

### SparkDEX V3.1 spot (published addresses — same in SparkDEX docs for all networks, **no network label**)

| Contract | Address | Coston2 (114) | Flare mainnet (14) |
|---|---|---|---|
| SwapRouter | `0x8a1E35F5c98C4E85B36B7B253222eE17773b2781` | **no code** | 12,070 bytes, active |
| V3Factory | `0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652` | **no code** | 24,576 bytes |
| UniversalRouter | `0x0f3D8a38D4c74afBebc2c42695642f0e3acb15D3` | **no code** | deployed |
| FXRP/USDT0 pool (fee 500) | `0x88d46717b16619b37fa2dfd2f038defb4459f1f7` | **no code** | live liquidity |
| Docs "V2Factory" | `0x16b619B04c961E8f4F06C10B42FDAbb328980A89` | bytecode present, **not a DEX factory** (address-book contract) | real Uniswap V2 factory |

Mainnet token addresses (reference only): USDT0 `0xe7cd86e13AC4309349F30B3435a9d337750fC82D`, FXRP `0xAd552A648C74D49E10027AB8a618A3ad4901c5bE`.

### BlazeSwap on Coston2 (V2-style DEX — **deployed, liquidity-starved for FXRP/USDT0**)

| Item | Address / value |
|---|---|
| Active factory (via `router.factory()`) | `0xf0f5e4cde15b22a423e995415f373fedc1f8f431` |
| Router (Flare FAssets guide) | `0x8D29b61C41CF318d15d031BE2928F79630e068e6` |
| Published factory on blazeswap.top (**stale — verify before use**) | `0x440602f459D7Dd500a74528003e6A20A46d6e2A6` |
| USDT0 (Coston2) | `0xC1A5B41512496B80903D1f32d6dEa3a73212E71F` |
| FXRP (Coston2, via `AssetManagerFXRP.fAsset()`) | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| WC2FLR | `0xC67DCE33D7A8efA5FfEB961899C73fe01bCe9273` |
| Total pairs (`allPairsLength`) | 122 |
| **USDT0/FXRP direct pool** | **does not exist** (`getPair` → zero address) |
| WC2FLR/FXRP pool | `0x18ee914a7efbe587ea99808b17be1df184d85b6e` — ~4.75 FXRP / ~177 WC2FLR, LP ~2.9×10⁻⁵ |
| USDT0/WC2FLR pool | `0x9ef29b3c42565ce0a720dd41750793cae163c9cf` — ~490 USDT0 / ~33.4 WC2FLR |
| FXRP pools (total) | 2 (second is FXRP/test-token, ~8 FXRP, dust LP) |

### Flare Contract Registry (all Flare networks)

`FlareContractRegistry`: `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` — use `getContractAddressByName("AssetManagerFXRP")` etc.; never hardcode FXRP from mainnet.

### Decision summary for Mirror Phase 4

1. **Primary:** deploy `MockSparkDexRouter` — only path that preserves SparkDEX V3 calldata parity.
2. **Optional:** self-seed BlazeSwap USDT0/FXRP for one real DEX leg (Phase 4B).
3. **Deferred:** SparkDEX mainnet spot — wire in when moving to chain ID 14 or when SparkDEX deploys V3 spot to Coston2.