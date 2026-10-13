# Quickstart: run Verapass locally in demo mode

Goal: the web app and the check-in API running on your machine, a demo stamp in your passport, and its signed receipt checked, in under 15 minutes. Demo mode needs no keys, no Stellar account and no Stripe account. Nothing is written on chain.

Checked on 2026-10-10 against the repository `README.md` and the `package.json` scripts, on macOS with Node 22.22.

| Step | Time |
|---|---|
| 1. Prerequisites | 2 min |
| 2. Get the code and install | 3 to 5 min |
| 3. Start it | 1 min |
| 4. Walk through the demo | 4 min |
| 5. Check a receipt from the command line | 2 min |
| Optional: run the tests | 5 to 10 min more |

## 1. Prerequisites

- Node 22.12 or newer (`package.json` sets `"engines": { "node": ">=22.12.0" }`). Check with `node --version`.
- npm (ships with Node) and git.
- Free ports 5173 (web) and 8787 (API).

The Rust toolchain is only needed for the contract tests (optional, below).

## 2. Get the code and install

```bash
git clone [FOUNDER: public repository URL] verapass
cd verapass
npm install
```

`npm install` adds no global tools. Do not create a `.env` file: with none, the server runs in demo mode.

## 3. Start it

```bash
npm run dev
```

This runs the Vite dev server and the API together (`concurrently`, labelled `web` and `api`). Vite proxies `/api` to the API. You should see (shortened):

```text
[web]   VITE v8.3.4  ready in 91 ms
[web]   Local:   http://localhost:5173/
[api] [verapass] warning: RECEIPT_SIGNING_KEY is not set: receipts are signed with a new key on every start.
[api] [verapass] warning: TRAVELLER_SECRET is not set: traveller ids are only valid until the server restarts.
[api] [verapass] API on http://localhost:8787 - payments: demo mode, attestation: mock (nothing on chain), simulated check-ins: on, state: in memory (this process only)
```

The two warnings are expected in demo mode. Check the API:

```bash
curl -s http://localhost:5173/api/health
```

```json
{"ok":true,"state":"memory","payments":"demo","attestation":"mock","contractId":null,"simulation":true,"receiptPublicKey":"MCowBQYDK2VwAyEA...","receiptKeyPersistent":false}
```

`payments: "demo"`, `attestation: "mock"` and `simulation: true` mean demo mode. The key changes on every start.

## 4. Walk through the demo

Open http://localhost:5173.

1. Scroll to the map and pick a public place, for example Wat Chalong.
2. Press **Demo: simulate being here**. The browser asks the API for a one-time code (`POST /api/nonce`), then sends a fix a few metres from the place (`POST /api/checkin`). The fix goes through the same server checks as a real one (code, time window, geofence, accuracy) and skips only the travel-speed check.
3. The stamp lands in your passport, marked as a simulated visit, with "Mock tx ..., not on chain" instead of an explorer link.
4. In the passport, press **Check this stamp**. The `/verify` page recomputes the proof hash and checks the Ed25519 signatures in your browser, and compares the key with `/api/health`. The stamp travels in the URL fragment, which is never sent to a server.
5. Press **Get the Phuket pass**. In demo mode checkout goes straight to `/success?session_id=demo_...`; the server records a demo pass for your traveller id only, and the hidden places on the map unlock (`GET /api/places/hidden`).
6. **Reset demo passport** clears the stamps.

Things to try:

- Edit a stamp in the browser's `localStorage` (key `verapass:passport:v2`): it shows "Does not verify" and stops counting.
- Open the success link in another browser: it says the pass belongs to another passport.
- **Check in with my GPS** from far away: the server refuses it with "You are not at this place yet."

Each of these is an end-to-end test in `tests/e2e/app.spec.ts`.

## 5. Check a receipt from the command line

With `npm run dev` still running, in a second terminal (in any folder):

1. Save `verify-receipt.mjs` from [verify-a-receipt.md](verify-a-receipt.md#verify-with-node-no-dependencies). It uses only Node's built-in crypto.
2. Run the curl sequence from [api-reference.md](api-reference.md#try-it-with-curl). It gets a traveller id and a code, sends a simulated check-in to Wat Chalong, saves the response and verifies it against the key from `/api/health`.

Expected output:

```text
{
  proofHashMatches: true,
  receiptMatchesProof: true,
  signatureValid: true,
  keyMatches: true,
  attestationValid: true
}
simulated: true | mode: mock
```

Change any field of `receipt` in `response.json` and run it again: `signatureValid` turns `false`.

## Optional: run the tests

```bash
npm test                        # unit and integration tests (Vitest); the live testnet test is skipped
npx playwright install chromium # first e2e run on a new machine
npm run test:e2e                # Playwright: builds the app, starts its own servers on ports 4179 and 8797, always in demo mode
npm run lint
npm run typecheck
```

Contract tests need the Rust toolchain pinned in `contracts/rust-toolchain.toml` (Rust 1.93.0, target `wasm32v1-none`). `rustup` installs it for that folder only on first use, which takes several minutes the first time:

```bash
cd contracts && cargo test
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `npm install` prints an `EBADENGINE` warning | Node is older than 22.12. Upgrade Node before going on. |
| The page says "Could not reach the Verapass server. Is `npm run dev` running?" | The API is not running or port 8787 is taken. Free the port, or set `PORT` for the API and `API_PORT` for the Vite proxy to the same value. |
| "This passport id was not issued by this server" | The API restarted without a fixed `TRAVELLER_SECRET`, so old ids no longer verify. Reload the page to get a new one. |
| "Too many requests from your connection" | More than 30 new traveller ids per hour, or more than 60 calls per minute to one route, from your IP. Wait, or raise the limits with `RATE_LIMIT_TRAVELLER_PER_HOUR` and `RATE_LIMIT_API_PER_MINUTE`. |
| "Your device clock is too far from the server clock" | The device clock is more than 5 minutes off. |
| Old stamps show a different key after a restart | Expected without `RECEIPT_SIGNING_KEY`: the server makes a new key on every start. |

## Next steps

- [api-reference.md](api-reference.md): every route, body, status code and limit.
- [verify-a-receipt.md](verify-a-receipt.md): the receipt format and how to check it.
- [contract-interface.md](contract-interface.md) and [integration-guide.md](integration-guide.md): read real stamps from the testnet contract without running anything locally.
- Live mode (real stamps on testnet) needs the contract's attestor key and is described in the repository README under "Live mode". It is not needed to evaluate the project: the testnet contract can be read by anyone.
