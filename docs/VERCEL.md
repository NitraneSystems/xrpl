# Deploy Mirror on Vercel

**Vercel hosts the Next.js web app only.** Smart contracts already live on Coston2. Matching engine / FCC TEE / XRPL monitor are *not* Vercel apps (they are long-running or TEE processes).

After this deploy you can test the product in the browser at `https://your-app.vercel.app` — MetaMask talks to Coston2 directly. You do **not** need the extra local terminals for discovery, onboard, deposit, signal submit, portfolio, or withdraw.

| Piece | Where it runs |
|-------|----------------|
| UI (`frontend/`) | **Vercel** |
| Alerts (`/api/alerts`) | **Vercel** (same app) |
| Registry / Vault / Leaderboard / InstructionSender | **Coston2** (already deployed) |
| Matching-engine FCE | [Google Cloud Run](./CLOUD-RUN.md) from [NitraneSystems/matching](https://github.com/NitraneSystems/matching) |
| XRPL monitor | [Google Cloud Run](./CLOUD-RUN.md) from [NitraneSystems/xrpl](https://github.com/NitraneSystems/xrpl) |

---

## 1. Push the repo to GitHub

If this folder is not already a GitHub repo:

```powershell
cd c:\Users\MSI\Desktop\mirror
git remote -v
```

If there is no `origin`, create a repo on GitHub then:

```powershell
git add -A
git status
# commit if you have uncommitted work, then:
git push -u origin HEAD
```

---

## 2. Create the Vercel project

1. Go to [https://vercel.com/new](https://vercel.com/new)
2. Import the **mirror** GitHub repository
3. Set:

| Setting | Value |
|---------|--------|
| Framework Preset | Next.js |
| **Root Directory** | `frontend`  ← click Edit, type `frontend` |
| Build Command | `npm run build` (default) |
| Install Command | `npm install --legacy-peer-deps` |
| Output | default (Next.js) |

Do **not** set root to the repo root — that is a monorepo and the Next app lives in `frontend/`.

---

## 3. Environment variables (Vercel → Project → Settings → Environment Variables)

Add these for **Production**, **Preview**, and **Development**.

Copy from `frontend/.env.local` (public contract addresses + TEE **public** key — not private keys).

```
NEXT_PUBLIC_FLARE_RPC_URL=https://coston2-api.flare.network/ext/C/rpc
NEXT_PUBLIC_MIRROR_REGISTRY_ADDRESS=0xfF4f9a603ebd126Db2BEc88A88a0fae6B2fB8065
NEXT_PUBLIC_MIRROR_VAULT_ADDRESS=0x283aA87660cB02D1ffcEDd028B401766C076BdB4
NEXT_PUBLIC_MIRROR_FEE_ADDRESS=0x8941c5ecA5Be7509Adf77e73A69187454Fcf1dEC
NEXT_PUBLIC_MIRROR_LEADERBOARD_ADDRESS=0x9cBcDf16521b3705687349278990015886c957c9
NEXT_PUBLIC_INSTRUCTION_SENDER_ADDRESS=0xf082D53B50D08f0fdC06B0B4C6A1932DB589d91f
NEXT_PUBLIC_MIRROR_FSA_ONBOARDER=0x899921CB2d74B45BDC95baC8b8675757dE952671
NEXT_PUBLIC_MIRROR_HEALTH_AUTH=0xe7eBb372Ef34119874f55d2132e1f3F651e23612
NEXT_PUBLIC_MOCK_KINETIC_POOL=0x6ce64f1F6D60198281a4eA0aA639cAA10202554A
NEXT_PUBLIC_MASTER_ACCOUNT_CONTROLLER=0x434936d47503353f06750Db1A444DBDC5F0AD37c
NEXT_PUBLIC_FXRP_ADDRESS=0x0b6A3645c240605887a5532109323A3E12273dc7
NEXT_PUBLIC_XRPL_OPERATOR_ADDRESS=rEyj8nsHLdgt79KJWzXR5BgF7ZbaohbXwq
NEXT_PUBLIC_MIRROR_ALERTS_URL=/api/alerts
NEXT_PUBLIC_TEE_ENCRYPT_PUBKEY=<paste from frontend/.env.local>
```

After Cloud Run is up ([docs/CLOUD-RUN.md](./CLOUD-RUN.md)), set:

```
NEXT_PUBLIC_XRPL_MONITOR_URL=https://YOUR-xrpl-monitor.run.app
NEXT_PUBLIC_MATCHING_ENGINE_URL=https://YOUR-matching-engine.run.app
```

No trailing slash. Redeploy Vercel after adding them.

**Do not** put `PERSONA_*_PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY` on Vercel. Wallets sign in the browser via MetaMask.

---

## 4. Deploy

Click **Deploy**. Wait for the build to succeed. You get a URL like:

`https://mirror-xxxx.vercel.app`

Redeploy after changing env vars (Vercel → Deployments → Redeploy, or push a commit).

---

## 5. Test the live site (this replaces the extra terminals)

You still need **MetaMask + faucet funds**. You do **not** need `npm run dev`, matching-engine `npm start`, or `ai:alert-webhook` for this UI path.

1. Open the Vercel URL  
2. MetaMask → Coston2 (chain ID **114**)  
3. Import **lead-trader-1** and **follower-evm-1** (keys from local `.env` only)  
4. **Lead:** `/lead/onboard` → Register  
5. **Follower:** `/follower/onboard` → lead address `0x03182be182be76F11D1d136574190708844aE079`, deposit e.g. `10` FXRP (6 decimals — type `10`, not a tiny fraction)  
6. `/portfolio` — balance + AI scores (canary already published scores)  
7. **Lead:** `/signal` — encrypt + submit on-chain  
8. **Follower:** `/withdraw` — request withdrawal  

Signal tx going on-chain is expected. Full TEE decrypt → swap fill only happens if the matching-engine FCE is registered on Coston2 FCC (not Vercel).

---

## 6. Optional extras (not Vercel)

| Want | How |
|------|-----|
| Live XRPL stepper tracking | Run `npm run xrpl:monitor` on a VPS/Railway, set `NEXT_PUBLIC_XRPL_MONITOR_URL` to that HTTPS URL, redeploy |
| TEE matching of signals | `fce-matching-engine` Docker / FCC register (see `fce-matching-engine/README`) |
| FDC 10-cycle settlement | Local: `npm run fdc:cycle` (uses `.env` FDC key + deployer gas) |
| AI score refresh | Local: `npm run ai:score-canary` |

---

## CLI alternative

```powershell
cd c:\Users\MSI\Desktop\mirror\frontend
npx vercel login
npx vercel --prod
```

When prompted, set root to `frontend` if you run from the repo root instead.
