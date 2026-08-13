# Mirror frontend (Coston2)

Next.js 15 App Router + wagmi/viem against Flare Coston2.

## Setup

```bash
cp .env.local.example .env.local   # or use committed defaults in .env.local
npm install
npm run dev -w frontend
```

Production (Vercel): see [docs/VERCEL.md](../docs/VERCEL.md). Root Directory must be `frontend`.

Addresses default from `config/coston2.json` via `NEXT_PUBLIC_MIRROR_*`.

`NEXT_PUBLIC_TEE_ENCRYPT_PUBKEY` must be a base64 SPKI RSA public key. The signal page refuses to submit if it is missing (no plaintext fallback).

## Routes

| Route | Job |
|-------|-----|
| `/` | Discovery + Mirror hero |
| `/lead/onboard` | `registerLead` |
| `/lead/[address]` | Profile + follow |
| `/signal` | Encrypt → `sendMirrorMatchStageB` |
| `/follower/onboard` | Register, approve FXRP, deposit, follow |
| `/follower/xrpl` | XRPL Smart Account stepper (Xaman / CLI) |
| `/portfolio` | Vault balances + health badges |
| `/withdraw` | `requestWithdrawal` |

## Visual

Dark ink `#0B0F14`, mint `#3DFFB5`, Syne + DM Sans.

## Responsive checklist (manual)

- [ ] Hero brand + CTA readable at 375px
- [ ] Nav wraps without overflow
- [ ] Discovery table scrolls / stays legible
- [ ] Forms usable on mobile (no clipped controls)

## E2E (funded wallets)

```bash
# From repo root — uses PERSONA_* keys from root .env
npm run e2e:coston2 -w frontend
```

Not run in PR CI by default (needs faucet-funded personas).
