# Architecture

Verapass is an off-chain presence check plus an on-chain registry and non-transferable stamp ledger on Soroban. A licensed creator (the first is a TAT-licensed guide in Phuket) is entered in a public registry and publishes places. A traveller with an active passport checks in at a place from a phone; the Verapass API checks the reported position under a nonce, geofence, accuracy, time and speed rules and signs a receipt; the attestor key then mints one stamp per traveller per place on the `verapass_stamps` contract. Anyone can read the registry, the stamps and the per-place count without our database.

This page describes what runs today on Stellar testnet and what changes in each planned tranche. "Today" means the code in this repository on 2026-10-10. T1, T2 and T3 are the three delivery tranches of the plan (target dates 2027-02-05, 2027-03-26 and 2027-05-28); nothing marked with a tranche is built yet.

Related pages: [threat model outline](threat-model.md), [test plan](test-plan.md), [UI and flows](ui.md), [contract reference](../contracts/README.md), [testnet deployment record](../contracts/DEPLOYMENT.md), [security policy](../SECURITY.md).

This page is self-contained: the diagrams, the contract interface, the on-chain and off-chain split, the threat summary, the delivery plan and how to run it are all below. It assumes familiarity with Soroban authorization, storage TTLs and the Stellar Asset Contract.

## What a stamp means

A stamp means: the Verapass attestor accepted a check-in whose client-reported position was inside the place's geofence, under nonce, time and speed limits, for a traveller with an active passport. From T1 it also means the traveller's own wallet approved that stamp.

It does not mean "this person stood here". Browser GPS can be spoofed, and the [threat model](threat-model.md) lists what each defence does and does not stop. Public copy says "N verified check-ins", never "N real visitors".

## Why it exists

Travel content is cheap to fake and costly to check. Google says it blocked or removed 292 million policy-violating reviews on Maps in 2025 ([Search Engine Roundtable](https://www.seroundtable.com/google-maps-spam-fighting-2025-41176.html)), and Tripadvisor blocked 2.7 million fraudulent reviews in 2024, 214,000 of them AI-generated ([Hospitalitynet](https://www.hospitalitynet.org/news/4126305.html)); both act after the content is posted. AI-written guides now send people to places that do not exist ([Euronews](https://euronews.com/travel/2026/01/30/how-an-ai-generated-travel-website-sent-tourists-to-a-non-existent-hot-spring-attraction)). Verapass ties two things together in a form anyone can read on-chain: a licensed person vouches for a place, and each counted visit passed an on-site check under published rules.

## Properties

- The contract decides who may mint, one stamp per traveller per place, that a passport is active first, that stamps never transfer and that a revoked creator's places take no new stamps. These rules hold whatever the server does. (Today the testnet attestor also activates a free passport for a free-place check-in; from T1 only a separate issuer key activates passports, after a card payment or a capped booking.)
- Readable by anyone. The registry, stamps and per-place counts are contract reads and events. The Verapass API is a convenience, not the source.
- Honest about location. The location check runs off-chain on numbers the phone reports. The rules make faking slow, tied to an identity and visible; they do not make it impossible.
- Small on-chain footprint. No coordinates, names or card data on chain: a place carries a salted hash of its check-in point, a passport carries a hash of the payment session.
- Open source under Apache-2.0: the contract, the API, the web app and these docs are public in this repository today, and every grant deliverable (contract v2, protocol specs, SDK, indexer) ships here under the same licence.

## Why Stellar

- Soroban authorization carries the trust rules. Today `stamp` needs the attestor's `require_auth`; contract v2 adds the traveller's own `require_auth` in the same invocation, so one transaction proves two parties agreed (section 3).
- Public reads and events. Counts, stamps and the creator registry are contract reads and `stamped` / `place_added` events that anyone can query through Soroban RPC, stellar.expert or Hubble, without a Verapass account.
- Fees small enough to stamp every visit. Measured on testnet: about 0.66 XLM for a first stamp and 0.17 XLM for a passport activation, most of it rent for the new ledger entries (section 6).
- USDC through the Stellar Asset Contract (T2). The contract that counts a stamp also credits the creator, so pay can be checked against stamps. MoneyGram Ramps lists Thailand for USDC cash-out (section 5).
- Passkeys without seed phrases (T2): secp256r1 verification on-chain (CAP-51) and the passkey smart-account kits, with fees paid through OpenZeppelin Stellar Channels.
- attest.so already runs on Soroban, so stamps can be mirrored into a shared attestation format (section 8).

## Status

| | |
|---|---|
| Stage | Contract v1 deployed on Stellar testnet; check-in API, signed receipts and test-mode card checkout built; demo web app |
| Network | Stellar testnet, protocol 29, soroban-sdk 29.0.0 |
| Contract | `CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65` ([stellar.expert](https://stellar.expert/explorer/testnet/contract/CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65)); 1 creator (placeholder address), 10 places, 4 stamps, all team test visits |
| Tests | Vitest: 382 pass, 6 expected failures (2 undefended spoofing cases, each run on 3 store backends), 1 opt-in live testnet test skipped. 21 contract tests and 31 end-to-end tests pass ([test plan](test-plan.md)) |
| Track | Stellar Community Fund #46, Open Track |
| License | Apache-2.0 |
| Target | Mainnet launch in May 2027 (T3) |

## 1. System context

![System context: who touches the contract](diagrams/system-context.svg)

| Id | Component | Where | Today | Planned |
|---|---|---|---|---|
| A | Presence-check API (Hono) | off-chain | Nonce, geofence, accuracy cap, speed check, per-place and per-IP limits, Ed25519-signed receipts, HMAC-signed traveller ids. State in memory, or in a Redis-compatible REST store (Upstash or Vercel KV) when one is configured, for the hosted demo | Postgres as the durable system of record: a check-in ledger with no time-to-live, an attestation outbox that another instance resumes, an audit query (T1). The Redis REST store already shares state between instances, with an atomic nonce burn and two-instance tests |
| B | Attestor key | server | Testnet key signs `stamp` and `activate_passport`; separate from the admin | Signs `stamp` only. A separate passport-issuer key signs `activate_passport` and `deactivate_passport`. Both held as separate AWS KMS Ed25519 keys, rotation tested (T1) |
| C | Stripe Checkout | off-chain | Test mode: signed webhook marks the pass as paid | Refund and dispute events deactivate the passport on-chain (T1) |
| D | Admin key | Stellar account | Testnet CLI key: registry writes, attestor rotation, two-step admin transfer, upgrade | 2-of-3 multisig account on mainnet (T3) |
| E | Licensed creator | Stellar account | Placeholder address on testnet (see `contracts/DEPLOYMENT.md`) | Own account through a two-step registry (T1, T2); USDC credit claim (T2 testnet, T3 mainnet) |
| F | Traveller | phone browser | Server derives a pseudonymous address by HMAC; the traveller does not sign | Freighter co-signs on desktop (T1); passkey smart account on phones (T2) |
| G | attest.so | Soroban | Verapass stamp schema registered and one stamp mirrored by hand on testnet (section 8) | Every stamp mirrored automatically (T2) |
| H | Fee relay | off-chain service | The attestor pays every fee | OpenZeppelin Stellar Channels for passkey transactions, attestor-paid fallback (T2, mainnet in T3) |
| I | Readers | anyone | Direct RPC reads, stellar.expert, Stellar Lab | Indexer, read API, creator and place lookup page, published Hubble query (T3) |

Stripe never writes to Stellar. The server turns a verified webhook into a Soroban call.

### Data flow and trust boundaries

![Data flow and trust boundaries: phone, Verapass server, Stripe, admin machine and Stellar testnet, with what each arrow carries](diagrams/trust-boundaries.svg)

Four boundaries matter today. Everything the phone sends is untrusted input, checked by the API. Stripe is trusted only through a webhook signature over the raw body. The operator holds the attestor, receipt and HMAC secrets in the server environment, and the admin key on a separate machine. On Stellar, the contract enforces who may mint, one stamp per traveller per place and an active passport, whatever the server sends; it cannot check where a phone was. The same boundaries, with the attacks against each, are in [threat model section 3](threat-model.md#3-trust-boundaries-and-actors).

### Where the code lives

| Path | What it holds |
|---|---|
| `server/app.ts` | Hono routes: `/api/health`, `/api/traveller`, `/api/nonce`, `/api/checkin`, `/api/attestation/:hash`, `/api/checkout`, `/api/webhook`, `/api/pass/:id`, `/api/places/hidden`; security headers, body limits, per-IP limits |
| `server/config.ts` | Settings from the environment and the production self-check |
| `server/identity.ts` | HMAC-signed traveller ids, and the `anon_` pseudonym that receipts carry instead of the id |
| `server/nonce.ts`, `server/velocity.ts`, `server/rateLimit.ts` | Single-use nonces and clock skew, the 250 km/h speed check, sliding-window limits |
| `server/store.ts`, `server/redisStore.ts`, `server/bootstrap.ts` | State backends: in memory (default) or a Redis-compatible REST store shared by all instances (`SET NX` nonce burn, per-traveller lock); bootstrap picks one from the environment |
| `server/receipts.ts` | Ed25519 receipt signing, sha256 proof hashes |
| `server/attestor.ts`, `server/attestations.ts` | Mock and Soroban attestors; the background queue with retries and status per proof hash |
| `server/places.ts` | Hidden place details (server only) |
| `shared/geo.ts`, `shared/verify.ts` | Haversine geofence check; stamp verification that runs in the browser and in Node |
| `contracts/verapass_stamps/` | The Soroban contract and its tests |
| `contracts/scripts/` | Testnet deploy script and the geo-commitment generator |

## 2. Check-in to stamp

![One check-in, two signatures, one stamp](diagrams/checkin-sequence.svg)

| Step | What happens | Code today | Planned change |
|---|---|---|---|
| 0 | Card payment at Stripe Checkout; the verified webhook marks the pass as paid | `server/app.ts` webhook. The passport is activated lazily before the first stamp, with `payment_ref = sha256(Checkout Session id)`, or a free-passport ref for a free-place check-in | Issuer key activates at payment time; `charge.refunded` and `charge.dispute.created` call `deactivate_passport`; free-place check-ins stop creating passports (T1) |
| 1-2 | `POST /api/nonce`: single-use nonce, 2-minute window, bound to the traveller and the place. Hidden places need a paid pass | `server/nonce.ts` (memory or the shared Redis REST store, burnt with `SET NX`) | - |
| 3 | `POST /api/checkin` with lat, lng, accuracy, device time and the nonce. A real check-in holds a per-traveller lock while it reads the last fix, burns the nonce and records the new fix | `server/app.ts` | - |
| 4 | Checks in order: input shape, traveller id signature, simulation setting, place and pass, clock skew within 5 minutes, inside the radius, accuracy 100 m or better, speed under 250 km/h since the last real fix, per-place cap. Only then is the nonce burned, so a rough fix can be retried inside the window. The server signs an Ed25519 receipt over the proof hash | `shared/geo.ts`, `server/velocity.ts`, `server/rateLimit.ts`, `server/receipts.ts` | Rotating on-site QR code at high-value places; per-address limit (T2) |
| 5 | The traveller's wallet signs the `stamp` authorization; the arguments include the server nonce and the receipt hash, so the signature covers them | not built | Contract (T1), Freighter (T1), passkey (T2) |
| 6 | The attestor signs and submits `stamp(...)` as the transaction source, one host function call per transaction, one transaction at a time with a locally tracked sequence number | `server/attestor.ts`, `server/attestations.ts` | KMS signing (T1) |
| 7 | The contract rejects unless the attestor signed, `ts` is within 24 hours and not more than 5 minutes ahead (#11), the creator is active (#4), the passport is active (#8) and no stamp exists yet for this traveller and place (#10). It then writes the stamp, increments the place's `visits` and emits `stamped` | `contracts/verapass_stamps/src/lib.rs` | v2 adds traveller auth, the nonce argument and daily caps (T1) |
| 8 | The phone gets the signed receipt, the token id and the transaction hash. If Stellar is slow it gets 202 `pending` and polls `GET /api/attestation/:proofHash` | `server/app.ts`, `src/lib/` | The app reads stamps from the contract, not browser storage (T1) |

Simulated (demo) check-ins always get a clearly labelled mock record and never reach the chain.

## 3. Contract

`contracts/verapass_stamps` (soroban-sdk 29.0.0, wasm 14.7 KB, contract version 1). Testnet id `CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65`. Full function, storage and event reference: [contracts/README.md](../contracts/README.md).

![What the contract stores](diagrams/data-model.svg)

### Interface today (v1)

| Group | Functions | Auth |
|---|---|---|
| Roles | `admin`, `attestor`, `version`, `set_attestor`, `propose_admin`, `accept_admin`, `upgrade` | admin for writes; `accept_admin` by the pending admin |
| Registry | `add_creator`, `revoke_creator`, `add_place` | admin |
| Traveller flow | `activate_passport`, `stamp` | attestor |
| Reads | `has_stamp`, `get_stamp`, `stamps_of`, `place_visit_count`, `get_place`, `creator_of`, `get_creator`, `is_creator_active`, `is_passport_active` | none |
| NFT-style reads | `name`, `symbol`, `balance`, `owner_of`, `token_place` | none |
| Blocked | `transfer`, `transfer_from`, `approve` always return `#12 NonTransferable` | - |

Signatures as deployed (from `contracts/verapass_stamps/src/lib.rs`, `env: Env` left out):

```rust
// set once at deploy
fn __constructor(admin: Address, attestor: Address);

// roles (admin)
fn set_attestor(attestor: Address);
fn propose_admin(pending_admin: Address);
fn accept_admin() -> Result<(), Error>;            // signed by the pending admin
fn upgrade(new_wasm_hash: BytesN<32>);

// registry (admin)
fn add_creator(creator: Address, licence_hash: BytesN<32>) -> Result<(), Error>;
fn revoke_creator(creator: Address) -> Result<(), Error>;
fn add_place(place_id: String, creator: Address, geo_commitment: BytesN<32>) -> Result<(), Error>;

// traveller flow (attestor)
fn activate_passport(traveller: Address, payment_ref: BytesN<32>) -> Result<(), Error>;
fn stamp(traveller: Address, place_id: String, checkin_receipt_hash: BytesN<32>, ts: u64) -> Result<u32, Error>;

// reads (anyone)
fn admin() -> Address;
fn attestor() -> Address;
fn version() -> u32;
fn has_stamp(traveller: Address, place_id: String) -> bool;
fn get_stamp(traveller: Address, place_id: String) -> Option<StampRecord>;
fn stamps_of(traveller: Address) -> Vec<String>;
fn place_visit_count(place_id: String) -> Result<u32, Error>;
fn get_place(place_id: String) -> Option<PlaceRecord>;
fn creator_of(place_id: String) -> Result<Address, Error>;
fn get_creator(creator: Address) -> Option<CreatorRecord>;
fn is_creator_active(creator: Address) -> bool;
fn is_passport_active(traveller: Address) -> bool;
fn name() -> String;
fn symbol() -> String;
fn balance(owner: Address) -> u32;
fn owner_of(token_id: u32) -> Result<Address, Error>;
fn token_place(token_id: u32) -> Result<String, Error>;

// always Err(NonTransferable = 12)
fn transfer(from: Address, to: Address, token_id: u32) -> Result<(), Error>;
fn transfer_from(spender: Address, from: Address, to: Address, token_id: u32) -> Result<(), Error>;
fn approve(approver: Address, approved: Address, token_id: u32, live_until_ledger: u32) -> Result<(), Error>;
```

Errors: 1 NoPendingAdmin, 2 CreatorAlreadyRegistered, 3 CreatorNotFound, 4 CreatorRevoked, 5 PlaceAlreadyRegistered, 6 PlaceNotFound, 7 InvalidPlaceId, 8 PassportNotActive, 9 PassportAlreadyActive, 10 AlreadyStamped, 11 InvalidTimestamp, 12 NonTransferable, 13 StampNotFound.

The NFT-style read names follow SEP-50, a Draft standard that assumes transferable tokens. The contract has no `token_uri` and no `mint` event, so we do not claim SEP-50 compatibility or wallet display.

### Contract v2 (T1)

- `stamp(traveller, place_id, checkin_nonce, receipt_hash, ts)` calls `traveller.require_auth()` and needs the attestor in the same invocation. Verapass cannot mint a stamp for a wallet that did not approve it.
- A passport-issuer role, set by the admin and separate from the attestor: only the issuer calls `activate_passport` and `deactivate_passport`. A leaked attestor key then cannot create passports.
- `deactivate_passport`, `move_place`, and a two-step creator registry: the creator requests, a verifier approves, either side can revoke.
- A per-passport daily stamp cap and a contract-wide daily mint cap, with counters in temporary storage keyed by day.
- Fewer writes per stamp: one of `Token` or `StampsOf` is dropped and derived from events.
- Upgrade in place keeps the id and storage. The testnet reset on 2026-12-16 forces one redeploy first.
- T2: a creator USDC credit accrues inside the contract from a funded pool, capped at the pool balance and per place per day. The creator claims it to her own account (with her own USDC trustline) or to a contract wallet. The pool is funded outside the grant.

### Storage and lifetime

- Instance storage (admin, pending admin, attestor, next token id) shares the contract instance's TTL, and `instance().extend_ttl` also extends the Wasm code entry. Every admin or attestor call (and `accept_admin`) tops it back up to 30 days once fewer than 7 days remain. A quiet stretch can therefore archive the instance and the code after as little as 7 idle days, so T1 adds a scheduled `extend_ttl` job. On testnet both were extended by hand to about 2027-02-07 ([deployment record](../contracts/DEPLOYMENT.md#ttl-extension-2026-10-10)).
- Persistent entries (creator, place, passport, stamp, stamps-of, token) are extended to 120 days on each write once fewer than 30 days remain. Reads do not extend them. Mainnet's minimum persistent TTL is also 120 days, so cost is cut by writing fewer entries, not by shorter TTLs.
- Reads of an archived entry fail until it is restored. Since Protocol 23 restores are automatic when the entry is in the transaction's restore list; today `server/attestor.ts` does not send a restore: a simulation that asks for one is reported as a retryable error, retried by the queue, and the attestation fails once the retries run out. T1 adds and tests the restore path.
- One stamp touches about 7 entries of 148 to 300 bytes each, far below the per-transaction limits.

### Events

`creator_added`, `creator_revoked`, `place_added`, `passport_activated`, `stamped` (topics: traveller, place id), `attestor_changed`, `admin_proposed`, `admin_changed`, `upgraded`. Soroban RPC keeps about 7 days of events, so the indexer (T3) ingests continuously from deployment and backfills from an archive source; on mainnet a published Hubble query reproduces every count.

## 4. On-chain and off-chain data

| Data | On-chain | Off-chain |
|---|---|---|
| Creator | address, `licence_hash` (hash of the licence check), active flag | the licence document and the check itself |
| Place | id (short slug), creator, `geo_commitment`, visit count, time added | coordinates, radius, name, photos, tips (hidden places: server only) |
| Passport | traveller address, `payment_ref` = sha256 of the Checkout Session id or a free-passport ref | card data, session id, email, Stripe customer |
| Stamp | traveller address, place id, `checkin_receipt_hash`, check-in time, token id | the proof preimage (a pseudonym of the traveller id, nonce, lat, lng, accuracy, device and server time), kept by the traveller with the stamp |
| Traveller | an address derived by HMAC from the server-issued traveller id (today) or the traveller's own wallet (T1+) | the traveller id, the server's HMAC secret |

`geo_commitment` = sha256(`verapass-geo-v1|<id>|<lat>|<lng>|<radiusM>|<salt_hex>`), computed by `contracts/scripts/place-commitments.ts`. The 32-byte salt stops anyone from brute-forcing a hidden place's location out of its commitment. It is kept outside the repository. The privacy section of the [threat model](threat-model.md) covers what this does and does not hide.

## 5. Payments

- Stripe Checkout (test mode) charges the card. `checkout.session.completed` and `checkout.session.async_payment_succeeded` are verified against the raw body with the webhook secret, and fulfilment is idempotent per session. A missed webhook is covered by a Checkout Session lookup on the success page. A pass only opens for the traveller who paid. Live Stripe keys are refused.
- The on-chain `payment_ref` is sha256 of the Checkout Session id. Repeating `activate_passport` with the same ref is a no-op, so retries are safe; a different ref for an active passport returns `#9`.
- No card data and no session id reach the chain.
- Where the creator credit pool comes from (T2 onwards): test USDC on testnet. On mainnet the founders fund a pilot pool of about $1,100 in USDC until live card payments start; after that each top-up is the guide's share of card sales, converted to USDC by the operator. Neither is grant money. Credit per stamp is a contract parameter (pilot rate $1 USDC), and a reconciliation report ties each credit to a passport and a stamp.
- From T2 the creator's share moves as USDC on Stellar from the contract. The contract that counts a stamp also computes and pays its credit, capped per place per day, so the creator and any third party can check that every payout matches a stamp without relying on Verapass's payout records. Which check-ins count is still the attestor's call under the published check-in rules.
- Out of scope for the grant: live card payments, the payout entity, and paying the creator through Stripe Connect (self-serve cross-border payouts do not cover Thailand).
- Until a live payment entity exists, mainnet passports are booking passports. The creator submits a confirmed tour booking (reference and party size) and gets one seat code per seat; each traveller claims a seat from their own passkey wallet with a signed claim, and only then does the issuer key call `activate_passport`, with a hash of the booking reference plus the seat number as `payment_ref`. One passport per seat, one seat per wallet, at most 20 booking passports per creator per day, stamped only at the submitting creator's places. Stamps are reported split by passport source (card-paid or booking).
- Cash-out for the creator: MoneyGram Ramps lists Thailand as a USDC-on-Stellar cash-out country. MoneyGram runs its own KYC and a wallet that integrates its Ramps is needed. Not run end to end by us yet, and not part of the build.

## 6. Wallets and fees

| Path | When | Notes |
|---|---|---|
| Attestor is the transaction source and pays the fee | today, and the fallback later | Measured on testnet: about 0.66 XLM per stamp and 0.17 XLM per activation (fee charged per transaction in [contracts/DEPLOYMENT.md](../contracts/DEPLOYMENT.md#fees)). A repeat visit sends no transaction. Testnet figures, not a mainnet quote; mainnet fees are measured and published at launch (T3) |
| Freighter signs the traveller's authorization entry | T1 | desktop and test path |
| Passkey smart account (passkey-kit or `stellar/smart-account-kit`) | T2 | Face ID or fingerprint, no seed phrase, no XLM. secp256r1 is verified on-chain (CAP-51). The kits are unaudited; stamps carry no money for the traveller |
| OpenZeppelin Stellar Channels pays fees for passkey transactions | T2, mainnet in T3 if available | fallback: attestor-paid or a self-hosted OpenZeppelin Relayer |

## 7. Keys and roles

| Key | Can | Cannot | Protection |
|---|---|---|---|
| Admin | registry writes, set attestor, upgrade, propose a new admin | mint stamps | testnet: CLI key; mainnet: 2-of-3 multisig account (T3) |
| Attestor | `stamp` (today also `activate_passport`) | change the registry or upgrade; from T1, activate passports | testnet key in the server environment today; AWS KMS Ed25519 over the transaction hash from T1, rotation tested with `set_attestor` |
| Passport issuer (T1) | `activate_passport`, `deactivate_passport` after a card payment or a claimed booking seat | stamp, change the registry or upgrade | its own KMS key, separate from the attestor; rotation by the admin |
| Traveller wallet (T1) | approve its own stamp; claim a booking seat (T3) | mint without the attestor | Freighter, then passkey |
| Creator | request a registry entry (T1), claim credit (T2), submit bookings (T3) | mint, activate passports or change counts | own account |

A leaked attestor key today can activate passports and mint stamps for them. From T1 it cannot mint for an existing traveller's wallet without that wallet's approval, and it cannot create passports, so it cannot mint for fresh wallets either. Both keys are used by the same API service, so a full server compromise that yields both can still create sybil wallets, activate them and mint for them, bounded by the daily mint caps and the mint-rate alert until the admin rotates both keys. The off-chain keys (receipt signing, traveller HMAC, geo salt) are covered in the [threat model](threat-model.md#5-keys-and-secrets).

## 8. Composability with attest.so

attest.so is a Soroban attestation service, live on testnet (`CA2QET2KOUGAECEVYQEQT3SLDDZRUMAQHI7MMDTFVJY62WTHUTERAUCD`) and mainnet (`CAMZUXDEMJ4BDEA2FCTXPRQW3VPEJLFOV5IB3NKKJB2G4CV7ANHNSF2N`), ids from its `contracts/stellar/deployments.json`. Its protocol contract exposes `register(caller, schema_definition, resolver, revocable)` and `attest(attester, schema_uid, value, expiration_time)`.

Design: the attestor mirrors each confirmed stamp as an attest.so attestation under a Verapass stamp schema, in a separate transaction after the stamp confirms. Verapass stays the source of truth; the mirror lets attest.so readers see Verapass data.

Done by hand on testnet on 2026-10-09, signed by the Verapass testnet attestor:

- `register`: schema "Verapass stamp v0" (fields stampContract, traveller, placeId, tokenId, receiptHash, stampTx), schema uid `8de9e7e0ff5493c6554fb13bdaf10c174dd6e53a3d69fbb46e0ad327da6054d3`, [tx 6f0a58bf](https://stellar.expert/explorer/testnet/tx/6f0a58bf2bb699eb35d32e8d61970c898772af84445a5b97cf03084c01bc7fc9).
- `attest`: token 4 mirrored, attestation uid `d36ce3df50f64f7e31f36ec375c87c51693630caaa1f5e849647374957c566ba`, [tx 4a67c5aa](https://stellar.expert/explorer/testnet/tx/4a67c5aa9b342c0c6c25fb5dc5729b575593c46a9af8116ba45f9319d12e61ab).
- `get_attestation` on that uid returns the attestor as attester, the schema uid and the stamp data. attest.so sets the subject to the attester, so the traveller address is carried in the attestation value.
- Testnet fees: register 9.37 XLM (one-off, mostly storage), attest 0.066 XLM ([fee record](../contracts/DEPLOYMENT.md#fees)).

T2 automates this for every stamp. The 2026-12-16 testnet reset wipes attest.so's testnet contract too; if attest.so has not redeployed by then, we deploy their MIT-licensed protocol contract on testnet ourselves and mirror into it.

## 9. Indexing and public counts (T3)

- Ingest `stamped`, `place_added`, `creator_*` and `passport_activated` continuously from deployment.
- Read API: stamps per wallet, per-place counts, creator status. A public creator and place lookup page.
- Parity check: a published Hubble query returns the same counts as the API. The API is a convenience; the contract and its events are the source.

## 10. Failure modes

| Condition | Detection | Handling today | Planned |
|---|---|---|---|
| Nonce unknown, used, expired or for another place | nonce store | 422 or 409 with a plain message; the phone asks for a new nonce | - |
| Fix too rough (over 100 m) or outside the radius | geofence check | reject; the nonce is not burned, so the traveller can retry inside the window | - |
| Speed over 250 km/h since the last real fix | velocity check | reject `too-fast`; a per-traveller lock (shared across instances with the Redis REST store) makes two parallel check-ins take turns, so they cannot both pass | - |
| RPC slow or failing at submit | attestation queue | check-in answers 202 `pending`; network errors are retried; status by proof hash | - |
| Instance stopped with an attestation still queued | none: the queue is in the instance's memory, and on Vercel work after the response is not guaranteed (`waitUntil` is not used, and Vercel cancels it at the function timeout anyway) | the signed receipt stands; the record stays `pending` | attestation outbox in Postgres, resumed by another instance; the contract's one-stamp rule makes a resend safe (T1) |
| Contract refuses (unknown place, revoked creator, bad time) | contract error code | attestation fails at once, no retry; the check-in and its signed receipt stand | - |
| Repeat stamp | contract `#10` | the attestor reads the existing stamp and returns it, with no new transaction | - |
| Passport not active | contract `#8` | the attestor activates first | activation at payment time (T1) |
| Instance or code archived after an idle stretch (topped up to 30 days only when under 7 days remain) | `stellar contract read` shows the live-until ledger | not handled; on testnet both were extended by hand to about 2027-02-07 | scheduled `extend_ttl` job (T1) |
| Persistent entry archived | simulation asks for a restore | treated as a failure | restore path, tested on a local network (T1) |
| Testnet reset (2026-12-16) | scheduled | redeploy with `contracts/scripts/deploy-testnet.sh`, new id published the same day | - |
| Stripe webhook retried | same session id | idempotent server side; the same `payment_ref` is a no-op on-chain | - |
| Attestor key leaked | none today | admin calls `set_attestor` | mint-rate alert (T1); traveller signature, separate issuer key and daily caps (T1) |
| Fee relay down | relay error | n/a | the attestor pays (T2) |
| More than one API instance | startup warning when state is in memory on Vercel; `GET /api/health` reports `state` | without the store, in-memory state breaks across serverless instances and the hosted demo can lose the unlock after checkout. With the Redis REST store, nonces, passes, last fixes, limits and attestation status are shared, nonces are burnt once with `SET NX`, and `tests/integration/sharedState.test.ts` runs two instances side by side | durable ledger and outbox in Postgres (T1); the Redis store stays for short-lived state |

## 11. Verify it yourself

- Contract on stellar.expert: https://stellar.expert/explorer/testnet/contract/CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65
- A stamp minted from a real API check-in: https://stellar.expert/explorer/testnet/tx/a0418077886bbdc9f62e313da01088c6d0e89791a313f74092a77329e43ff638
- Read a place's count with no keys (any public key works as the simulation source):

```bash
stellar contract invoke --network testnet --send=no \
  --id CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65 \
  --source-account GDB4SY4VZVHOC6AFARET5EHB4IZJHXEH2PTN2WH64A4552KIDWY5YAGC \
  -- place_visit_count --place_id wat-chalong
```

- Rules you can trigger in simulation: a second stamp for the same traveller and place fails with `Error(Contract, #10)`; `transfer` fails with `Error(Contract, #12)`.
- Every testnet transaction, including the four team test stamps (tokens 1 to 4) and their passport activations, is listed in [contracts/DEPLOYMENT.md](../contracts/DEPLOYMENT.md).
- The demo at https://verapass.vercel.app runs in demo mode: no payment or chain keys and mock attestation. The shared store is built but switched on there only when its Redis REST variables are set; `GET /api/health` reports `"state": "redis"` or `"memory"`. In memory, the unlock after checkout can fail across serverless instances. Run it locally (see the root README) for a reliable walk-through.
- Stellar testnet resets on 2026-12-16. After that date the contract is redeployed and this page and `contracts/DEPLOYMENT.md` get the new id.

## 12. Delivery map

| Tranche | Target | Architecture change |
|---|---|---|
| T1, MVP on testnet | 2027-02-05 | Contract v2 with two-party stamps and a separate issuer key; payment and refunds on-chain; Postgres ledger and attestation outbox, KMS keys, keep-alive and restore path; the app reads the chain; check-in protocol spec v0 and a TypeScript read client |
| T2, testnet | 2027-03-26 | Passkey wallets and fee relay; creator USDC credit on testnet; rotating on-site QR, protocol spec v1, threat model and monitoring plan; beta with the flagship guide; attest.so mirror of every stamp |
| T3, mainnet | 2027-05-28 | Mainnet with a multisig admin and alerts; indexer and read API; USDC claim on mainnet and a second creator; SDK v1.0, example app and docs hub |

### Deliverables, budget and how to check them

Work starts 2026-12-14, assuming a mid-December award; the dates move with the actual award date. The budget is development time only: 846 billed hours at $50. Everything in "Status" above is already built and is not billed. Audits, marketing, legal and entity setup, live payment and payout setup, the mainnet USDC pool and hosting after launch are outside the grant.

| Id | Deliverable | Budget | How a reviewer checks it |
|---|---|---|---|
| D1.1 | Contract v2 on testnet: two-party `stamp`, separate passport-issuer role, `deactivate_passport`, daily caps, two-step creator registry, `move_place`, leaner storage | $3,200 | `cargo test` green with a test per public function and error; testnet contract id; a stamp tx on stellar.expert with two auth entries; tests showing a stamp missing either signature is refused and the attestor key cannot activate a passport; v2 stamp fee next to the v1 baseline (about 0.66 XLM) |
| D1.2 | Payment and refunds on-chain: the Stripe webhook has the issuer key call `activate_passport`; refunds and disputes call `deactivate_passport`; free-place check-ins stop creating passports | $1,700 | pay with test card 4242 on the testnet site and see the `activate_passport` tx within 60 s; a refund in the Stripe test dashboard produces a `deactivate_passport` tx; integration tests |
| D1.3 | Durable attestor: Postgres check-in ledger and attestation outbox, attestor and issuer keys in AWS KMS with tested rotation, scheduled `extend_ttl`, restore path, mint-rate alert | $2,800 | an attestation queued on an instance killed mid-send is confirmed by another instance with no second stamp; history survives a wipe of the hot-path store; a ledger query equals the contract's `stamped` events; rotation and keep-alive txs on testnet; an archive-and-restore test on a local network |
| D1.4 | The app reads stamps and counts from the contract; check-in protocol spec v0 and a TypeScript read client; Freighter signs the traveller side on desktop | $1,700 | a stamp in the app matches `get_stamp` in Stellar Lab; a desktop stamp signed by Freighter and the attestor; spec and client in this repo |
| D2.1 | Passkey wallets for travellers, fees through OpenZeppelin Stellar Channels with an attestor-paid fallback, fee budget alert | $4,200 | create a wallet on a phone on the testnet site; wallet contract on stellar.expert; a stamp tx signed by that wallet and the attestor; fallback path covered by a test |
| D2.2 | Creator USDC credit on testnet from a funded pool, capped per place per day, claimed to the creator's own account | $2,500 | claim tx moving test USDC to the creator; contract tests for the cap, an empty pool and a revoked creator |
| D2.3 | Anti-spoofing v1 (rotating on-site QR, per-address limit), protocol spec v1, STRIDE threat model v1 for contract v2, on-chain monitoring plan | $3,800 | the two `it.fails` cases in `tests/integration/attacks.test.ts` become refusals; spec, threat model and monitoring plan in the docs hub |
| D2.4 | Testnet beta with the flagship guide (her own account, 25 places) and every stamp mirrored to attest.so | $3,600 | registry event and 25 `place_added` events; attest.so attestations under the Verapass schema equal the `stamped` events; a KPI report listing each beta wallet with its creation tx, team wallets disclosed separately |
| D3.1 | Mainnet deployment: 2-of-3 multisig admin, attestor in KMS, daily caps, keep-alive, alert rules, fee relay or attestor-paid fees | $4,800 | mainnet contract id; admin signers and thresholds on stellar.expert; alert rules file in this repo; mainnet fee table in the docs |
| D3.2 | Indexer with backfill, public read API, creator and place lookup page, published Hubble query | $5,000 | the Hubble query returns the same counts as the API and the lookup page |
| D3.3 | USDC credit and claim on mainnet with a reconciliation report; second licensed creator; creator UI for places and bookings; traveller seat claim | $4,200 | mainnet claim tx to the flagship guide's account; the second creator's approval event; reconciliation report with card and booking passports listed separately |
| D3.4 | TypeScript SDK v1.0 on npm, protocol spec v1.0, example app, SDK quickstart, docs for contract v2 and mainnet | $4,800 | tagged release and npm package; example app in this repo; a first verified read of a v2 mainnet stamp from `npm install` in under 15 minutes; launch KPIs with tx links |

Totals: T1 $9,400, T2 $14,100, T3 $18,800, plus $4,700 (10%) paid on acceptance with no deliverable: $47,000 in all.

Headline on-chain metric: verified stamps from distinct traveller wallets, each with two signatures, split by passport source (card-paid or booking). USDC credited and claimed is the payout proof.

Mainnet launch conditions: 2 approved creators, 30+ places, 80+ mainnet stamps from at least 20 distinct traveller wallets (each with two signatures; 60+ at the flagship guide's places, 10+ at the second creator's), stamps split by passport source with every booking wallet having claimed its own seat, and every accepted stamp paid as USDC credit ($80+ credited and at least $60 claimed to the creators' own accounts at the $1 pilot rate). Targets for the 90 days after launch: 300 passkey wallets, 1,000 mainnet stamps, $1,000+ USDC credited to creators.

## 13. Threat model summary

The full outline, with all 23 threats, their status today and the tranche that closes each gap, is in [threat-model.md](threat-model.md). The short version:

| Defence | Stops | Does not stop |
|---|---|---|
| Nonce, 2-minute window, clock-skew check (today) | replaying an old check-in | live fake coordinates |
| Speed limit, per-place and per-IP limits (today) | one identity collecting many places quickly | many identities, one place each |
| Server-issued, HMAC-signed traveller ids, capped per IP per hour (today) | made-up ids, cheap id rotation from one connection | fresh ids from many connections |
| Paid passport per identity (T1 on testnet; mainnet once live payments start) | free mass fake identities | a funded attacker; a creator buying passes for herself |
| Booking passport on mainnet before live payments (T3): issuer-only activation after the traveller claims the seat from their own wallet, one per booked seat, 20 per creator per day, stamped only at that creator's places | strangers minting passports; a creator activating passports by herself; one creator farming another's credit | a creator who invents bookings and also creates the traveller wallets: bounded by the daily caps and the per-place credit cap, and visible in the published card/booking split and the reconciliation report |
| Traveller signs the stamp (T1) | minting for wallets that never approved | location spoofing: a wallet signs wherever the phone is |
| Separate passport-issuer key (T1) | a stolen attestor key creating passports for sybil wallets | an attacker holding both keys: bounded by daily caps and the mint-rate alert until rotation |
| Rotating on-site QR code, 30 to 60 second slots (T2) | remote scripts at QR places | someone on site relaying the code live; collusion with a guide |
| Daily caps (T1) | runaway minting | slow abuse under the cap |
| Native app with device attestation | most mock-location spoofing | out of scope for this grant |

Two attacks that work today are kept as failing tests (`it.fails` in `tests/integration/attacks.test.ts`): a script that sends each place its own coordinates, and a fresh traveller id per place. The T2 anti-spoofing work turns both into refusals.

Privacy: a wallet's visit history (address, place id, time) is public through `stamped` events, and travellers are told so before their first stamp. Hidden places stay hidden because only a salted hash of their location is on chain; this holds while the salt stays secret.

Monitoring: an on-chain monitoring plan (mint rate, fee spend, caps, TTL) is a T2 deliverable, with alert rules deployed on mainnet in T3. Today there is no alerting: the signals are the server log, the attestation status per proof hash (`GET /api/attestation/:proofHash`) and `GET /api/health`.

Report a vulnerability privately as described in [SECURITY.md](../SECURITY.md).

## 14. Run it and test it

About 15 minutes on a fresh machine. Needs Node 22.12 or newer; the contract needs the Rust toolchain pinned in `contracts/rust-toolchain.toml` (1.93.0, target `wasm32v1-none`).

```bash
npm install
npm run dev                    # web on http://localhost:5173, API on http://localhost:8787
npm test                       # unit and integration tests (Vitest); the live testnet test is skipped
npx playwright install chromium
npm run test:e2e               # end-to-end tests; builds the app and starts its own servers in demo mode
cd contracts && cargo test     # contract tests
```

With no `.env` file everything runs in demo mode: no payment or chain keys, mock attestation. Live mode against the testnet contract, the environment variables and the Vercel deployment are in the [root README](../README.md); a step-by-step walk-through with expected output is in the [quickstart](quickstart.md); what each screen does is in [UI and flows](ui.md).

## Maintenance

The two founders maintain the contract, the SDK, the protocol spec and the docs during the grant and for 12 months after the mainnet launch, funded by the founders and not by the grant. Issues get a first answer within 5 working days. After each testnet reset the contract is redeployed within a day and the new id is published here and in `contracts/DEPLOYMENT.md`.
<!-- [FOUNDER: confirm the maintenance terms above; they match the SCF form text.] -->

## AI disclosure

This document, the diagrams and the prototype code (Soroban contract and tests, check-in API, attestor, Stripe integration, web app) were written with AI assistance (Claude) and reviewed by the founders.
<!-- [FOUNDER: confirm the review before publishing.] -->

## References

- Soroban authorization: https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization
- State archival: https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival
- getEvents retention: https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents
- Stellar Asset Contract: https://developers.stellar.org/docs/tokens/stellar-asset-contract
- Contract accounts: https://developers.stellar.org/docs/build/guides/contract-accounts
- OpenZeppelin Relayer and Channels: https://developers.stellar.org/docs/tools/openzeppelin-relayer
- CAP-51 (secp256r1): https://github.com/stellar/stellar-protocol/blob/master/core/cap-0051.md
- SEP-50 (Draft): https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0050.md
- passkey-kit: https://github.com/stellar/passkey-kit
- attest.so: https://github.com/daccred/attest.so
- Stripe Checkout fulfilment: https://docs.stripe.com/checkout/fulfillment
- Stripe Connect cross-border payouts: https://docs.stripe.com/connect/cross-border-payouts
- MoneyGram Ramps: https://developer.moneygram.com/moneygram-developer/docs/moneygram-ramps
