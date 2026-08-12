# Mirror — Bounty Submission (PRD §12)

This document maps each Flare Confidential Compute bounty question from [mirror-prd.md](./mirror-prd.md) §12 to **named passing tests and scripts** in this repo. For deferred venues and honest stand-ins, see **[KNOWN-LIMITATIONS.md](./KNOWN-LIMITATIONS.md)** (also summarized below).

## Known Limitations (read first)

MVP on Coston2 deliberately mocks or defers several PRD §3 venues:

| Item | Status |
|------|--------|
| SparkDEX spot V3 | `MockSparkDexRouter` — no Coston2 bytecode |
| BlazeSwap FXRP/USDT0 | Self-seeded test LP — not third-party depth |
| Mainnet `SwapRouter` | Chain ID 14 only — do **not** use on Coston2 |
| FBTC | Unconfirmed on Coston2 |
| Kinetic | `MockKineticPool` |
| Enosys | `MockEnosysCDP` (Enosys tests on Coston/Songbird, not Coston2) |
| Firelight | Real vault `0xC90D…0361` recorded; MVP uses `MockFirelightStrategy` (passive staking deferred) |
| FCC tooling | Bleeding-edge; APIs/tooling may shift |

Full table: [KNOWN-LIMITATIONS.md](./KNOWN-LIMITATIONS.md). Independent reviewers: re-run the scripts cited below on a clean checkout with funded Coston2 personas.

---

## PRD §12 → proof

### 1. What’s private (runs inside the TEE)

Lead trade intent, matching/sizing, and AI analysis stay off public surfaces.

| Proof | Command / artifact |
|-------|-------------------|
| Adversarial plaintext leak suite | `npm run e2e:adversarial-plaintext` |
| Client RSA-OAEP encrypt UI | Frontend `/signal` + Playwright `npm run e2e:coston2` |
| Outcome-log design (no signal body) | `fce-matching-engine/typescript/src/app/outcomeLog.ts`; covered by adversarial suite |

Local smoke with `FCE_PLAINTEXT_DECRYPT_FALLBACK=1` is **out of scope** for the adversarial pass (dev-only decrypt stub).

### 2. What’s verified onchain

| Proof | Command / artifact |
|-------|-------------------|
| FDC settlement cycles | `npm run fdc:cycle` |
| AI scores + Web2Json attestation | `npm run ai:score-canary` |
| Leaderboard ACL / vault settlement | `npm run test` (Hardhat) — leaderboard + vault suites |
| FSA Payment attestation path | `npm run fsa:canary` |

### 3. Trust assumptions

| Proof | Where documented / exercised |
|-------|------------------------------|
| TEE / FCC attestation baseline | `fce-matching-engine/REPRODUCIBILITY.md`, `npm run fce:compare-hashes` → `config/fce-code-hashes.json`, `npm run tee:proxy` |
| FDC data-provider consensus | `scripts/relayer/fdc-*.ts`, `docs/KNOWN-LIMITATIONS.md` FCC row |
| PMW / InstructionSender gate | `contracts/src/InstructionSender.sol` + deploy on Coston2 |

### 4. Why not normal smart contracts

| Proof | Narrative |
|-------|-----------|
| Mempool frontrun risk | PRD §12 + `docs/SUBMISSION.md` (this file): plaintext signals in a public contract are frontrunnable |
| Demo narrative | `npm run demo:lifecycle` walks encrypt → Stage B → FDC/AI/FSA surfaces without exposing signal body onchain |
| Adversarial pass | `e2e:adversarial-plaintext` asserts Stage B calldata is opaque ciphertext |

---

## Phase 10–11 exit checklist

| Criterion | Command |
|-----------|---------|
| Enosys mock route | Matching-engine vitest `mockVenues.test.ts`; step 10 of `demo:lifecycle` |
| Load test ≥5 followers | `npm run e2e:load-followers` |
| Adversarial plaintext | `npm run e2e:adversarial-plaintext` |
| One-command demo | `npm run demo:lifecycle` (optional `DEMO_SKIP_SLOW_FDC=1` for faster dry-runs) |

Deployed Phase 10 mocks (Coston2): see `config/coston2.json` → `mockEnosysCDP`, `mockFirelightStrategy`, `firelightVaultReal`.

### Independent reviewer checklist

1. `npm install --legacy-peer-deps` && `npm run provision:personas`
2. Fund personas (faucet checklist)
3. `npm run e2e:adversarial-plaintext`
4. `npm run e2e:load-followers`
5. `cd fce-matching-engine/typescript && npm test`
6. `DEMO_SKIP_SLOW_FDC=1 npm run demo:lifecycle` then full run without skip when time allows
