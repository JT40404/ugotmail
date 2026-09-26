# U GOT MAIL

Send SOL (and USDC/USDT) to anyone's email on Solana. Each send goes into its own escrow wallet. The recipient gets an email, proves the inbox is theirs with a one-time code, and sends the funds to their wallet — or creates a new wallet right in the browser. Senders can cancel anytime before it's claimed, and unclaimed sends come back automatically.

It runs entirely on Vercel: static pages plus serverless functions in `/api`.

## How it works

1. **Send** — The sender connects Phantom, Solflare or Backpack. The server creates a fresh escrow keypair (encrypted with your `ESCROW_ENCRYPTION_KEY`) and builds a transfer to it. The sender approves it in their wallet.
2. **Notify** — Once the escrow is funded on-chain, the recipient gets an email with a claim link.
3. **Claim** — The recipient requests a 6-digit code (sent to the same inbox), enters it, picks a destination, and the server releases the escrow to that wallet.
4. **Cancel / return** — The sender signs a message with the same wallet to cancel. A daily job returns anything unclaimed after `RETURN_DAYS`.

## Setup (about 15 minutes)

### 1. Put it on GitHub

```bash
cd ugotmail
git init && git add . && git commit -m "U GOT MAIL"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/ugotmail.git
git push -u origin main
```

### 2. Import into Vercel

vercel.com → **Add New → Project** → pick the repo → Framework preset **Other** → leave build settings empty → **Deploy**. (The first deploy works but sending will fail until the next steps are done.)

### 3. Add the database

In your Vercel project: **Storage → Create → Upstash (Redis)** → connect it to this project. That adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.

### 4. Set up email

1. Sign up at resend.com and create an API key.
2. Add and verify your domain (Resend → Domains). Until you do, Resend only delivers to your own signup email — fine for a first test.
3. In Vercel add `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `U GOT MAIL <mail@yourdomain.com>`; for testing, `U GOT MAIL <onboarding@resend.dev>`).

### 5. Add the secrets

In Vercel → **Settings → Environment Variables**, add:

| Name | Value |
| --- | --- |
| `ESCROW_ENCRYPTION_KEY` | output of `openssl rand -base64 32` — **back this up**; losing it strands open escrows |
| `CRON_SECRET` | output of `openssl rand -hex 24` |
| `SOLANA_CLUSTER` | `devnet` to start |

See `.env.example` for the full list. Then **Deployments → ⋯ → Redeploy** so the new variables take effect.

### 6. Test on devnet

1. In Phantom: Settings → Developer settings → turn on Testnet mode → pick **Solana Devnet**.
2. Get free devnet SOL at faucet.solana.com (and devnet USDC at faucet.circle.com if you want to test USDC).
3. Send to your own email, claim it, try a cancel. The purple bar at the top means you're on devnet.

### 7. Go live on mainnet

1. Get a private RPC URL (Helius, QuickNode or Triton — the free tiers are fine to start) and set `SOLANA_RPC_URL`. The public mainnet RPC is heavily rate-limited.
2. Set `SOLANA_CLUSTER=mainnet-beta` and redeploy.
3. Send yourself a small amount first.

## Running locally

```bash
npm install
npx vercel dev      # needs the env vars in a local .env file
npm test            # runs the full send → claim → cancel → expire flow against mocks
```

## Things to know before real users

- **This is custodial.** Escrow keys are encrypted on your server, and whoever holds `ESCROW_ENCRYPTION_KEY` plus database access can move escrowed funds. Keep both locked down (limit who has Vercel access, turn on 2FA everywhere).
- **Email is the key.** Anyone who controls the recipient's inbox can claim. That's the product, but tell users.
- **Legal:** holding funds for others and transmitting them can require licensing (e.g. money transmitter rules in the US). Get advice before launching on mainnet.
- **Limits:** there's no per-IP rate limiting on creating sends yet; add Vercel Firewall rules if you see abuse. Vercel's free plan runs the return job once a day, so returns happen within a day of expiry.
- **Mobile:** sending needs a wallet in the browser, so on phones the page offers to open itself inside Phantom. Claiming works in any browser.

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `claim.html`, `status.html` | The three pages (home + send, claim, track/cancel) |
| `js/wallet.js` | Wallet connection and shared helpers |
| `js/send.js`, `js/claim.js`, `js/status.js` | Page logic |
| `api/send/*` | Create, confirm, status, cancel |
| `api/claim/*` | Info, request code, verify, withdraw |
| `api/cron.js` | Daily: late funding, email retries, stuck transfers, expired returns |
| `lib/` | Config, storage, encryption, Solana escrow, email templates |
| `test/flow.test.mjs` | End-to-end flow test with mocked Solana, Redis and email |
