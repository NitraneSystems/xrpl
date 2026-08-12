# Operator / Relayer Layer

Scripts for the operator layer (PRD §5.1):

| Script | Phase | Purpose |
|--------|-------|---------|
| `tee-proxy.ts` | 3 | Public endpoint; forwards `/action`+`/state` to FCE; refuses plaintext signal dumps |
| `xrpl-monitor.ts` | 8 | Watches XRPL testnet for FSA payments; status API `:8787` |
| `fdc-payment.ts` | 8 | FDC Payment (`testXRP`) prepare → attest → DA proof |
| `fdc-proof-relayer.ts` | 5 | Submits EVMTransaction proofs post-execution |
| `fdc-web2json.ts` | 6 | Web2Json attestations (DeFiLlama TVL; `coingecko` arg for FXRP vol) |

```bash
npm run tee:proxy           # Phase 3 operator proxy → TEE_MATCHING_ENGINE_ENDPOINT
```

## Phase 8

```bash
npm run xrpl:monitor     # watch operator + status API
npm run fsa:canary       # XRPL payment + PersonalAccount + Mirror onboard
npm run fsa:malformed    # bad reference → no vault credit
```

Operator XRPL address from `MasterAccountController.getXrplProviderWallets()` (Coston2: `rEyj8nsHLdgt79KJWzXR5BgF7ZbaohbXwq`).
