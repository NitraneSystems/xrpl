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
```

## Phase 0 + 1 Status

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

## Deployed on Coston2 (Phase 1)

| Contract | Address |
|----------|---------|
| MirrorRegistry | `0x89b97Abba29e8a9B6338EA635B50cfdb0C9d0749` |
| MirrorVault | `0x6Dcd79Bf9DEA6C6Da9790251A98476d393957ab9` |
| MirrorFee | `0x356BFCa4a31E324F8Ea27c52EF23004432dccc43` |
| MirrorLeaderboard | `0x824A6E2e3700112bb50c4551fB8c070FC8335b66` |
| InstructionSender | `0x76D00558EAd0D33Dc93911e40019947686D9A0b2` |

Verify on explorer (requires `FLARE_EXPLORER_API_KEY`):

```bash
npm run verify:coston2 -w contracts
```

See [docs/phaseImplementation.md](docs/phaseImplementation.md) and [docs/KNOWN-LIMITATIONS.md](docs/KNOWN-LIMITATIONS.md).
