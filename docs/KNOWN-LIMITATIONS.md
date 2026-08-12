# Known Limitations on Testnet

This document lists venues and features explicitly deferred or mocked on Coston2 (chain ID 114), per [phaseImplementation.md](./phaseImplementation.md).

## Deferred / Mocked (not real on Coston2 for MVP)

| Venue / Feature | Status | Reason |
|-----------------|--------|--------|
| **SparkDEX spot V3** | Mocked (Phase 4) | `SwapRouter`, `V3Factory`, FXRP/USDT0 pool have no bytecode on Coston2 |
| **BlazeSwap FXRP/USDT0** | Liquidity-starved | No direct pool; FXRP pools are dust unless self-seeded (Phase 4B optional) |
| **Kinetic** | Mocked (Phase 10) | Mainnet-only per current contract docs |
| **Enosys** | Mocked (Phase 10) | Testnet on Coston (Songbird), not Coston2 |
| **FBTC market** | Unconfirmed | Not verified on Coston2 |
| **Flare mainnet SparkDEX spot** | Deferred | Real execution on chain ID 14 only |
| **Songbird canary FCC** | Deferred | Out of MVP scope |
| **FSA XRPL path** | Phase 8 | Not in Phase 0–1 scope |
| **Firelight** | Real on Coston2 but out of MVP | Passive staking tier deferred to Phase 10 |

## Real on Coston2 (used or planned)

- FTSO v2, FDC, FAssets/FXRP, Flare Smart Accounts, FCC/FCE
- Firelight vault (`0xC90D6847747b85d1fa2E07859869fb9fB72c0361`) — real but MVP-deferred
- BlazeSwap factory/router — deployed; insufficient FXRP/USDT0 liquidity for copy-trading fills

## Verification method

Venue state verified via `eth_getCode` / `eth_call` against Coston2 RPC (`https://coston2-api.flare.network/ext/C/rpc`), August 2026 — not docs alone. See Appendix A in phaseImplementation.md.
