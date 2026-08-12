# Mirror — Product Requirements Document
### Confidential copy trading on Flare, powered by FCC

**Version:** 1.0  
**Date:** August 2026  
**Bounty track:** Build private applications using Flare Confidential Compute

---

## 1. Problem statement

Copy trading is one of the most proven product categories in finance. eToro has 40 million users. Bybit, OKX, and Bitget all ship it natively on their platforms. The demand is real and enormous — retail participants want exposure to skilled traders' performance without managing positions themselves.

On a public blockchain, copy trading as it exists today is structurally broken in a way that none of these centralised platforms have solved onchain:

**The exposure loop:**  
When a skilled lead trader's wallet becomes popular enough to copy, every follower watching that wallet submits their replica trade to the public mempool within seconds of the original. MEV bots observe the lead's transaction as it enters the mempool, frontrun it with higher gas, and sandwich the wave of follower transactions that follow. The lead gets a worse price. Every follower gets a worse price still. The strategy's edge deteriorates in direct proportion to its popularity. At scale, copy trading on a public chain destroys the very alpha it is trying to share.

**What Flare has — and what it is missing:**  
Flare's DeFi stack (SparkDEX, BlazeSwap, Kinetic, Enosys, Firelight) is live and growing around FXRP and XRPFi. It is the largest EVM DeFi venue for XRP by TVL. The ecosystem has DEXes, lending, CDPs, and liquid staking. It has no copy trading infrastructure of any kind. The retail XRP holder — the primary audience for XRPFi's growth — has no passive, automated way to follow skilled on-chain traders on Flare. That gap is exactly what Mirror fills, using FCC as the technical primitive that makes it safe to build.

---

## 2. Product overview

**Mirror** is a private copy trading protocol for Flare's DeFi ecosystem. Skilled lead traders publish encrypted trade signals to a Flare Compute Extension (FCE) running inside a Trusted Execution Environment (TEE). The TEE matches those signals against follower allocations, sizes orders proportionally using real-time FTSO price feeds, and submits signed batch transactions to Flare's DeFi protocols — without any participant, operator, or observer being able to read the lead's intent, individual follower positions, or matching logic before execution.

The result is copy trading that works at scale: lead strategies are protected from MEV and strategy leakage, followers get accurate fills from batched execution, and the whole system settles on public smart contracts with verifiable, auditable outcomes.

---

## 3. Flare feature utilisation

Every Flare-native feature is used for exactly the problem it was designed to solve. The table below maps each feature to its specific role in Mirror.

| Flare feature | How Mirror uses it | Why it fits |
|---|---|---|
| **FCC / TEE enclave** | Runs the matching engine, decrypts lead signals, sizes follower orders | Sensitive inputs (strategy) stay sealed; output (signed batch tx) is verifiable onchain |
| **FCC Flare Compute Extension (FCE)** | Mirror is deployed as a registered FCE with a published code hash | Anyone can verify the matching logic is unmodified without reading its execution |
| **FCC Protocol Managed Wallets (PMW)** | The TEE holds execution authority for follower sub-accounts; signs batch swaps | Eliminates a centralised custody operator; keys never leave the enclave |
| **FTSO v2 block-latency feeds (1.8s)** | Prices FXRP, USDT0, FBTC, and other pairs inside the TEE for position sizing | Block-latency accuracy prevents stale-price manipulation of follower order sizes |
| **FTSO anchor feeds (90s)** | Cross-validates sizing for large orders; triggers volatility circuit breakers | Provides a manipulation-resistant second reference for high-value trades |
| **FTSO custom feeds** | Tracks Mirror-specific metrics (pool depth, slippage estimates) as onchain feeds | Lets the AI agent and followers consume Mirror stats natively without an oracle |
| **FDC EVMTransaction attestation** | Proves that a batch swap executed on SparkDEX or Kinetic as claimed | Smart contract uses the proof to release fee payments to lead traders trustlessly |
| **FDC Web2Json attestation** | The AI agent attests lead trader performance data from CoinGecko and DeFiLlama | Onchain leaderboard ranks are grounded in cryptographically attested external data |
| **FDC Payment attestation** | Verifies XRPL-side XRP deposits from Smart Account users | Triggers FXRP minting and Mirror sub-account creation without bridging friction |
| **Flare Smart Accounts (FSA)** | XRP holders on XRPL can join Mirror with a single XRPL signature, no FLR needed | Removes the cold-start problem for the 40M+ XRP wallet addresses that are Mirror's primary market |
| **FAssets (FXRP, FBTC)** | The assets traded inside Mirror vaults | Native to Flare's DeFi stack; no bridging risk; composable with Kinetic/Enosys collateral |
| **SparkDEX v3** | Primary execution venue for FXRP/USDT0 and FXRP/FBTC swaps | Deepest Flare liquidity, FTSO-integrated funding rates |
| **BlazeSwap** | Secondary execution venue; TEE routes to best price | Redundancy and competition for better fills |
| **Kinetic** | Execution venue for lending-strategy leads (supply/borrow adjustments) | FTSO-powered liquidation engine makes follower borrow positions safe |
| **Enosys CDP** | Execution venue for CDP-strategy leads (collateral ratio management) | FXRP-backed stablecoin positions followers can mirror without manual management |
| **Firelight (stXRP)** | Liquid staking yield strategies for passive follower tier | stXRP earns yield automatically; follower allocation compounds without active trading |
| **FLR / wFLR / FIRE** | Protocol fee from Mirror flows through FIRE into FLR buyback-burn | Mirror's trading volume directly benefits FLR tokenomics via FIP.16 burn engine |

---

## 4. AI agent component

The AI agent in Mirror is not a decoration. It solves a real problem that is structural to copy trading: **follower selection is the hardest, highest-stakes decision a follower makes**, and they make it without sufficient data, with biased presentation (leaderboards rank by raw PnL, not risk-adjusted returns), and with no protection against strategy drift.

### 4.1 What the agent is

Mirror's AI agent is a TEE-resident inference service deployed as a second FCE, running alongside the matching engine. It is a separate TEE process with its own code hash, making its inference logic independently auditable. It uses a small, quantised language model fine-tuned on DeFi strategy analysis, running inside the confidential compute environment so that the private performance data it analyses never leaves the enclave.

### 4.2 What the agent does

**Lead trader analysis (private):**  
Inside the TEE, the agent has access to each lead trader's complete historical signal log — the unencrypted record of every signal submitted, including size, direction, timing, and outcome. This data never touches the public chain. The agent computes risk-adjusted performance metrics: Sharpe-equivalent ratio over a rolling 30-day window, max drawdown percentage, strategy type classification (momentum, mean-reversion, yield arbitrage, CDP management), and a consistency score that penalises for irregular submission cadence. These metrics are the basis for the onchain leaderboard — but they are computed privately, so no follower can reverse-engineer the lead's position sizing from the metrics alone.

**Attestation of external data (via FDC Web2Json):**  
The agent submits Web2Json attestation requests to bring in external performance context: CoinGecko API data on FXRP/USDT0 historical volatility (to normalise returns), DeFiLlama TVL snapshots (to contextualise strategy returns relative to market conditions), and XRPL transaction data (to verify lead traders' on-chain track record before Mirror). These attested external datapoints feed into the agent's scoring model and are embedded in the onchain leaderboard record as verifiable inputs, not opaque scores.

**Follower-to-lead matching:**  
When a new follower joins Mirror, the agent analyses their stated risk tolerance (set during onboarding: conservative / moderate / aggressive), their deposit size, and the current composition of their sub-account. It ranks available leads by compatibility — a conservative follower is matched away from high-drawdown momentum traders toward CDP managers or yield arbitrageurs. The agent's matching recommendations are presented on the UI as ranked suggestions with plain-language rationale ("This lead has posted 12% average monthly return with a max drawdown of 4.1% over 90 days, consistent with your conservative risk profile") and a confidence indicator derived from data completeness.

**Drift detection and re-matching alerts:**  
The agent continuously monitors each lead's strategy type against their historical baseline. If a lead whose classified strategy was "yield arbitrage" suddenly begins submitting signals consistent with leveraged directional momentum trades, the agent flags this as a strategy drift event. Followers receive an in-app notification with a plain-language explanation and a prompt to review their allocation. This is the single most important protection feature in any copy trading system — existing platforms have no equivalent.

**Position health monitoring:**  
For followers who are mirroring lending or CDP strategies on Kinetic and Enosys, the agent monitors real-time FTSO price feeds and calculates each follower's collateral ratio continuously. If a position approaches its liquidation threshold, the agent generates an alert — and, if the follower has pre-authorised autonomous intervention, can submit an instruction through the matching engine FCE to top up collateral or partially unwind the position. This intervention is itself executed through the TEE, keeping the position details private.

### 4.3 What the agent does NOT do

The agent does not custody funds. It does not submit transactions directly. Every transaction that moves assets goes through the matching engine FCE, which requires a threshold of data provider signatures via FCC's decentralised consensus layer. The agent's outputs are recommendations and signed metadata — the execution layer is always the TEE matching engine, not the AI inference service.

---

## 5. System architecture

### 5.1 Components

```
Mirror System
│
├── Smart Contracts (Flare C-chain)
│   ├── MirrorRegistry.sol         — lead/follower registration, strategy metadata
│   ├── MirrorVault.sol            — follower sub-account custody (FXRP, FBTC)
│   ├── MirrorFee.sol              — fee accrual, FIRE distribution trigger
│   └── MirrorLeaderboard.sol      — attested performance scores, public ranking
│
├── FCE 1: Matching Engine (TEE)
│   ├── Signal decryption          — lead's encrypted intent → plaintext order params
│   ├── FTSO feed consumption      — live prices at block latency (1.8s)
│   ├── Position sizer             — proportional scaling per follower allocation & cap
│   ├── Batch tx assembler         — constructs signed swap/lend/cdp txs
│   └── PMW signer                 — signs batch txs with TEE-resident keys
│
├── FCE 2: AI Agent (TEE)
│   ├── Performance scorer         — Sharpe, drawdown, consistency (private inputs)
│   ├── FDC Web2Json requester     — CoinGecko, DeFiLlama attestation requests
│   ├── Strategy classifier        — momentum / mean-rev / yield-arb / CDP
│   ├── Follower matcher           — risk-profile-to-lead recommendation engine
│   └── Drift + health monitor     — continuous strategy type and collateral checks
│
└── Operator Layer
    ├── TEE Proxy                  — public endpoint; forwards signed instructions
    ├── XRPL monitor               — watches Smart Account payments for FSA users
    └── FDC proof relayer          — submits EVMTransaction proofs post-execution
```

### 5.2 Signal lifecycle

1. Lead trader encrypts a trade intent (asset pair, direction, size-pct, nonce) with the FCE's public key and submits it to the on-chain `InstructionSender` contract.
2. Data providers relay the signed instruction to the TEE matching engine.
3. Inside the TEE: signal decrypts → FTSO price pulled at block latency → follower allocations loaded → per-follower order sizes computed → batch swap transaction assembled and signed by PMW.
4. Signed batch transaction is submitted to the target venue (SparkDEX, Kinetic, or Enosys).
5. FDC EVMTransaction attestation confirms the trade settled.
6. Smart contract receives the FDC proof → releases lead trader fee → updates follower sub-account balances.
7. AI agent FCE reads the outcome record (privately) → updates performance model → checks for drift.

### 5.3 Trust assumptions

| Assumption | Honest baseline | Decentralisation path |
|---|---|---|
| TEE hardware integrity | Google Confidential Compute (AMD SEV) attestation | Multi-operator FCC deployment as network matures |
| Code correctness | Published FCE code hash; reproducible build | Open-source matching engine with community audit |
| FTSO price accuracy | 100 independent data providers, stake-weighted | Inherits Flare's full economic security |
| FDC attestation accuracy | Same 100-provider consensus network | Same as above |
| Smart contract correctness | Audited at launch | Ongoing audits; governance-upgradable |

---

## 6. User roles and flows

### 6.1 Lead trader

**Who:** Experienced DeFi traders with a verifiable track record on Flare (SparkDEX, Kinetic), or traders with an attested XRPL history brought in via FDC Web2Json.

**Onboarding:**
1. Connect an EVM wallet on Flare.
2. Register on `MirrorRegistry` with a strategy type, fee rate (0–20% of follower profit), and a minimum follow allocation.
3. The AI agent runs an initial analysis against 30 days of on-chain history (FDC EVMTransaction attestation of historical SparkDEX/Kinetic transactions) and issues a Verified Score badge if data is sufficient.
4. Lead receives a TEE public key for encrypting future signals.

**Ongoing:**  
Submit encrypted signals through the Mirror web app or a CLI. Signal submission is as fast as a standard Flare transaction. Leads see only their own aggregated follower count and total AUM — individual follower allocations are never exposed to them.

**Earning:**  
Fees accrue in `MirrorFee.sol` and are claimable at any time. Fee is a percentage of follower realised profit per epoch (30 days), computed and verified by the FDC attestation of execution outcomes.

### 6.2 Follower (EVM path)

**Who:** Any user with an EVM wallet and FXRP or FBTC on Flare.

**Onboarding:**
1. Visit the Mirror web app. Connect MetaMask or any EVM wallet.
2. Set risk profile (conservative / moderate / aggressive) and max allocation cap per lead.
3. Deposit FXRP (or FBTC) into `MirrorVault`. This creates a follower sub-account.
4. Browse the AI-ranked leaderboard. Select one or more leads.
5. Allocation activates immediately. No further action required until the follower wants to withdraw or switch leads.

**Experience:**  
Every time a lead submits a signal, the TEE matching engine scales it to the follower's allocation and executes the corresponding trade automatically. The follower sees their sub-account balance update after each trade with a plain-language summary ("Position opened: long FXRP/USDT0 · Your allocation: 12 FXRP · Entry price: $2.41"). The strategy itself — the signal content — is never shown.

**Withdrawal:**  
Submit a withdrawal instruction through the smart contract at any time. The vault unwinds open follower positions (via reverse batch tx through the TEE) and returns funds within the next epoch boundary (up to 4 hours).

### 6.3 Follower (XRPL Smart Account path)

**Who:** XRP holders who have never interacted with Flare and have no EVM wallet.

**Onboarding:**
1. Visit the Mirror web app. Connect Xaman (or any Smart Account-compatible XRPL wallet).
2. Set risk profile and max allocation.
3. Send XRP to the Mirror Smart Account operator address on XRPL with a 32-byte instruction encoded in the payment reference (the web app generates this).
4. The operator monitors the XRPL, requests a Payment attestation from FDC, and submits it to `MasterAccountController`.
5. The `MasterAccountController` mints FXRP and deposits it into the follower's Mirror sub-account.
6. From this point, the follower experience is identical to the EVM path. They never need to hold FLR.

**Withdrawal:**  
Request withdrawal through the web app → FXRP is redeemed via FAssets → XRP is returned to the original XRPL address.

---

## 7. AI agent UX — what the follower sees

The AI agent's outputs surface in the Mirror UI in three places:

**Leaderboard:**  
Leads are ranked by a composite AI Score (0–100) displayed alongside raw return figures. The score weights: 40% risk-adjusted return (Sharpe equivalent), 25% max drawdown, 20% strategy consistency, 15% attested data completeness. Each lead card shows the plain-language strategy classification, top 3 matched follower risk profiles, and a data confidence indicator (Low / Medium / High based on data history length and FDC attestation coverage).

**Your portfolio panel:**  
Followers see each active lead they are copying with: current position summary, epoch P&L, AI health status (Healthy / Drift Detected / Liquidation Risk), and a one-line agent rationale for their last signal ("Lead executed a FXRP → USDT0 swap consistent with mean-reversion entry at price support"). No strategy specifics are disclosed — only classification-level language.

**Alerts:**  
Push notifications (web and optionally XRPL memo-back for FSA users) for: strategy drift detection, position approaching liquidation threshold, new lead matching your risk profile, epoch settlement complete.

---

## 8. Fee structure and FLR flywheel

| Fee type | Rate | Recipient |
|---|---|---|
| Lead performance fee | 0–20% of follower epoch profit (lead-set) | Lead trader |
| Protocol fee | 10% of lead's earned performance fee | Mirror protocol |
| Mirror protocol fee routing | 100% → FIRE (FIP.16 mechanism) | FLR buyback-burn |
| AI agent attestation gas | Recovered from protocol fee pool | Operator |

The flywheel: more copy volume → more FXRP traded on SparkDEX/Kinetic → higher FTSO oracle usage → more FDC attestation requests → more fees flowing through FIRE → FLR burn pressure increases → FLR supply tightens.

---

## 9. What runs privately inside the TEE

For the bounty submission record:

| Private input | Why it must stay private |
|---|---|
| Lead's encrypted signal (asset, direction, size-pct, nonce) | Exposure before execution enables frontrunning and strategy copy without participation |
| Individual follower allocation sizes | Reveals follower portfolio composition; enables targeted MEV against their positions |
| Matching engine computation (who gets what order size) | Reveals follower count and distribution; enables coordination attacks |
| AI agent's per-lead performance history | Full signal log would reveal strategy logic if exposed |
| AI agent's per-follower health computations | Reveals position details that could be targeted for liquidation |

| Public output | What it proves |
|---|---|
| Signed batch swap transaction | Verifiable execution on SparkDEX/Kinetic/Enosys |
| FDC EVMTransaction proof | Trade settled at claimed price and size |
| Onchain leaderboard scores | AI-computed, FDC-attested, tamper-evident |
| Follower sub-account balance delta | Net outcome of private execution |
| Strategy type classification | Lead's strategic category (not their specific signals) |

---

## 10. What the final product looks like

### 10.1 Web application

**Home / discovery screen:**  
Clean leaderboard of lead traders sortable by AI Score, raw return, drawdown, AUM under management, and strategy type. Each card shows: anonymised lead handle, strategy type badge (momentum / yield-arb / CDP / mean-rev), 30-day return, AI Score, and AUM. Filter controls: risk profile match, minimum track record, minimum data confidence.

**Lead profile page:**  
Detailed view of a single lead with: performance chart (epoch-by-epoch returns, plotted against FXRP price for context), drawdown history, strategy consistency timeline, AI agent commentary (plain language, updated each epoch), and attested data sources (FDC Web2Json attestation IDs for external data). Prominent "Follow" CTA with allocation input.

**Portfolio dashboard:**  
Follower's full picture — total allocated FXRP, breakdown per lead, epoch P&L per lead, AI health status badges per position, and a log of the last 10 executed trades (classification level only: "Long opened", "Short closed", "Collateral topped up"). Running fee tracker showing what each lead has earned from the follower this epoch.

**Signal submission (lead view):**  
A minimalist trade intent form: asset selector, direction toggle, size-as-percentage-of-AUM slider, and a "Submit Signal" button. Signal encrypts client-side before leaving the browser. Confirmation shows signal receipt timestamp and estimated execution latency. Lead sees their aggregate performance dashboard and total follower AUM, not individual followers.

**XRPL onboarding flow (FSA path):**  
Step-by-step guided flow that generates the correct XRPL payment reference, shows a QR code to scan in Xaman, and tracks the FDC attestation confirmation in real-time ("Waiting for XRPL confirmation... Requesting FDC Payment proof... Minting FXRP... Sub-account active").

### 10.2 Mobile

The web app is responsive and functions as the mobile experience. For FSA users, deep-linking from Xaman launches the Mirror onboarding flow directly.

---

## 11. Scope for bounty submission (MVP)

The full product above is the target state. For the bounty, the deliverable is a working proof of the core TEE pattern:

**FCE 1 (matching engine) — MVP scope:**
- Signal encryption/decryption via FCE public key
- FTSO block-latency feed consumption inside the TEE (FXRP/USD)
- Position sizing for a single follower sub-account
- Signed swap output to SparkDEX on Coston2
- FDC EVMTransaction proof verification in the smart contract

**FCE 2 (AI agent) — MVP scope:**
- Performance scoring from on-chain history (Sharpe + drawdown)
- Strategy type classification (3 categories)
- Onchain leaderboard update via attested score

**Smart contracts — MVP scope:**
- `MirrorRegistry`: lead and follower registration
- `MirrorVault`: single-asset (FXRP) sub-account custody
- `MirrorLeaderboard`: attested score storage

**Omitted from MVP:** FSA XRPL path, multi-venue routing, AI drift detection, autonomous intervention, mobile app. These are v2.

---

## 12. Why Mirror wins the bounty criteria

The bounty asks for: what runs privately inside the TEE, what is verified onchain, what the trust assumptions are, and why confidential compute is necessary rather than normal smart contracts.

**What runs privately:** The lead's trade intent, the matching computation, per-follower order sizing, and the AI agent's performance analysis.

**What is verified onchain:** Execution outcome (FDC EVMTransaction), AI scores (FDC-attested inputs), follower balance deltas, fee accrual.

**Trust assumptions:** TEE hardware attestation (Google Confidential Compute / AMD SEV), identical to FCC's own baseline. Data provider consensus for instruction relaying, inheriting Flare's full economic security.

**Why not normal smart contracts:** A normal contract receiving a trade signal makes it publicly visible in the mempool before execution, enabling frontrunning. There is no way to make copy trading MEV-resistant without execution-time privacy. FCC's TEE pattern is the only credible solution on Flare.

Mirror is not a copy trading app that happens to use a TEE. It is a product where confidential compute is the literal prerequisite for the product to function at all. That is the strongest possible answer to the bounty's core question.
