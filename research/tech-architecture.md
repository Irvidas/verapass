# Verapass technical architecture research: Stripe + Stellar

> Superseded in part (2026-10-10). This is the research note from 2026-10-08, kept for its sources. Two
> things changed since: the guide is paid in USDC on Stellar by the stamp contract (planned grant work),
> not through Stripe Connect, because self-serve cross-border payouts do not cover Thailand; and the
> contract interface below is an early sketch. The current design is in
> [docs/architecture.md](../docs/architecture.md) and [contracts/README.md](../contracts/README.md).

Research date: 2026-10-08. Scope: how Verapass (proof-of-presence travel passport on Stellar, Phuket pilot with Sukanya as the flagship verified creator) should wire card payments through Stripe to attestations on Stellar (Soroban). Every claim below links to the page it came from. Anything marked "design choice" or "assumption" is ours, not a vendor statement.

## Summary

- Card payments: use the Stripe Checkout Sessions API in `mode: "payment"` and fulfil from the `checkout.session.completed` webhook. Stripe says webhooks are required for fulfilment and recommends Checkout Sessions over Payment Intents for most integrations.
- Stripe does touch Stellar today, but only for moving money (USDC/XLM onramp, USDC stablecoin payouts). Nothing in Stripe writes arbitrary data or contract calls to Stellar. The Soroban attestation must be written by our own server after the Stripe webhook fires.
- Creators/guides: Stripe Connect marketplace pattern, destination charges with `application_fee_amount`, Accounts v2 with the `recipient` configuration. There is a real blocker for paying a Thai guide from an EU (Lithuanian) platform: self-serve cross-border payouts do not cover Thailand. This needs a decision (see "Open questions").
- Stellar: `@stellar/stellar-sdk` 17.2.1, `@stellar/freighter-api` 6.0.1, `passkey-kit` 0.19.1 (now under `github.com/stellar/passkey-kit`), Soroban contracts with Rust >= 1.84 and the `wasm32v1-none` target. SEP-50 (NFT) is a draft and assumes transferability, so a non-transferable stamp contract is a custom design that can mirror SEP-50 read methods.
- Fees: the server pays Soroban fees as the transaction source (or via a fee-bump), or uses OpenZeppelin Stellar Channels, which replaced Launchtube.
- Local toolchain is not ready for Soroban: Rust 1.81.0 (needs 1.84+), `wasm32v1-none` not installed, Stellar CLI 23.4.0 (latest 28.1.0).

## (a) Stripe Checkout Sessions for one-off payments

Verified facts:

- Current Stripe API version is `2026-09-30.endive`. Monthly versions have no breaking changes; two major releases a year can. [docs.stripe.com/api-versions](https://docs.stripe.com/api-versions)
- Stripe's guidance: "Stripe recommends using the Checkout Sessions API with the Payment Element over Payment Intents for most integrations ... Don't use the Payment Intent API unless the user explicitly asks". [docs.stripe.com/payments/payment-element/migration-ewcs](https://docs.stripe.com/payments/payment-element/migration-ewcs?integration-path=one-time)
- `mode: "payment"` is for one-time purchases. A Checkout Session expires after 24 hours by default (`expires_at` can be 30 minutes to 24 hours). [docs.stripe.com/payments/checkout/how-checkout-works](https://docs.stripe.com/payments/checkout/how-checkout-works?payment-ui=embedded-page)
- UI options: Stripe-hosted page (default `ui_mode` `hosted_page`, uses `success_url`), embedded page, or `ui_mode: "elements"` with the Payment Element on our own page (`stripe.initCheckoutElementsSdk({clientSecret})`, confirm with `actions.confirm()`). [docs.stripe.com/checkout/fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted), [migration-ewcs](https://docs.stripe.com/payments/payment-element/migration-ewcs?integration-path=one-time)
- One-time Checkout Sessions without an existing customer use a guest customer. [docs.stripe.com/payment-links/post-payment](https://docs.stripe.com/payment-links/post-payment)
- Fulfilment: "Webhooks are required for fulfillment ... You can't rely on triggering fulfillment only from your checkout landing page". The fulfil function must be idempotent per Checkout Session ID, retrieve the session (expand `line_items`), check `payment_status`, then record fulfilment. Delayed methods emit `checkout.session.async_payment_succeeded` / `checkout.session.async_payment_failed`. [docs.stripe.com/checkout/fulfillment](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted)
- With a webhook endpoint for `checkout.session.completed` and a `success_url`, hosted Checkout waits up to 10 seconds for the webhook response before redirecting, so the handler must answer fast. [same page](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted)
- Local testing: `stripe listen` forwards events to localhost and prints the `whsec_...` secret; test card `4242 4242 4242 4242`, any future expiry, any CVC. [same page](https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted)
- Stripe's docs also say coding agents can run `stripe sandbox create` (via `npm i -g @stripe/cli`) to get a sandbox with working keys. [migration-ewcs](https://docs.stripe.com/payments/payment-element/migration-ewcs?integration-path=one-time)
- Package versions (npm, checked 2026-10-08): `stripe` 23.0.0 (Node >= 20), `@stripe/stripe-js` 10.0.0.

Minimal server shape (Node, design sketch, not tested):

```js
// POST /api/checkout  -> create a session for the Phuket passport
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{ price: PRICE_PHUKET_PASSPORT, quantity: 1 }],
  client_reference_id: travellerStellarAddress,      // links payment to passport
  metadata: { product: 'phuket-passport', creator: 'sukanya' },
  payment_intent_data: {                              // Connect destination charge, see (c)
    application_fee_amount: PLATFORM_FEE,
    transfer_data: { destination: SUKANYA_ACCOUNT_ID },
  },
  success_url: `${ORIGIN}/passport?session_id={CHECKOUT_SESSION_ID}`,
});

// POST /api/stripe/webhook  (raw body!)
const event = stripe.webhooks.constructEvent(rawBody, sigHeader, WHSEC);
if (event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded') {
  await enqueueFulfil(event.data.object.id);          // reply 200 fast, mint on-chain async
}
```

`constructEvent` is the standard Stripe Node signature check; we did not pull its doc page in this pass, so confirm the exact signature against the SDK when building.

## (b) Stripe and crypto: what touches Stellar, what does not

What Stripe supports today, from the Stripe "Supported assets and networks" page ([docs.stripe.com/stablecoins/availability](https://docs.stripe.com/stablecoins/availability)):

| Stripe product | Stellar support | Notes |
|---|---|---|
| Crypto Onramp (fiat to crypto, Stripe is merchant of record) | Yes: USDC on Stellar and XLM | Consumers can onramp from US and EU; XLM not available in NY. Requires an onramp application and approval. |
| Stablecoin payouts | Yes: USDC on Stellar | Merchant regions US and EU, payouts global. |
| Treasury stablecoin balances (storage) | No | Tempo, Base, Solana, Ethereum only. |
| Stablecoin payments (accepting crypto at checkout) | No | Tempo, Base, Solana, Ethereum (USDG on Ethereum). |
| Stablecoin-backed card issuing | No | Base, Ethereum, Solana (+ Tempo for OUSD). |

More detail:

- Stripe-hosted onramp lists "XLM" and "USDC (Stellar)"; footnote: "XLM, USDC (Stellar), USDC (Avalanche), and USDC (Polygon) aren't available in New York". Access needs an application reviewed "within 48 hours". [docs.stripe.com/crypto/onramp/stripe-hosted](https://docs.stripe.com/crypto/onramp/stripe-hosted)
- The newer Embedded Components onramp currency list does not include any Stellar asset (USDC on Solana, Base, Ethereum, Arbitrum, Polygon, Sui, Celo, World Chain, Tempo, etc.). So Stellar onramp is available on the hosted/embedded widget path, not on Embedded Components. [docs.stripe.com/crypto/onramp/embedded-components-overview](https://docs.stripe.com/crypto/onramp/embedded-components-overview)
- Treasury "Move money from a stablecoin balance" lists Stellar USDC as a supported network for sending to wallets and for Global Payouts with stablecoins. Moving money from a stablecoin balance is public preview in the US and private preview elsewhere. [docs.stripe.com/treasury/transfer-send](https://docs.stripe.com/treasury/transfer-send)
- Global Payouts can send USDC or OUSD to a recipient's crypto wallet (public preview). Global Payouts is GA for businesses in GB and US; private preview for EU countries including LT. It requires Treasury, and Stripe notes it suits businesses that already hold a money transmitter licence. [docs.stripe.com/global-payouts](https://docs.stripe.com/global-payouts), [docs.stripe.com/global-payouts/payout-methods](https://docs.stripe.com/global-payouts/payout-methods)
- Stablecoin payouts for Connect (connected accounts paid in USDC to a linked wallet) are private preview and "only available to platforms based in the United States", to individuals/sole proprietors with Express Dashboard access, via the Transfers API. [docs.stripe.com/connect/stablecoin-payouts](https://docs.stripe.com/connect/stablecoin-payouts)
- Bridge (Stripe-owned) supports Stellar for USDC and EURC across ACH, Wire, SEPA, SPEI, Pix and Faster Payments routes. Stripe's own docs point to Bridge when Stripe Stablecoin Payouts does not cover a region, asset or network. [apidocs.bridge.xyz payment routes](https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes), [docs.stripe.com/stablecoins/availability](https://docs.stripe.com/stablecoins/availability)

Plain statement for the pitch:

- Supported: card in, fiat settlement, and (with approvals/previews) USDC out to Stellar wallets. A future "creator earns USDC on Stellar" payout is a real Stripe path, not an invention, but it is gated (US platform for Connect stablecoin payouts; Global Payouts GA only for US/GB businesses).
- Not supported: Stripe does not invoke Soroban contracts, mint tokens or write attestations. Stripe also does not accept card payments that settle as Stellar USDC into our Stripe balance (Stellar is not in the "Payments" or "Storage" rows). The on-chain stamp is always our server's job after the webhook.

## (c) Stripe Connect for paying creators/guides

Recommended configuration for a marketplace where guides earn a share:

- Charge type: destination charges. Stripe's own table maps "Customers transact with your platform for products or services provided by your connected accounts" and "a branded service that uses independent contractors" to destination charges. Stripe debits fees from the platform; refunds and chargebacks reduce the platform balance. [docs.stripe.com/connect/charges](https://docs.stripe.com/connect/charges)
- In Checkout: `payment_intent_data[transfer_data][destination]` plus `payment_intent_data[application_fee_amount]`. The full charge moves to the connected account, then the application fee comes back to the platform; Stripe fees are deducted from the platform's share. [docs.stripe.com/connect/marketplace/tasks/accept-payment/destination-charges](https://docs.stripe.com/connect/marketplace/tasks/accept-payment/destination-charges), [docs.stripe.com/connect/destination-charges](https://docs.stripe.com/connect/destination-charges?platform=web&ui=embedded-page)
- Connected accounts: Accounts v2 is recommended for new integrations; legacy Standard/Express/Custom types are deprecated. For a marketplace: `dashboard: "express"`, `defaults.responsibilities.fees_collector: "application"`, `losses_collector: "application"`, `configuration.recipient.capabilities` with `stripe_balance.stripe_transfers`. Add the `merchant` configuration only for direct charges or `on_behalf_of`. [docs.stripe.com/connect/integration-recommendations](https://docs.stripe.com/connect/integration-recommendations), [docs.stripe.com/connect/marketplace/tasks/create](https://docs.stripe.com/connect/marketplace/tasks/create)
- With destination/separate charges: negative-balance liability sits with the platform, Stripe advises against letting connected accounts set Radar rules. [integration-recommendations](https://docs.stripe.com/connect/integration-recommendations)
- Refunds: by default the connected account keeps transferred funds; use `reverse_transfer=true` and `refund_application_fee=true` to claw back. [docs.stripe.com/revenue-recognition/connect/destination-charges](https://docs.stripe.com/revenue-recognition/connect/destination-charges)

Country constraints (the part that matters for a Thai guide and a Lithuanian team):

- Stripe accounts are available in both Thailand and Lithuania. [stripe.com/global](https://stripe.com/global)
- Self-serve cross-border payouts: "Platforms based in the US, UK, EEA, Canada, or Switzerland can transfer funds to connected accounts in any of those regions ... Stripe doesn't support self-serve cross-border payouts to countries outside the listed regions." Thailand is outside. Destination charges cross-border only work without `on_behalf_of`, and not to recipient-agreement accounts. [docs.stripe.com/connect/cross-border-payouts](https://docs.stripe.com/connect/cross-border-payouts)
- A Thailand-based platform has its own limits: may need Stripe sales, no top-ups, "We do not support separate charges and transfer", some industries unsupported where the platform carries losses. [support.stripe.com Thailand marketplace](https://support.stripe.com/questions/stripe-thailand-support-for-marketplace)
- Thailand appears in Stripe's list of countries where platforms "can't self-serve Express connected accounts" (contact sales). [docs.stripe.com/connect/express-accounts](https://docs.stripe.com/connect/express-accounts)
- Global Payouts added `th_bank_account` as a recipient destination in January 2026 (Accounts v2 / Outbound Payments). [Stripe changelog 2026-01-28](https://docs.stripe.com/changelog/clover/2026-01-28/cross-border-payouts-new-countries)

Consequence: for the SCF demo, build the full destination-charge flow in Stripe test mode/sandbox. For live payouts to Sukanya there are three real options, each needing a business decision: (1) a Thai platform entity with Stripe Thailand (sales-assisted, destination charges only); (2) a US or UK entity using Global Payouts (Thai bank account or USDC to a Stellar wallet); (3) an EU entity with Global Payouts once the private preview opens for LT. Which country a test-mode connected account can be created in from an EU platform was not verified here; check it in the sandbox before the demo script depends on a TH account.

"Validation and collection settled via Stripe" mapped to real objects (design choice):

1. Traveller pays once for the Phuket passport (Checkout, destination charge, Sukanya gets her share, Verapass keeps `application_fee_amount`).
2. Each verified check-in is free to the traveller but is counted per creator; payouts tied to verified visits would need separate charges and transfers, which Stripe Thailand does not support, so keep per-visit revenue share off-chain for the pilot and settle it in the destination-charge split.

## (d) Stellar building blocks

### JavaScript SDK

- `@stellar/stellar-sdk` 17.2.1 (npm, published 2026-10-01), `engines.node >= 22.12.0`. Local Node is 22.22.2, which meets this.
- Version 16 folded `@stellar/stellar-base` into the SDK, replaced axios with native `fetch`, went ESM-first, and removed the `browser` field auto-resolution ("Bundlers now resolve to ESM or CJS source by default"). Deep imports move to subpaths such as `import { rpc } from "@stellar/stellar-sdk/rpc"`. [js-stellar-sdk migration guide](https://github.com/stellar/js-stellar-sdk/blob/main/docs/guides/00-migration.md) (via context7)
- Browser CDN build: `https://cdnjs.cloudflare.com/ajax/libs/stellar-sdk/{version}/stellar-sdk.js`. [js-stellar-sdk README](https://github.com/stellar/js-stellar-sdk/blob/main/README.md)
- Contract call flow: `new rpc.Server("https://soroban-testnet.stellar.org")`, build `invokeHostFunction`, `simulateTransaction`, apply soroban data, sign, `sendTransaction`, `pollStatus`. Typed clients come from generated bindings (`new Client({ contractId, networkPassphrase, rpcUrl, publicKey, ...signer })`). [rpc-server autodocs](https://github.com/stellar/js-stellar-sdk/blob/main/_autodocs/rpc-server.md), [README](https://github.com/stellar/js-stellar-sdk/blob/main/README.md)
- Assumption to test: Vite may still need a `Buffer` shim for parts of the SDK in the browser. The docs mention polyfills only for React Native; confirm with a build before adding a polyfill plugin.

### Freighter wallet

- `@stellar/freighter-api` 6.0.1 (npm). Functions: `isConnected`, `isAllowed`, `setAllowed`, `requestAccess`, `getAddress`, `getNetwork`, `getNetworkDetails`, `signTransaction`, `signAuthEntry`, `signMessage`, `WatchWalletChanges`. [docs.freighter.app](https://docs.freighter.app/extension-freighter-api/extension.md)
- Signatures: `requestAccess(): Promise<{ address } & { error? }>`; `getAddress()` does not prompt and returns an empty address if not authorised; `signTransaction(xdr, { network?, networkPassphrase?, address? }) -> { signedTxXdr, signerAddress }`; `signAuthEntry(entryXdr, { address }) -> { signedAuthEntry, signerAddress }`. Errors are `{ code, message, ext? }`. [docs.freighter.app](https://docs.freighter.app/extension-freighter-api/extension.md)
- Freighter is a browser extension, so it fits desktop and crypto-native users, not a traveller on a phone at a beach. Keep it as the "bring your own wallet" option. `@creit.tech/stellar-wallets-kit` 2.7.1 (npm) is a multi-wallet alternative; not researched further.

### Passkey smart wallets

- `passkey-kit` 0.19.1 (npm, 2026-09-18, Node >= 22). The repo moved to `github.com/stellar/passkey-kit`. A wallet is a Soroban contract whose signers can be secp256r1 passkeys, Ed25519 keys or policy contracts. `PasskeyKit` runs in the browser and holds no secrets; `PasskeyServer` holds the relayer secret and must never ship to the browser. [github.com/kalepail/passkey-kit](https://github.com/kalepail/passkey-kit)
- Fees: it submits through OpenZeppelin Relayer Channels ("a channel account builds/pays for the transaction so the wallet holds no XLM"); a Cloudflare Worker relayer-proxy is suggested for browser clients. [same](https://github.com/kalepail/passkey-kit)
- Caveats the repo states: no claim of independent audit ("Review the contract and SDK yourself before holding meaningful value"), shared default deployer keypair (front-running exposure), WebAuthn User Presence rather than User Verification. [same](https://github.com/kalepail/passkey-kit)
- Stellar docs: contract accounts "can't pay their own transaction fees", so a fee sponsorship approach is required. [developers.stellar.org contract accounts](https://developers.stellar.org/docs/build/guides/contract-accounts)
- OpenZeppelin Stellar Contracts also ship a "Smart Accounts" module and a "Fee Abstraction" utility. [docs.openzeppelin.com/stellar-contracts](https://docs.openzeppelin.com/stellar-contracts)
- Fit for Verapass: a passkey wallet gives a traveller a Stellar address with Face ID / fingerprint and no seed phrase or XLM. Stamps hold no monetary value, which keeps the audit caveat tolerable for a pilot.

### Soroban contract for non-transferable stamps

- Toolchain: "Stellar smart contracts require Rust toolchain v1.84.0 or higher", target `wasm32v1-none` (`rustup target add wasm32v1-none`). Latest Stellar CLI is v28.1.0 (`brew install stellar-cli` or `cargo install --locked stellar-cli@28.1.0`). [developers.stellar.org setup](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup)
- Crates (crates.io, 2026-10-08): `soroban-sdk` 29.0.0, OpenZeppelin `stellar-tokens` / `stellar-access` / `stellar-macros` 0.7.2.
- SEP-41 is the fungible token interface (not relevant to stamps). SEP-50 is the NFT standard: status Draft, v0.1.0 (2025-03-10). It requires `balance`, `owner_of`, `transfer`, `transfer_from`, `approve`, `approve_for_all`, `get_approved`, `is_approved_for_all`, `name`, `symbol`, `token_uri`, with Transfer/Approve/Mint events. It says nothing about non-transferable tokens and assumes transferability. [SEP-50](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0050.md)
- OpenZeppelin's NFT module (`stellar-tokens`) offers Base, Consecutive and Enumerable variants plus Burnable, Royalties and Votes extensions; it mints with `Base::sequential_mint()` and warns that minting needs access control. No soulbound extension is documented. [docs.openzeppelin.com non-fungible](https://docs.openzeppelin.com/stellar-contracts/tokens/non-fungible/non-fungible)
- Storage: persistent entries are archived when TTL hits 0 and can be restored (automatically on access since Protocol 23); temporary entries are deleted for good. Stamps must use persistent storage; nonces can use temporary storage. [developers.stellar.org state archival](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival)

Recommended contract shape (design choice, our own, not a standard):

```rust
// verapass_stamps - one contract per network, admin = Verapass attestor key
pub fn __constructor(env, admin: Address)
pub fn add_creator(env, creator: Address, licence_hash: BytesN<32>)        // admin.require_auth()
pub fn add_place(env, place_id: u32, creator: Address, geo_hash: BytesN<32>) // admin.require_auth()
pub fn activate_passport(env, traveller: Address, payment_ref: BytesN<32>)  // admin; payment_ref = sha256(checkout_session_id)
pub fn stamp(env, traveller: Address, place_id: u32, proof_hash: BytesN<32>) // admin; one per (traveller, place)
// read side, SEP-50 style names so explorers/wallets can show them:
pub fn balance(env, owner: Address) -> u32
pub fn owner_of(env, token_id: u32) -> Address
pub fn name(env) -> String; pub fn symbol(env) -> String; pub fn token_uri(env, token_id: u32) -> String
pub fn transfer(..) -> !   // always panics: stamps are non-transferable
pub fn place_visits(env, place_id: u32) -> u32                              // "validated by N real visitors"
```

Notes on the shape: the attestor (server) is the only minter, so the traveller signs nothing on-chain and needs no XLM; events (`stamp`, `passport`) let an indexer or the UI read history; no raw GPS or personal data goes on-chain, only hashes. Building this on OpenZeppelin `stellar-tokens` Base with overridden `transfer`/`transfer_from`/`approve` that panic is an option, but the Votes extension is the only documented override example, so verify that path compiles before committing to it.

### Fee sponsorship

- Fee-bump transactions: a fee account pays for an inner transaction without re-signing it; JS `TransactionBuilder.buildFeeBumpTransaction(feeKeypair, fee, innerTx, networkPassphrase)`. [developers.stellar.org fee-bump](https://developers.stellar.org/docs/build/guides/transactions/fee-bump-transactions)
- Sponsored reserves: wrap `CreateAccount` between `BeginSponsoringFutureReserves` and `EndSponsoringFutureReserves` so a user account starts with zero XLM. [developers.stellar.org sponsored reserves](https://developers.stellar.org/docs/build/guides/transactions/sponsored-reserves)
- OpenZeppelin Stellar Channels: managed relayer where "OpenZeppelin runs the pool of channel accounts and covers the fees", testnet base URL `https://channels.openzeppelin.com/testnet`, API key required, fair use policy. SDF discontinued Launchtube and points to Channels as the replacement. [developers.stellar.org OpenZeppelin Relayer](https://developers.stellar.org/docs/tools/openzeppelin-relayer)
- For Verapass the simplest path: the attestor account is the transaction source for `activate_passport` and `stamp`, so it pays fees directly. No fee-bump needed. Channels is needed only for passkey wallet deployment/transactions.

### Testnet

- RPC `https://soroban-testnet.stellar.org`, Horizon `https://horizon-testnet.stellar.org`, passphrase `Test SDF Network ; September 2015`, Friendbot `https://friendbot.stellar.org`. Testnet resets 2-4 times a year; next scheduled reset 2026-12-16. Mainnet passphrase `Public Global Stellar Network ; September 2015`. [developers.stellar.org networks](https://developers.stellar.org/docs/networks)
- The December reset falls inside a likely SCF review window: the deploy script must be one command (fund via Friendbot, deploy, seed creator and places) so the demo can be restored the same day.

## (e) Reference architecture

```
 TRAVELLER PHONE (Vite SPA, HTTPS)                       VERAPASS API (Node, small)                     EXTERNAL
 +-------------------------------+                      +-----------------------------------+
 | 1. Create passkey wallet      |--- passkey-kit ----->| PasskeyServer + relayer proxy     |---> OZ Stellar Channels (fees)
 |    (or connect Freighter)     |                      |                                   |
 |                               |                      |                                   |
 | 2. "Get Phuket passport"      |--- POST /checkout -->| create Checkout Session           |---> Stripe API
 |    redirect to Stripe Checkout|<-- session.url ------|  mode=payment, destination charge |     (test mode)
 |    pays with card             |=====================================================>    |     Stripe Checkout
 |                               |                      |                                   |
 |                               |                      | POST /stripe/webhook  <-----------|---- checkout.session.completed
 |                               |                      |  verify signature, reply 200      |
 |                               |                      |  queue: payment_status == paid ?  |
 |                               |                      |  -> activate_passport(addr,       |---> Soroban RPC (testnet)
 |                               |                      |       sha256(session_id))         |     verapass_stamps contract
 |                               |                      |                                   |
 | 3. At a place: "Collect"      |--- POST /nonce ----->| nonce(addr, place, exp=120s)      |
 |    getCurrentPosition()       |                      |                                   |
 |    + optional QR scan         |--- POST /checkin --->| checks: nonce, signature, geofence|
 |    signed {nonce,lat,lng,acc, |                      |  accuracy, time, velocity, QR     |
 |     ts, qr?} by wallet        |                      |  -> stamp(addr, place, proofHash) |---> Soroban RPC
 |                               |<-- tx hash ----------|  store raw proof off-chain (EU)   |
 | 4. Passport UI reads stamps   |--- simulate/read ------------------------------------------>  Soroban RPC (read-only)
 |    + place_visits counts      |                      |                                   |
 +-------------------------------+                      +-----------------------------------+
                                                         Stripe Connect: Sukanya's connected account
                                                         gets transfer_data share; Verapass keeps
                                                         application_fee_amount.
```

Why the server, not the browser, writes stamps: the browser can be lied to (see below), and only the attestor key can mint, so every on-chain stamp means "Verapass checked this visit", which is the claim we want third parties to trust. Payment state never goes on-chain as amounts or card data, only a hash of the Checkout Session ID.

Webhook-to-chain handling (design choice): reply 200 to Stripe immediately (Stripe waits up to 10 s before redirecting), mint in a background job, key the job on the Checkout Session ID so retries and duplicate events stay idempotent (Stripe says the fulfil function can be called more than once, possibly concurrently). The success page polls our API for "passport active" and shows the Stellar tx hash with a testnet explorer link.

### GPS proof of presence and its limits

Facts:

- The Geolocation API needs HTTPS ("available only in secure contexts") and an explicit user permission prompt. [MDN Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API)
- `coords.accuracy` is "the accuracy, with a 95% confidence level, of the latitude and longitude ... expressed in meters". [MDN accuracy](https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy)

Check-in protocol (design choice):

1. Server issues a nonce bound to (traveller address, place_id), single use, valid 120 s.
2. Client calls `getCurrentPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })`.
3. Client sends `{nonce, lat, lng, accuracy, deviceTs}` signed by the wallet (Freighter `signMessage` or the passkey).
4. Server accepts only if: nonce valid and unused; signature matches the passport address; haversine distance <= place radius (per place, for example 150 m for a beach, 50 m for a viewpoint); `accuracy` <= a cap (for example 100 m) so a 5 km cell-tower fix cannot pass; server time within the nonce window; travel speed from the traveller's previous check-in is physically possible; per-address rate limit.
5. Optional, for high-value places: a rotating on-site code (HMAC of place secret and a 30-60 s time slot) shown on a sign or by Sukanya on tour; the traveller scans it as a QR. This proves presence near the code, not near GPS, and it defeats pure location spoofing.
6. Server mints `stamp` with `proof_hash = sha256(canonical proof JSON)`; the raw proof stays off-chain with a retention limit (the team is EU-based, so GDPR applies to location data; assumption, not legal advice).

Limits to state honestly in the pitch:

- A web page cannot prove the GPS fix is real. Location can be faked with browser developer tools sensor overrides, mock-location apps on Android, or a rooted/jailbroken phone. (General knowledge, not verified against a source in this pass.)
- Web apps have no access to platform device attestation (such as Android Play Integrity or Apple App Attest), which only native apps can call. (General knowledge, not verified in this pass.) A later native wrapper could add it.
- Accuracy in dense jungle, under cliffs or on boats can exceed the cap; allow a fallback (QR code or guide-confirmed check-in) instead of rejecting real visitors.
- The goal is to make faking costly and detectable at scale (one person faking 40 beaches in an hour fails the velocity check; a fake influencer cannot show stamps for places they never reached), not to make it impossible. Say this plainly.

## Local toolchain check

Run on 2026-10-08:

```
$ cargo --version            -> cargo 1.81.0 (2dbb1af80 2024-08-20)
$ rustc --version            -> rustc 1.81.0 (eeb90cda1 2024-09-04)
$ rustup target list --installed
  aarch64-apple-darwin
  wasm32-unknown-unknown
$ rustup toolchain list      -> stable-aarch64-apple-darwin (default), 1.95.0-sbpf-solana-v1.57
$ stellar --version          -> stellar 23.4.0 (stellar-xdr 23.0.0)
$ node --version             -> v22.22.2
```

Gaps against current Stellar requirements: Rust 1.81 < 1.84 minimum; `wasm32v1-none` missing (only `wasm32-unknown-unknown`); Stellar CLI 23.4.0 vs latest 28.1.0. To fix (not run, needs the user's go-ahead because it changes the global toolchain):

```
rustup update stable
rustup target add wasm32v1-none
brew upgrade stellar-cli    # or: cargo install --locked stellar-cli@28.1.0
```

## Package versions (npm / crates.io, 2026-10-08)

| Package | Version | Note |
|---|---|---|
| @stellar/stellar-sdk | 17.2.1 | Node >= 22.12.0 |
| @stellar/freighter-api | 6.0.1 | |
| passkey-kit | 0.19.1 | Node >= 22; repo at github.com/stellar/passkey-kit |
| @creit.tech/stellar-wallets-kit | 2.7.1 | not evaluated |
| stripe (Node) | 23.0.0 | Node >= 20 |
| @stripe/stripe-js | 10.0.0 | |
| soroban-sdk (Rust) | 29.0.0 | released 2026-10-07, check OZ crate compatibility |
| stellar-tokens / stellar-access / stellar-macros | 0.7.2 | OpenZeppelin |
| stellar-cli | 28.1.0 | |

## Open questions

- Legal entity and country for the Stripe platform. EU platform cannot self-serve payouts to a Thai connected account; options are a Thai entity (sales-assisted), a US/UK entity with Global Payouts, or waiting for Global Payouts EU preview. Default for the SCF demo: Stripe test mode only, destination charges, no live payouts.
- Whether `soroban-sdk` 29.0.0 (one day old) works with OpenZeppelin `stellar-tokens` 0.7.2; if not, pin the soroban-sdk version OZ depends on.
- Whether the Stripe sandbox lets an EU platform create a TH test connected account; if not, demo with a same-region test account and say so.
- Buffer shim need for `@stellar/stellar-sdk` 17 under Vite: verify with a build.
- passkey-kit is unaudited; acceptable for non-monetary stamps, but the deck should not imply audited custody.
- Creator verification (TAT licence) is an off-chain check by Verapass, recorded as a hash on-chain. Stripe Connect onboarding also does KYC on the creator; that KYC result can back the "verified human" claim, but Stripe does not expose it as an on-chain credential.
- Stellar onramp via Stripe is available on the hosted/widget onramp but not on Embedded Components; only relevant if travellers later top up USDC, which the pilot does not need.
