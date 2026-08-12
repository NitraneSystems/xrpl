# Operator / Relayer Layer

Scripts for the operator layer (PRD §5.1):

| Script | Phase | Purpose |
|--------|-------|---------|
| `tee-proxy.ts` | 3 | Public endpoint; forwards signed instructions to FCE |
| `xrpl-monitor.ts` | 8 | Watches XRPL testnet for FSA payments |
| `fdc-proof-relayer.ts` | 5 | Submits EVMTransaction proofs post-execution |

**Status:** Stubs for Phases 3, 5, and 8.
