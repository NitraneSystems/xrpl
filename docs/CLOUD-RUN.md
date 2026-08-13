# Google Cloud Run — matching engine + XRPL monitor

Two HTTP services. After they are live, paste the HTTPS URLs into Vercel env (see bottom).

Build **from the repo root**. Cloud Run is wired to **two copies of this same monorepo** (full codebase in each — Dockerfiles pick the service):

| Service | GitHub (Cloud Run source) | Dockerfile |
|---------|---------------------------|------------|
| Matching engine | [NitraneSystems/matching](https://github.com/NitraneSystems/matching) | `deploy/cloudrun/matching-engine.Dockerfile` |
| XRPL monitor | [NitraneSystems/xrpl](https://github.com/NitraneSystems/xrpl) | `deploy/cloudrun/xrpl-monitor.Dockerfile` |

Canonical app repo remains [Marshal-AM/mirror](https://github.com/Marshal-AM/mirror). Push `main` to all three when deploying:

```bash
git push origin main
git push matching main
git push xrpl main
```

Remotes:

- `origin` → `https://github.com/Marshal-AM/mirror.git`
- `matching` → `https://github.com/NitraneSystems/matching.git`
- `xrpl` → `https://github.com/NitraneSystems/xrpl.git`

In Cloud Run “continuously deploy from GitHub”, connect those two NitraneSystems repos and set the Dockerfile path above. Do **not** put `.env` private keys in GitHub — use Cloud Run env/secrets.

---

## Matching engine

**Dockerfile:** `deploy/cloudrun/matching-engine.Dockerfile`  
**Health:** `GET /health`  
**Action:** `POST /action`

Cloud Run sets `PORT`. Do not set `EXTENSION_PORT` unless you also map it to `PORT`.

### Env vars to paste (Cloud Run → Edit & deploy → Variables)

```
FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc
EXECUTION_VENUE=mock-sparkdex
MOCK_SPARKDEX_ROUTER_ADDRESS=0x6F3A431c74Ef7Ff30ed93569D4e8A43466E7F9e1
MIRROR_MOCK_VENUES=true
MOCK_ENOSYS_CDP_ADDRESS=0xB2f32371D761F52895E697C8b2910098cf57FA60
MOCK_FIRELIGHT_STRATEGY_ADDRESS=0xa652DFD628be13feC4D56710D1cf281692deCE02
C2_FXRP_ADDRESS=0x0b6A3645c240605887a5532109323A3E12273dc7
C2_USDT0_ADDRESS=0xC1A5B41512496B80903D1f32d6dEa3a73212E71F
BLAZESWAP_ROUTER_ADDRESS=0x8D29b61C41CF318d15d031BE2928F79630e068e6
FCE_PLAINTEXT_DECRYPT_FALLBACK=1
```

Leave `SIGN_PORT` **unset** on Cloud Run (no tee-node). Fallback lets Stage B size/calldata work for demos. Real enclave decrypt is FCC, not this container.

Optional: `TEE_INTERNAL_TOKEN` if you expose `/internal/outcome-log`.

### gcloud (example)

```bash
gcloud run deploy mirror-matching-engine \
  --source . \
  --dockerfile deploy/cloudrun/matching-engine.Dockerfile \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --set-env-vars "FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc,EXECUTION_VENUE=mock-sparkdex,MOCK_SPARKDEX_ROUTER_ADDRESS=0x6F3A431c74Ef7Ff30ed93569D4e8A43466E7F9e1,MIRROR_MOCK_VENUES=true,MOCK_ENOSYS_CDP_ADDRESS=0xB2f32371D761F52895E697C8b2910098cf57FA60,MOCK_FIRELIGHT_STRATEGY_ADDRESS=0xa652DFD628be13feC4D56710D1cf281692deCE02,C2_FXRP_ADDRESS=0x0b6A3645c240605887a5532109323A3E12273dc7,C2_USDT0_ADDRESS=0xC1A5B41512496B80903D1f32d6dEa3a73212E71F,BLAZESWAP_ROUTER_ADDRESS=0x8D29b61C41CF318d15d031BE2928F79630e068e6,FCE_PLAINTEXT_DECRYPT_FALLBACK=1"
```

If `--dockerfile` is unsupported in your gcloud version, build + push an image then `--image`:

```bash
gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/REPO/mirror-matching-engine \
  --file deploy/cloudrun/matching-engine.Dockerfile
```

---

## XRPL monitor

**Dockerfile:** `deploy/cloudrun/xrpl-monitor.Dockerfile`  
**Health:** `GET /health`  
**UI:** `GET /status/:xrplAddress` · `POST /process`

### Required Cloud Run settings (not optional)

| Setting | Value | Why |
|---------|--------|-----|
| CPU allocation | **Always allocated** | Keeps XRPL WebSocket alive with no HTTP traffic |
| Minimum instances | **1** | Do not scale to zero |
| Timeout | **3600** | Long-lived process |
| Ingress | All / unauthenticated | Vercel browser calls it |

### Env vars to paste

Secrets (operator key — Cloud Run Secret Manager preferred):

```
FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc
FDC_VERIFIER_URL=https://fdc-verifiers-testnet.flare.network
FDC_VERIFIER_API_KEY=00000000-0000-0000-0000-000000000000
FDC_DA_LAYER_URL=https://ctn2-data-availability.flare.network
XRPL_TESTNET_RPC_URL=wss://s.altnet.rippletest.net:51233
XRPL_OPERATOR_ADDRESS=rEyj8nsHLdgt79KJWzXR5BgF7ZbaohbXwq
MASTER_ACCOUNT_CONTROLLER=0x434936d47503353f06750Db1A444DBDC5F0AD37c
PERSONA_OPERATOR_RELAYER_PRIVATE_KEY=0x...   # from local .env — never commit
FSA_STATUS_DIR=/tmp/mirror-fsa-status
```

`PERSONA_OPERATOR_RELAYER_PRIVATE_KEY` pays gas for `executeInstruction` on Coston2. That wallet must have **C2FLR**.

### gcloud (example)

```bash
gcloud run deploy mirror-xrpl-monitor \
  --source . \
  --dockerfile deploy/cloudrun/xrpl-monitor.Dockerfile \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 3600 \
  --min-instances 1 \
  --no-cpu-throttling \
  --set-env-vars "FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc,FDC_VERIFIER_URL=https://fdc-verifiers-testnet.flare.network,FDC_VERIFIER_API_KEY=00000000-0000-0000-0000-000000000000,FDC_DA_LAYER_URL=https://ctn2-data-availability.flare.network,XRPL_TESTNET_RPC_URL=wss://s.altnet.rippletest.net:51233,XRPL_OPERATOR_ADDRESS=rEyj8nsHLdgt79KJWzXR5BgF7ZbaohbXwq,MASTER_ACCOUNT_CONTROLLER=0x434936d47503353f06750Db1A444DBDC5F0AD37c,FSA_STATUS_DIR=/tmp/mirror-fsa-status"
```

Add the private key as a **secret**, not a plaintext env var if you can:

```bash
echo -n "0xYOUR_OPERATOR_KEY" | gcloud secrets create xrpl-operator-key --data-file=-
gcloud run services update mirror-xrpl-monitor \
  --update-secrets=PERSONA_OPERATOR_RELAYER_PRIVATE_KEY=xrpl-operator-key:latest
```

---

## After deploy — Vercel env

Paste into Vercel (frontend) and **redeploy**:

```
NEXT_PUBLIC_XRPL_MONITOR_URL=https://mirror-xrpl-monitor-xxxxx.run.app
NEXT_PUBLIC_MATCHING_ENGINE_URL=https://mirror-matching-engine-xxxxx.run.app
```

No trailing slash.

| URL | Used by the Next.js app? |
|-----|---------------------------|
| XRPL monitor | **Yes** — `/follower/xrpl` status + process |
| Matching engine | Optional health / Stage B HTTP. Encrypted **signals still go on-chain** via InstructionSender. FCC would call `/action` if you register this URL as the extension; Cloud Run is **not** a TEE. |

---

## Console (no gcloud)

1. [Cloud Run](https://console.cloud.google.com/run) → **Create service** → **Continuously deploy from a repository** (or upload image).
2. Dockerfile path: `deploy/cloudrun/matching-engine.Dockerfile` or `.../xrpl-monitor.Dockerfile`.
3. Container port: **8080**.
4. Paste env vars above.
5. XRPL service: **CPU always allocated**, min instances **1**.
6. Allow unauthenticated invocations.
7. Copy the `*.run.app` URLs into Vercel.
