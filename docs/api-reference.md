# API reference: check-in server

The Verapass API is a Hono app in `server/app.ts`. The same app runs as a Node server (`server/index.ts`, `npm run dev`) and as one Vercel function (`api/index.ts`). It serves the web app's check-in flow: traveller ids, one-time codes, check-ins with signed receipts, the on-chain record status, the test-mode pass purchase and the hidden places. It is not a public read API for stamps; for that, read the contract (see [integration-guide.md](integration-guide.md)).

Everything below is read from the code and was exercised against a local server in demo mode on 2026-10-10.

## Base URL and modes

| Where | Base URL | Mode |
|---|---|---|
| Local, `npm run dev` | `http://localhost:8787` (the Vite dev server on :5173 proxies `/api` to it) | demo unless keys are set |
| Hosted demo | `https://verapass.vercel.app` | demo payments, mock attestation |

`GET /api/health` tells you which mode a server runs in. Demo payments: no `STRIPE_SECRET_KEY`. Mock attestation: `STELLAR_SECRET` and `VERAPASS_CONTRACT_ID` are not both set; nothing is written on chain. Simulated check-ins: on by default only without a Stellar key and outside production.

## Conventions

- Request and response bodies are JSON. Send `content-type: application/json` on POSTs.
- Errors are JSON. Check-in flow errors have the shape `{ "error": "<code>", "message": "<text>" }`, plus `distanceM` (whole metres) for geofence refusals. A few routes return `{ "error": "<code>" }` without a message; they are marked below.
- No CORS headers are sent and every response carries `cross-origin-resource-policy: same-origin`, so a web page on another origin cannot read the API from a browser. Server-to-server calls work.
- Security headers on every response (Hono `secureHeaders`): `strict-transport-security`, `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, `referrer-policy: no-referrer`, `cross-origin-opener-policy: same-origin`, `cross-origin-resource-policy: same-origin`, `origin-agent-cluster`, `x-dns-prefetch-control: off`, `x-download-options: noopen`, `x-permitted-cross-domain-policies: none`, `x-xss-protection: 0`.
- Unknown `/api` paths answer 404.

## Traveller ids

Most calls carry a traveller id that only the server can issue: `trav_<16 hex>.<22-character base64url tag>`, where the tag is the first 16 bytes of HMAC-SHA256 over the id, keyed by `TRAVELLER_SECRET` (`server/identity.ts`). The server refuses ids it did not issue with `401 traveller-invalid`. This is not authentication: anyone can ask for a new id, which is why issuing them is rate limited per IP. Without a fixed `TRAVELLER_SECRET`, ids stop working when the server restarts.

The id holds the browser's pass, so treat it as a bearer credential. Check-in receipts and proof preimages never carry it: since 2026-10-10 they carry `anon_<32 hex>`, the first 16 bytes (hex) of HMAC-SHA256 over `verapass-receipt-pseudonym-v1|<id>`, keyed by the same secret. Every route refuses a pseudonym with `401 traveller-invalid`. The on-chain traveller address is still derived from the id itself, so it does not change.

## Limits

### Body size

| Routes | Limit | Over the limit |
|---|---|---|
| `POST /api/nonce`, `/api/checkin`, `/api/checkout` | 8 KB | `413 { "error": "too-large", "message": "The request body is too large." }` |
| `POST /api/webhook` | 64 KB | `413 { "error": "too-large" }` |

### Rate limits

Per client IP, sliding window (the current fixed window plus a weighted share of the previous one, `server/rateLimit.ts`). A refused request is not counted. The client IP is the socket address, or the last `X-Forwarded-For` entry (the one the proxy wrote) when `TRUST_PROXY=true`.

| Limiter | Routes | Default | Setting |
|---|---|---|---|
| traveller | `POST /api/traveller` | 30 per hour | `RATE_LIMIT_TRAVELLER_PER_HOUR` |
| nonce | `POST /api/nonce` | 60 per minute | `RATE_LIMIT_API_PER_MINUTE` |
| checkin | `POST /api/checkin` | 60 per minute | `RATE_LIMIT_API_PER_MINUTE` |
| checkout | `POST /api/checkout` | 60 per minute | `RATE_LIMIT_API_PER_MINUTE` |
| pass | `GET /api/pass/:sessionId` | 60 per minute | `RATE_LIMIT_API_PER_MINUTE` |
| read | `GET /api/attestation/:proofHash` and `GET /api/places/hidden`, counted together | 60 per minute | `RATE_LIMIT_API_PER_MINUTE` |
| place | real (not simulated) check-ins per place, across all travellers | 120 per minute | `RATE_LIMIT_PLACE_PER_MINUTE` |

Each limiter counts on its own. Over a per-IP limit the answer is `429 rate-limited` with a `Retry-After` header in seconds, until the current window ends (seen locally: the 30th traveller id in an hour was refused with `Retry-After: 1518`). Over the per-place limit the answer is `429 place-busy`. `GET /api/health` and `POST /api/webhook` are not rate limited.

### Server state

Nonces, passes, last fixes, rate-limit counts and attestation status live in this process's memory by default, with time-to-live values and size caps. Set a Redis-compatible REST endpoint (Upstash REST protocol) to share them between instances: `VERAPASS_REDIS_REST_URL` and `VERAPASS_REDIS_REST_TOKEN`, or the pairs `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` and `KV_REST_API_URL`/`KV_REST_API_TOKEN`, with an optional `VERAPASS_REDIS_PREFIX` (default `verapass:`). When the store cannot be reached, any route answers `503 { "error": "state-unavailable", "message": "The server could not reach its data store. Try again in a moment." }`.

## Routes

### GET /api/health

Server mode and the receipt public key.

```json
{"ok":true,"state":"memory","payments":"demo","attestation":"mock","contractId":null,"simulation":true,"receiptPublicKey":"MCowBQYDK2VwAyEAcnCi172iH7VACDSvxN6KGXzZeTWgUhSkozDLIF++BfE=","receiptKeyPersistent":false}
```

| Field | Values |
|---|---|
| `state` | `"memory"` or `"redis"` |
| `payments` | `"demo"` or `"stripe-test"` |
| `attestation` | `"mock"` or `"testnet"` |
| `contractId` | the `verapass_stamps` contract id in testnet mode, else `null` |
| `simulation` | whether simulated check-ins are accepted |
| `receiptPublicKey` | base64 DER (SPKI) Ed25519 key that signs receipts |
| `receiptKeyPersistent` | `false` when the key was generated at startup and changes on restart |

### POST /api/traveller

Issues a traveller id. No body.

| Status | Body |
|---|---|
| 200 | `{ "traveller": "trav_f1a5fb07bee523fc.6rShYHIGmJFAEl9MRBhg7g" }` |
| 429 | `rate-limited` |

### POST /api/nonce

Issues a one-time check-in code bound to the traveller and the place. It is valid for 2 minutes.

Body: `{ "traveller": string, "placeId": string }`

| Status | Body |
|---|---|
| 200 | `{ "nonce": "9f18ecc44325f45757635f1a9232c38e", "placeId": "wat-chalong", "issuedAt": 1791614070092, "expiresAt": 1791614190092 }` (times in ms) |
| 400 | `bad-request`: invalid JSON, `traveller` not a string, or `placeId` not 1 to 128 characters of `[A-Za-z0-9_:.-]` |
| 401 | `traveller-invalid` |
| 403 | `pass-required`: a hidden place and no paid pass for this traveller |
| 413 | `too-large` |
| 422 | `unknown-place` |
| 429 | `rate-limited` |

### POST /api/checkin

Checks a location fix and, if it passes, returns a signed receipt and queues the on-chain record.

Body (`CheckinRequest`):

| Field | Type | Notes |
|---|---|---|
| `traveller` | string | server-issued id |
| `placeId` | string | |
| `nonce` | string | from `POST /api/nonce` |
| `lat`, `lng` | number | finite |
| `accuracy` | number | metres, finite |
| `deviceTs` | number | device clock, ms since epoch |
| `simulated` | boolean, optional | `true` for the "Demo: simulate being here" button |

The server checks, in this order, and stops at the first failure:

| Step | Refusal | Status |
|---|---|---|
| body shape (all fields above present and well formed) | `bad-request` | 400 |
| traveller id signature | `traveller-invalid` | 401 |
| `simulated: true` while simulation is off | `simulation-disabled` | 403 |
| place exists | `unknown-place` | 422 |
| hidden place needs a paid pass | `pass-required` | 403 |
| device clock within 5 minutes of server clock | `clock-skew` | 422 |
| coordinates valid (lat -90 to 90, lng -180 to 180, accuracy finite and not negative) | `invalid-coordinates` | 422 |
| accuracy 100 m or better | `low-accuracy` (with `distanceM`) | 422 |
| inside the place's radius (haversine distance) | `too-far` (with `distanceM`) | 422 |
| real check-ins only: a per-traveller lock, waited for up to 2 seconds | `rate-limited` | 429 |
| real check-ins only: travel speed since the traveller's last real fix (kept 24 hours) at most 250 km/h; fixes within 50 m always pass | `too-fast` | 422 |
| real check-ins only: per-place limit | `place-busy` | 429 |
| nonce not already used | `nonce-used` | 409 |
| nonce known | `nonce-unknown` | 422 |
| nonce not expired | `nonce-expired` | 422 |
| nonce issued for this traveller and place | `nonce-mismatch` | 422 |

The nonce is burnt last, so a refused fix (for example `low-accuracy`) can be retried with the same nonce inside its window. A used nonce cannot be replayed. Simulated check-ins skip the lock, the speed check and the per-place limit, and never update the traveller's last fix. Nonces and their "used" markers are kept for two windows (4 minutes); after that an old nonce reads as `nonce-unknown`. A burnt nonce's entry is also deleted, so a replay still fails if its "used" marker is ever lost.

Success:

| Status | When |
|---|---|
| 200 | the attestation settled within the wait (default 4 seconds): `attestation.status` is `confirmed` or `failed` |
| 202 | it did not: `attestation` is `{ "status": "pending" }`; poll `GET /api/attestation/:proofHash` |

Response body (`CheckinResponse`): `receipt`, `signature`, `publicKey`, `proof`, `attestation`. The fields, the signing rules and a full example are in [verify-a-receipt.md](verify-a-receipt.md).

Simulated check-ins always get a mock attestation, even when a Stellar key is set. Real check-ins get a mock attestation in mock mode, and in testnet mode a `stamp` on the `verapass_stamps` contract (after `activate_passport` if the traveller has no passport yet). A repeat visit to the same place returns the existing token with `alreadyStamped: true` and no new transaction. Contract refusals fail the attestation at once; network errors are retried twice with backoff (2 s, then 4 s) before the status becomes `failed`.

Example refusals seen locally:

```json
{"error":"nonce-used","message":"This check-in code was already used."}
{"error":"too-far","message":"You are not at this place yet.","distanceM":7023}
{"error":"bad-request","message":"The check-in request is missing fields."}
```

### GET /api/attestation/:proofHash

The status of the on-chain record for a check-in on this server. Statuses are kept for 24 hours.

| Status | Body |
|---|---|
| 200 | an `AttestationStatus`: `{ "status": "pending" }`, `{ "status": "failed", "message": "..." }` or `{ "status": "confirmed", "record": {...}, "signature": "..." }` |
| 400 | `{ "error": "bad-request" }` (no message): `proofHash` is not 64 lowercase hex characters |
| 404 | `{ "error": "not-found", "message": "No check-in with this proof hash on this server." }` |
| 429 | `rate-limited` |

### POST /api/checkout

Starts the pass purchase. Body: `{ "traveller": string }`.

Demo mode (no `STRIPE_SECRET_KEY`): the server records a paid demo pass for this traveller and returns

```json
{"mode":"demo","sessionId":"demo_ab626ebec8816974","url":"http://localhost:5173/success?session_id=demo_ab626ebec8816974"}
```

Stripe test mode: the server creates a Checkout Session (`mode: "payment"`, one line item with inline `price_data`: the Phuket pass at 1900 cents USD, `client_reference_id` set to the traveller id) and returns `{ "mode": "stripe", "sessionId": "cs_...", "url": "<Stripe Checkout URL>" }`. Live keys (`sk_live_...`) are refused at startup.

The success and cancel URLs use the request's `Origin` header when it equals `PUBLIC_ORIGIN` or is `http://localhost:<port>` or `http://127.0.0.1:<port>`; otherwise `PUBLIC_ORIGIN`.

| Status | Body |
|---|---|
| 200 | as above |
| 401 | `traveller-invalid` (also for a missing or invalid body) |
| 413 | `too-large` |
| 429 | `rate-limited` |
| 502 | `{ "error": "checkout-failed", "message": "Could not start Stripe Checkout." }` or `"Stripe returned no Checkout URL."` |

### POST /api/webhook

Stripe webhook. Reads the raw body and verifies the `Stripe-Signature` header with `STRIPE_WEBHOOK_SECRET`.

| Status | Body |
|---|---|
| 200 | `{ "received": true }` |
| 400 | `{ "error": "webhook-not-configured", "message": "STRIPE_WEBHOOK_SECRET is not set." }` |
| 400 | `{ "error": "missing-signature" }` |
| 400 | `{ "error": "invalid-signature" }` |
| 413 | `{ "error": "too-large" }` |

On `checkout.session.completed` or `checkout.session.async_payment_succeeded` with `payment_status: "paid"`, the server records the pass as paid for the traveller in `client_reference_id`, once per Checkout Session id. Other event types are acknowledged and ignored. The webhook does not write to Stellar in v1: the passport is activated on chain at the traveller's first real stamp.

### GET /api/pass/:sessionId?traveller=...

Whether a pass is paid and belongs to the asking traveller. The success page polls it.

| Status | Body |
|---|---|
| 200 | `{ "sessionId": "...", "paid": true, "demo": true }` |
| 200 | `{ "sessionId": "...", "paid": false, "demo": false }`: unknown or unpaid |
| 400 | `{ "error": "bad-request" }` (no message): `sessionId` not 1 to 128 characters of `[A-Za-z0-9_:.-]` |
| 401 | `traveller-invalid` |
| 403 | `{ "error": "pass-not-yours", "message": "This pass was bought with another passport." }` |
| 429 | `rate-limited` |

When Stripe is configured and the session id starts with `cs_` but the server has no record (webhook missed, or a restart), it asks Stripe with `checkout.sessions.retrieve`. A paid pass without a valid traveller id is claimed by the first traveller who opens the success page.

### GET /api/places/hidden?traveller=...

Names, coordinates and tips of the hidden places, for a traveller with a paid pass. These details are not in the web bundle; they live in `server/places.ts`.

| Status | Body |
|---|---|
| 200 | `{ "places": { "<placeId>": { "name": string, "area": string, "lat": number, "lng": number, "tip": string } } }` |
| 401 | `traveller-invalid` |
| 403 | `pass-required` |
| 429 | `rate-limited` |

## Error codes

| Code | Status | Message |
|---|---|---|
| `bad-request` | 400 | The check-in request is missing fields. (no message on the attestation and pass routes) |
| `traveller-invalid` | 401 | This passport id was not issued by this server. Reload the page to get a new one. |
| `simulation-disabled` | 403 | Simulated check-ins are turned off on this server. |
| `pass-required` | 403 | This is a hidden place. It opens with the Phuket pass. |
| `pass-not-yours` | 403 | This pass was bought with another passport. |
| `not-found` | 404 | No check-in with this proof hash on this server. |
| `nonce-used` | 409 | This check-in code was already used. |
| `too-large` | 413 | The request body is too large. (no message on the webhook) |
| `unknown-place` | 422 | This place is not on the Verapass map. |
| `nonce-unknown` | 422 | This check-in was not started by the server. Try again. |
| `nonce-expired` | 422 | The check-in window (2 minutes) closed. Try again. |
| `nonce-mismatch` | 422 | This check-in code belongs to another place or traveller. |
| `clock-skew` | 422 | Your device clock is too far from the server clock. |
| `invalid-coordinates` | 422 | The location fix is not valid. |
| `too-far` | 422 | You are not at this place yet. |
| `low-accuracy` | 422 | Your GPS fix is too rough to prove you are here. Step outside and try again. |
| `too-fast` | 422 | This is too far from your last check-in for the time that passed. |
| `rate-limited` | 429 | Too many requests from your connection. Wait a minute and try again. |
| `place-busy` | 429 | This place is getting more check-ins than people can make. Try again in a minute. |
| `checkout-failed` | 502 | Could not start Stripe Checkout. / Stripe returned no Checkout URL. |
| `webhook-not-configured` | 400 | STRIPE_WEBHOOK_SECRET is not set. |
| `missing-signature` | 400 | (none) |
| `invalid-signature` | 400 | (none) |
| `state-unavailable` | 503 | The server could not reach its data store. Try again in a moment. |

Any other unhandled error answers `500` with the text `Internal Server Error`.

## Try it with curl

Against a local server (`npm run dev:api`, port 8787). The coordinates are a few metres from Wat Chalong's public check-in point in `shared/places.ts`.

```bash
A=http://localhost:8787
T=$(curl -s -X POST $A/api/traveller | node -pe 'JSON.parse(require("fs").readFileSync(0)).traveller')
N=$(curl -s -X POST $A/api/nonce -H 'content-type: application/json' \
  -d "{\"traveller\":\"$T\",\"placeId\":\"wat-chalong\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).nonce')
curl -s -X POST $A/api/checkin -H 'content-type: application/json' -d "{
  \"traveller\":\"$T\",\"placeId\":\"wat-chalong\",\"nonce\":\"$N\",
  \"lat\":7.8468,\"lng\":98.3370,\"accuracy\":12,\"deviceTs\":$(date +%s)000,\"simulated\":true}" > response.json
node verify-receipt.mjs response.json "$(curl -s $A/api/health | node -pe 'JSON.parse(require("fs").readFileSync(0)).receiptPublicKey')"
```

`verify-receipt.mjs` is in [verify-a-receipt.md](verify-a-receipt.md).

## Planned API changes (grant-funded, not built)

- T1 (D1.2): the Stripe webhook has the passport-issuer key call `activate_passport` at payment time; `charge.refunded` and `charge.dispute.created` call `deactivate_passport`; free-place check-ins stop creating passports.
- T1 (D1.3): Postgres as the durable system of record: a check-in ledger with no time-to-live and an attestation outbox, so an attestation queued on an instance that stops is resumed by another. The shared Redis REST store with its atomic nonce burn already exists (see "Server state" above) and stays the short-lived store.
- T1 (D1.1, D1.4): the traveller's wallet signs the stamp; the check-in flow returns what the wallet needs to sign.
- T2 (D2.3): a rotating on-site code at high-value places and a per-address rate limit.
- T3 (D3.2): a separate public read API backed by an indexer, for stamps, per-place counts and creator status.
