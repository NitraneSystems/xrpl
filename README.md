# Mirror

Private copy trading on Flare, powered by FCC (Flare Confidential Compute).

## Quick Start

```bash
npm install --legacy-peer-deps
npm run provision:personas          # Generate testnet personas → config/accounts.testnet.json
npm run provision:faucet-checklist  # Print addresses to fund at faucet.flare.network/coston2
npm run smoke                       # Verify Coston2 RPC, registry, venue sanity
npm run compile                     # Compile Solidity contracts (cancun)
npm run test                        # Run unit + access-control + fuzz-style tests
npm run deploy:core                 # Deploy to Coston2 (requires funded deployer)
npm run deploy:venue                # MockSparkDexRouter + rewired Vault/Fee/Sender
npm run venues:swap-loop            # 21 FTSO-priced mock swaps
npm run venues:seed-blazeswap       # Phase 4B self-seeded BlazeSwap pool + one swap
npm run fdc:cycle                   # 10 live Coston2 FDC settlement cycles (slow; needs verifier key)
npm run e2e:load-followers          # Phase 11: 5-follower Stage B fan-out
npm run e2e:adversarial-plaintext   # Phase 11: ciphertext-only public surfaces
npm run demo:lifecycle              # Phase 11: one-command Coston2 demo (DEMO_SKIP_SLOW_FDC=1 optional)
```

Set `MIRROR_MOCK_VENUES=true` plus `MOCK_ENOSYS_CDP_ADDRESS` / `MOCK_FIRELIGHT_STRATEGY_ADDRESS` (see `.env.example`) to route CDP / Firelight signals through Phase 10 mocks.
## Phase 0–5 Status

- Monorepo layout with `contracts/`, `fce-matching-engine/`, `scripts/`, `config/`
- Coston2 personas in `config/accounts.testnet.json`
- Smoke script: `scripts/coston2-smoke.ts`
- CI: `.github/workflows/ci.yml` + address guard
- Core contracts: `MirrorRegistry`, `MirrorVault`, `MirrorFee`, `MirrorLeaderboard`, `InstructionSender`

## FCE Matching Engine (Phase 0)

`fce-matching-engine/` lives in this repo (vendored from [flare-foundation/fce-extension-scaffold](https://github.com/flare-foundation/fce-extension-scaffold)). It is the TEE matching-engine service, not a git submodule.

**Prerequisites:** Foundry, Go 1.25+, Docker, jq

```bash
cd fce-matching-engine
cp .env.example .env
# Set LANGUAGE=typescript if Go is unavailable
docker compose up --build
# In another terminal:
./scripts/test.sh
```

Set `TEE_MATCHING_ENGINE_ENDPOINT=http://localhost:6674` in `.env` and re-run `npm run smoke`.

## Deployed on Coston2 (Phase 1 + 4)

| Contract | Address |
|----------|---------|
| MirrorRegistry | `0x89b97Abba29e8a9B6338EA635B50cfdb0C9d0749` |
| MirrorVault | `0xF33222391fb153777c57C9e41a233D68E03Fe8c8` |
| MirrorFee | `0x9B57787a5E90373d943403cf2571362302C4A079` |
| MirrorLeaderboard | `0x824A6E2e3700112bb50c4551fB8c070FC8335b66` |
| InstructionSender | `0xEEE61189e46739fc06e1e12858dd4c88028d8CEd` |
| MockSparkDexRouter | `0x6F3A431c74Ef7Ff30ed93569D4e8A43466E7F9e1` |
| FtsoPriceReader | `0xa8190FED2eF7c2cbC843904F974ae4F9EaF1fEA1` |
| BlazeSwap USDT0/FXRP pair (self-seeded) | `0xa0B211953a3d8f42E82AfB01303933DdA5c434fe` |

Verify on explorer (requires `FLARE_EXPLORER_API_KEY`):

```bash
npm run verify:coston2 -w contracts
```

See [docs/phaseImplementation.md](docs/phaseImplementation.md), [docs/KNOWN-LIMITATIONS.md](docs/KNOWN-LIMITATIONS.md), and [docs/SUBMISSION.md](docs/SUBMISSION.md) (PRD §12 mapping).
