# Deploy scripts

Numbered Hardhat deploys live under [`contracts/scripts/`](../../contracts/scripts/):

| Script | Phase |
|--------|-------|
| `01-deploy-core.ts` | 1 |
| `02-verify-core.ts` | 1 |
| `03-deploy-venue.ts` | 4 |
| `04-deploy-phase89.ts` | 8–9 |
| `05-deploy-phase10.ts` | 10 |

Run from repo root:

```bash
npm run deploy:core
npm run deploy:venue
npm run deploy:phase89
npm run deploy:phase10
```

Requires funded deployer in `.env` (see `npm run provision:faucet-checklist`).

CI address guard scans `contracts/scripts` (this folder is documentation only).
