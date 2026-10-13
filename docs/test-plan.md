# Test plan

This page lists the automated tests in this repository, what each suite covers, how to run them, and what they do not cover yet. It describes the code on 2026-10-10 (counts re-run that day after the share-link pseudonym check, the X-Forwarded-For rate-limit fix and the pilot preflight tests): contract v1 on Stellar testnet, the presence-check API with its two state backends, and the demo web app.

Related pages: [architecture](architecture.md), [threat model outline](threat-model.md).

## Summary

| Suite | Runner | Location | Tests | Result on 2026-10-10 |
|---|---|---|---|---|
| Unit | Vitest | `tests/unit/` | 19 files, 277 tests | all pass |
| Integration | Vitest | `tests/integration/` | 6 files, 111 tests | 105 pass, 6 expected failures (2 attack cases not defended yet, each run on 3 store backends) |
| Live testnet | Vitest | `tests/live/` | 1 test | skipped unless switched on (opt-in) |
| End to end | Playwright (Chromium) | `tests/e2e/` | 3 files, 31 tests | all pass |
| Contract | `cargo test` (soroban-sdk testutils) | `contracts/verapass_stamps/src/test.rs` | 21 tests | all pass |

Vitest reports 389 tests: 382 pass, 6 are expected failures written as `it.fails`, and 1 is the opt-in live test. Most of the growth since the first count (211 on 2026-10-09) is repetition, not new behaviour: the store, counter, rate-limit, nonce and attack suites run once per state backend (see "State backends" below), and the `redisStore`, `bootstrap`, `sharedState`, `pilotPreflight` and `publishCheck` suites are new. Quote the counts with that context. Counts change as the code changes; re-run the commands below and update this table when they do.

### State backends

`tests/support/backends.ts` lists every implementation of the `StateBackend` interface, and the contract suites run once per entry with `describe.each`:

| Backend | What it is |
|---|---|
| `memory` | the in-process store used locally and in tests |
| `redis-rest` | `server/redisStore.ts` against `tests/support/fakeRedisRest.ts`, an in-process fake of the Upstash REST protocol (commands, pipelines, `MULTI/EXEC`, `EVAL` compare-and-delete, expiry on the test clock) |
| `redis-rest with a lagging read replica` | the same fake serving reads from a stale copy, so the suites pass only because the client sends the `upstash-sync-token` header |
| real endpoint (opt-in) | added when `VERAPASS_TEST_REDIS_REST_URL` and `VERAPASS_TEST_REDIS_REST_TOKEN` are set; each run uses a random key prefix and every key expires |

Suites that run per backend: `store.test.ts` (Store, Counter and RateLimiter contracts), `nonce.test.ts` (NonceStore) and `attacks.test.ts`.

## How to run

Needs Node 22.12 or newer. The contract needs the Rust toolchain pinned in `contracts/rust-toolchain.toml` (1.93.0, target `wasm32v1-none`).

```bash
npm install
npm test                       # unit + integration (Vitest); the live test is skipped
npx playwright install chromium
npm run test:e2e               # builds the app and starts its own API and web servers
cd contracts && cargo test     # contract tests
npm run lint && npm run typecheck
```

- No `.env` file is needed. Unit and integration tests build the app in memory with injected clocks, keys and a fake Soroban RPC (`tests/support/fakeSoroban.ts`).
- The e2e run starts the API on port 8797 and the built site on port 4179 in demo mode. It sets empty Stripe and Stellar keys on purpose, so a local `.env` with real keys can never be used by the suite. It generates a fresh Ed25519 receipt key and traveller secret for each run and raises the rate limits, because every test asks for its own traveller id from the same address.
- `npm run test:live` runs the opt-in live test against the real testnet contract. It needs `VERAPASS_LIVE_TEST=1`, a funded testnet attestor key in `STELLAR_SECRET` and the contract id in `VERAPASS_CONTRACT_ID`. Each run activates a passport and mints a stamp at `wat-chalong` for a fresh random traveller, so it spends testnet XLM and adds to the public count.
- There is no CI pipeline in the repository yet. The commands above are run by hand before each release.

## Unit tests (`tests/unit/`, 277)

| File | Tests | What it covers |
|---|---|---|
| `store.test.ts` | 64 | per backend (x3): the Store contract (11: get, set, add-if-absent, delete, compare-and-delete, expiry, pipelines, JSON values), the Counter contract (3) and the sliding-window RateLimiter (5); in memory only: size cap, eviction order and sweeping (3); HMAC traveller ids: issue, verify, refuse tampered or foreign ids, the receipt pseudonym (stable, not the id, never accepted as an id), minimum secret length (4) |
| `nonce.test.ts` | 31 | per backend (x3): unique nonces with a 2-minute window, single use, replay, unknown, boundary at the last millisecond, binding to traveller and place, exactly one winner under concurrency (7); memory cap on live nonces (1); a failing store: a replay is still refused when the "used" marker is lost, a failed clean-up does not fail the winner, a store that cannot burn fails closed (3); clock skew within 5 minutes (2); the velocity check (4) |
| `geo.test.ts` | 27 | haversine distance (identity, symmetry, one degree of latitude, antipodal points); coordinate validation; geofence accept, reject as too far, edge of radius, rough fix, custom accuracy cap, invalid input; nearest place; distance formatting |
| `attestor.test.ts` | 21 | pseudonymous traveller address derivation; `payment_ref` (sha256 of the Checkout Session id, or the free-passport ref); reading contract error codes; the Soroban attestor: `stamp` arguments and signer, activating a passport first, no second mint for a repeat visit, contract refusals not retried, simulation failures retried, one transaction at a time with increasing sequence numbers, resend on `TRY_AGAIN_LATER`, `DUPLICATE`, `ERROR`, `FAILED` and timeouts, a failure not blocking the queue; choosing the mock attestor; the attestation queue's retries and status by proof hash |
| `config.test.ts` | 17 | environment parsing: demo with no settings, empty strings as unset, simulation off once a Stellar key is set, live chain only with both key and contract id, malformed keys and URLs rejected, production refuses to start without required secrets, rate-limit parsing; the Redis REST settings: memory when unset, `VERAPASS_` names first then the Upstash and Vercel pairs, a half-set pair warns and stays in memory, plain-http URLs (except localhost) and bad prefixes refused, a pasted `redis://` string or a URL with credentials refused without echoing it, a warning on Vercel without a shared store |
| `redisStore.test.ts` | 17 | the REST wire format (one POST per command with a bearer token, prefixed keys, JSON values, `PX` expiry, `SET NX`, `MULTI/EXEC` counters, pipelines, one `EVAL` for compare-and-delete, the sync token, the default prefix); read-your-writes on a lagging replica; failures: the token never appears in an error, timeouts, discarded transactions, wrong token, network failure and recovery, error replies, non-JSON answers, mismatched pipeline replies, a timeout signal on every request |
| `pilotPreflight.test.ts` | 22 | `scripts/pilot-preflight.mjs`: StrKey checks for seeds and contract ids; every required pilot setting, wrong or padded values (padded values and a PORT or rate limit made of spaces fail, as they do in the server), Redis pairs, RSA keys and SERVE_STATIC without a build fail; agreement with the server about which environments start; the Stellar RPC `getHealth` check and the running-server check; no value is ever printed |
| `publishCheck.test.ts` | 5 | `scripts/publish-check.sh` in scratch git repos: a clean repo passes; keys are found in odd file names and binary files, in symlink text, in stellar-cli identities and seed phrases, and in `.env`-style lines; build output is refused |
| `client.test.ts` | 14 | browser traveller session (one id request for parallel calls, renewal on refusal); hidden places stay teasers until the server confirms a pass, and an edited pass flag unlocks nothing; stamps keep receipt, signature, key and preimage; stamps in a link fragment round-trip unchanged; a stamp gets a share link (`verifyLink`) only when it carries the `anon_` pseudonym, never an older raw traveller id; polling of pending attestations; image manifest completeness |
| `passport.test.ts` | 13 | stamp validation, passport parsing from storage (broken, old or tampered data), one stamp per place, progress, the passport store with listeners, reloads, status updates by proof hash, pass lock and unlock, and a fallback when storage throws |
| `verify.test.ts` | 9 | `shared/verify.ts`: the same proof hash as the server, Ed25519 in Node WebCrypto, an untouched stamp passes, and an edited receipt, an edited preimage, a foreign signer or a swapped transaction link all fail |
| `places.test.ts` | 8 | place list: unique ids, full server details, valid coordinates and radius, map pins inside the island drawing, alt text, hidden details kept out of the shared module, simulated fixes land inside the geofence |
| `receipts.test.ts` | 8 | canonical JSON; receipt signing and verification, tamper detection, non-Ed25519 keys refused, key persistence from PEM; the mock attestor is deterministic and labelled |
| `pricing.test.ts` | 6 | price formatting and the pass price in minor units |
| `bootstrap.test.ts` | 4 | state backend selection: memory with no store configured, the Redis REST store when its URL and token are set (requests go through it), memory in production on Vercel without the store and a log line that says so |
| `dockHold.test.ts` | 4 | the UI hold that keeps the passport counter waiting for the stamp animation, including its safety timeout |
| `explorer.test.ts` | 3 | explorer links only to stellar.expert testnet; contract records accepted or rejected |
| `boundaries.test.ts` | 2 | the web app never imports server code, so hidden place details cannot reach the bundle; shared code imports neither side |
| `copy.test.ts` | 2 | site copy is printable ASCII and avoids filler words |

## Integration tests (`tests/integration/`, 111)

These run the real Hono app through its HTTP interface with injected clock, keys, Stripe client and Soroban RPC.

| File | Tests | What it covers |
|---|---|---|
| `api.test.ts` | 38 | `/api/health` and security headers; traveller id issue and refusal; checkout in demo mode and with a mocked Stripe client (payment mode, inline price, 502 on Stripe failure, live keys refused, redirect only to the configured origin); nonce input checks and body size limit; check-in accept with a verifiable signed receipt that carries the `anon_` pseudonym, not the traveller id; simulated visits, too far (nonce stays usable), rough fix, replay, unknown or expired or mismatched nonce, clock skew, impossible trip, simulated visits not counted for speed, missing fields, Stellar failure (check-in stands, nonce burnt), slow Stellar (202 then confirmed); webhook without secret, without signature, forged, altered body, valid and idempotent, async payment, pending payment, oversize body; pass lookup (malformed ids, success link alone does not unlock, fallback to Stripe when the webhook never arrived); hidden places only with a paid pass |
| `attacks.test.ts` | 39 | 13 attack cases, each run on the 3 state backends: far-away spoofed coordinates refused; replay refused; made-up traveller ids refused; rotating ids rate limited; a made-up first `X-Forwarded-For` entry does not buy a fresh per-IP budget; one connection rate limited across ids; a burst at one place capped across travellers; two simultaneous check-ins cannot both pass the speed check; hidden places need a paid pass; simulated check-ins never reach the real attestor; a shared stamp link does not hand over the traveller's session or paid pass. Two expected failures per backend, see below |
| `sharedState.test.ts` | 18 | two app instances: with in-memory state a nonce from one is unknown to the other (the bug the store fixes); sharing a Redis REST store: health reports it, a nonce from one instance is accepted once by the other and the replay is refused everywhere, the same nonce sent to both at once is accepted exactly once, a demo pass bought on one unlocks the other, attestation status polled across instances, the speed check sees the other instance's last fix, two simultaneous real check-ins cannot both pass, rate limits count across instances, 503 while the store is down and recovery, every key prefixed and expiring, the lock released after every check-in, fail closed when the store breaks halfway or the lock cannot be taken, the token never in a response or log; with a lagging read replica the speed check and nonces still hold |
| `stellar.test.ts` | 7 | mock mode reports no contract and labels its records; with the contract attestor against a fake RPC: health shows the contract, a check-in activates a passport and mints with stellar.expert links (the on-chain address is still derived from the traveller id), a paid traveller's `payment_ref` is sha256 of the session id, simulated visits never go to the chain, contract refusals fail without retry |
| `vercel.test.ts` | 5 | the Vercel function runs the same app, issues traveller ids, refuses to load in production without required settings, warns on Vercel without a shared store and keeps serving, and shares state through the Redis REST store when it is configured |
| `static.test.ts` | 4 | serving the built app: 200 for real pages, 404 page for anything else, API routed first, trailing slashes |

### Expected failures

`tests/integration/attacks.test.ts` keeps two attacks that work today as `it.fails`, so the gap shows in every run. Each runs on the three state backends, so a run reports 6 expected failures:

1. "a script that sends each place its own coordinates is refused (needs on-site QR codes)": browser GPS is reported by the client, so a script that sends the place's own coordinates collects it, one place per allowed travel time.
2. "a fresh traveller id per place, from different connections, is refused (needs wallet-signed check-ins)": a fresh id has no previous fix, so many connections can spread the work.

Vitest counts an `it.fails` test as passing while its assertion fails. When a defence lands, the assertion starts to hold, the `it.fails` test fails the run, and it is switched to a plain `it`. Turning both into refusals is planned for T2 (rotating on-site QR and wallet-signed check-ins). The [threat model](threat-model.md) lists them as T-2 and T-3.

## Live testnet test (`tests/live/`, 1, opt-in)

`stellar.live.test.ts` uses the real `StellarContractAttestor` against the deployed testnet contract: it activates a passport, mints a stamp, and checks that a second attestation for the same place returns the existing token without a new mint. Skipped unless the variables listed under "How to run" are set.

## End-to-end tests (`tests/e2e/`, 31)

Playwright on desktop Chrome (Chromium), against the production build served by `vite preview` and the API in demo mode.

| File | Tests | What it covers |
|---|---|---|
| `app.spec.ts` | 18 | every home page section loads with no console errors; no placeholder text; demo check-in adds a verified stamp that survives a reload; a stamp edited in `localStorage` is flagged and not counted; a new stamp carries a pseudonym and an older stamp with the raw traveller id gets no share link; a real GPS check-in from far away is refused by the server; a real GPS check-in at the place collects a real stamp; checkout reaches the demo success page and unlocks hidden places; an edited pass flag unlocks nothing; the success link does not unlock another browser; cancel and not-found pages; a collected stamp checks out on `/verify` and an edited one does not; at 375 px no horizontal overflow, the verify card fits the first screen and the passport dock keeps its accessible name; reduced motion shows all content at once; a contract stamp links to its stellar.expert transaction (live answers stubbed in the browser) |
| `a11y.spec.ts` | 10 | axe-core finds no serious or critical violations at 1440 px and 390 px, with and without reduced motion, and on the verify, success and not-found pages; every keyboard focus stop is visible and not covered; the evidence row does not scroll sideways on its own; the mobile menu traps focus and closes on navigation; print shows every block of text |
| `seo.spec.ts` | 3 | Open Graph and Twitter tags, icons and manifest; the page says what Verapass is without JavaScript; the built bundle carries no hidden place names, coordinates or tips |

## Contract tests (`contracts/verapass_stamps/src/test.rs`, 21)

Run in the soroban-sdk test environment with mocked or explicit authorization.

| Area | Tests |
|---|---|
| Roles and admin | `constructor_sets_roles_and_metadata`, `attestor_rotation`, `two_step_admin_handover`, `accept_admin_requires_pending_admin_signature`, `upgrade_with_unknown_wasm_fails_even_for_admin` |
| Authorization | `registry_and_attestor_calls_fail_without_signatures`, `admin_cannot_stamp_and_attestor_cannot_manage_registry`, `stamp_requires_attestor_signature_only` |
| Registry | `duplicate_creator_and_place_are_rejected`, `add_place_requires_registered_creator`, `revoke_unknown_creator_fails`, `revoked_creator_blocks_new_stamps_and_places_but_keeps_history`, `place_id_validation` |
| Passports | `passport_activation_is_idempotent_per_payment_ref` |
| Stamps | `stamp_mints_and_updates_reads`, `stamp_emits_event`, `counts_across_travellers_and_places`, `duplicate_stamp_is_rejected_and_count_unchanged`, `stamp_validation_errors` |
| Non-transferable | `stamps_cannot_move` |
| Reads | `unknown_reads` |

The same rules can be seen on testnet: a repeat stamp fails with `Error(Contract, #10)` and `transfer` fails with `Error(Contract, #12)` (commands in [architecture](architecture.md#11-verify-it-yourself)).

## What is not covered

Stated plainly, so nobody reads the counts above as more than they are.

- Real devices and real GPS. Geolocation is stubbed in e2e. No test runs on a phone, and no test can tell a real fix from a spoofed one; that is the reason for the two expected failures.
- Browsers other than Chromium. No WebKit (iOS Safari) or Firefox runs.
- A real Redis endpoint. The shared-store suites run against an in-process fake of the Upstash REST protocol; the opt-in real-endpoint run (see "State backends") is not part of the default run, and the e2e suite runs one in-memory server.
- Durable records. Shared state expires with its keys, and an attestation queued in a stopped instance's memory is not resumed; nothing tests that, because nothing provides it yet (T1 ledger and outbox).
- Real Stripe. Integration tests use a mocked Stripe client and signed test payloads; e2e runs in demo mode. No test talks to Stripe's servers.
- Real Soroban in CI. Only the opt-in live test touches testnet, and it is run by hand.
- State archival. No test archives and restores a contract entry, and no test covers the TTL keep-alive (planned for T1).
- Contract fuzzing or property tests, and contract tests per error code for every function. Error paths are covered by area, not exhaustively (T1 adds a test per public function and per error).
- Load, soak and rate-limit tuning under real traffic.
- The hosted demo at https://verapass.vercel.app. The e2e suite runs against a local build, not the deployed site.
- Accessibility beyond axe and the keyboard walk. No screen reader pass by a person.
- Contract v2, passkeys, the fee relay, USDC credit, the indexer and the attest.so mirror. None is built, so none is tested.
- axe-core is loaded from `node_modules` but is not a direct dependency (it arrives through `eslint-plugin-jsx-a11y`); a dependency change could break the a11y suite.

## Planned tests by tranche

Each item below is a completion criterion of a planned deliverable, so the tests are written with the feature, not now.

| Tranche | Tests added with the work |
|---|---|
| T1 | a contract test per public function and per error; a stamp missing either signature is refused; the attestor key cannot call `activate_passport`; payment to activation and refund to deactivation integration tests; archive and restore of a stamp entry on a local network; an attestation queued on an instance killed mid-send is resumed by another and confirmed once; check-in history survives a wipe of the short-lived store and a restart; a reconciliation query over the ledger equals the contract's `stamped` events |
| T2 | fee relay fallback path; USDC credit cap, empty pool and revoked creator contract tests; both expected-fail attack tests flipped to refused; every attack case in check-in protocol spec v1 covered by a test |
| T3 | indexer counts equal the published Hubble query; mainnet launch figures shown with transaction links |
