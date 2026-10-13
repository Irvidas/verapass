# Testnet deployment

Deployed on 2026-10-09 with [scripts/deploy-testnet.sh](scripts/deploy-testnet.sh), stellar-cli 28.1.0, soroban-sdk 29.0.0. Testnet ran protocol 29. Testnet resets wipe all contracts (next scheduled reset 2026-12-16); after a reset, re-run the script and update this file.

All keys below are throwaway testnet identities in the stellar CLI keystore of the machine that deployed. No secret key is stored in this repo.

## Contract

| Item | Value |
|------|-------|
| Network | Stellar testnet (`Test SDF Network ; September 2015`), RPC `https://soroban-testnet.stellar.org` |
| Contract id | `CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65` |
| Explorer | [stellar.expert](https://stellar.expert/explorer/testnet/contract/CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65), [Stellar Lab](https://lab.stellar.org/r/testnet/contract/CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65) |
| Wasm hash | `9f12baf585c2dff7c7e2bcb5da8a3ad6ffee968932b55069144b4f024171a7d1` (sha256 of `target/wasm32v1-none/release/verapass_stamps.wasm`, 14.7 KB) |
| Contract version | 1 |

## Identities

| Role | CLI name | Address |
|------|----------|---------|
| Admin (deployer) | `verapass-admin` | [GBZWMQM2Y3XRELOHYK3IQ57NAARTI4TTWAGHGHLUEXAUFMUUJWDUBKTU](https://stellar.expert/explorer/testnet/account/GBZWMQM2Y3XRELOHYK3IQ57NAARTI4TTWAGHGHLUEXAUFMUUJWDUBKTU) |
| Attestor (server key) | `verapass-attestor` | [GB4X4FC54RMVWFJW75OSMCFCXD64T7FALBT5ICOS5WFDXADBPCBTT4ZZ](https://stellar.expert/explorer/testnet/account/GB4X4FC54RMVWFJW75OSMCFCXD64T7FALBT5ICOS5WFDXADBPCBTT4ZZ) |
| Creator (placeholder for Sukanya) | `verapass-sukanya-placeholder` | `GDFMVBRRVUFWUTEDIZYESOAYUTQQ73VYLVJVMXQPTNZHOELOJ77AMHRX` |
| Demo traveller | `verapass-demo-traveller` | `GDB4SY4VZVHOC6AFARET5EHB4IZJHXEH2PTN2WH64A4552KIDWY5YAGC` |

The creator address is a generated placeholder, not Sukanya's own wallet. Its `licence_hash` is sha256 of the text `verapass-licence-v1|placeholder|tat-licence-check-pending`, because the TAT licence check has not been recorded yet. The contract has no call to move a place to another creator, so switching to Sukanya's real address and licence hash means a fresh deployment with the script (the testnet reset forces one anyway).

The admin and the attestor are separate keys, so the server key can mint stamps but cannot change the registry or upgrade the contract.

## Transactions

| Step | Transaction | Fee charged (XLM) |
|------|-------------|------|
| Upload wasm | [3008b39d...3665](https://stellar.expert/explorer/testnet/tx/3008b39da995aee4fdebec478c488311ecaac2889bd0f55bbc837ad79f613665) | 5.6519 |
| Deploy with constructor (admin, attestor) | [e6b94882...cb95](https://stellar.expert/explorer/testnet/tx/e6b94882e8eda3ffecc851d29709e9acd669f2c703d727e1e0cbbb46bd3ecb95) | 18.61 |
| `add_creator` (placeholder creator) | [162f681c...033d](https://stellar.expert/explorer/testnet/tx/162f681cbbee786d5fe604881fa6424832388b728c47e89d3b9bc784fbe7033d) | 0.2489 |
| `add_place` patong-beach | [8f03cfba...466a](https://stellar.expert/explorer/testnet/tx/8f03cfba9c13a45e1e124f515c554b45fe2e8c6b3293b7aa4b272ec50ac0466a) | 0.2883 |
| `add_place` old-town | [794f6070...acf2](https://stellar.expert/explorer/testnet/tx/794f607098f7f6be93a14107b73b52d3ed04e4ab2f32cfab3762b7b53329acf2) | 0.2843 |
| `add_place` wat-chalong | [edd7d963...6afc](https://stellar.expert/explorer/testnet/tx/edd7d963ce505b18dfeabfaa8c0c686561bf65845dc6a24315bbd18db9276afc) | 0.2883 |
| `add_place` big-buddha | [68e3d62c...0a98](https://stellar.expert/explorer/testnet/tx/68e3d62c2183c4ec01d18e08399c4c2f1bf1537f047e950f583e1d92b4850a98) | 0.2884 |
| `add_place` kata-viewpoint | [f097b4be...802d](https://stellar.expert/explorer/testnet/tx/f097b4be20fde3c466b0dda7786bd790b011ededa682c36d90e7620de0c2802d) | 0.2924 |
| `add_place` promthep-cape | [ea8bfa62...8c17](https://stellar.expert/explorer/testnet/tx/ea8bfa62cc950e8e4a8fc2d5dbc9f4a99f71b369536cfcfc4cd38d55cc088c17) | 0.2924 |
| `add_place` khao-sok-lake | [7669b4f1...3b73](https://stellar.expert/explorer/testnet/tx/7669b4f1bf1c6f3e61f4bc825361a7d549e9130c8ed5a4f5d80fc14200c33b73) | 0.2924 |
| `add_place` secret-reef | [80f14f9f...a1dc](https://stellar.expert/explorer/testnet/tx/80f14f9f2962603f6a1a1e429f693af641fde81410b52021ff665c508e0aa1dc) | 0.2884 |
| `add_place` quiet-snorkel-bay | [fe2503f8...cc5e](https://stellar.expert/explorer/testnet/tx/fe2503f897c8f50751d5465251465118bb66a0e0ece3362e8ab15e7e0dd3cc5e) | 0.2963 |
| `add_place` empty-beach | [5796a628...5e2f](https://stellar.expert/explorer/testnet/tx/5796a6283a662d3e3e5457d0d6a7fba238fadd7c4d8d790970b5dedef3585e2f) | 0.2884 |
| `activate_passport` (demo traveller) | [5d7b6790...cc6a](https://stellar.expert/explorer/testnet/tx/5d7b679035478bb8680fe5f1151158934adea6048902edd94d93004f087abc6a) | 0.1664 |
| `stamp` demo traveller at wat-chalong, token 1 | [3e9431cf...8f3a](https://stellar.expert/explorer/testnet/tx/3e9431cfbb9a3345537c67623d3c3736b45f520d4d72ee7e41cda161212f8f3a) | 0.6641 |

### Later stamps from the API (team test visits)

After the deploy, the team ran three check-ins through the API (`server/attestor.ts`) on 2026-10-09. These are team test visits, not travellers. Each traveller address is a pseudonymous address the server derives by HMAC from a traveller id. The attestor sent each activation and stamp; all succeeded (Horizon, account operations of the attestor).

| Step | Traveller | Place | Token | Transaction | Fee charged (XLM) |
|------|-----------|-------|-------|-------------|------|
| `activate_passport` | `GA5NPXLR...BI4G4` | - | - | [cd558ccd...df59](https://stellar.expert/explorer/testnet/tx/cd558ccdd870d7a48789f29db1498295a2a8c7df56cfa259a28c2fc02cf4df59) | 0.1670 |
| `stamp` | `GA5NPXLR...BI4G4` | wat-chalong | 2 | [4d82543f...700a](https://stellar.expert/explorer/testnet/tx/4d82543fb56428fd06171e3cc7138958ef00a2b6600d235116e45f0f8015700a) | 0.6666 |
| `activate_passport` | `GBLCY2PZ...F4Q4N` | - | - | [413dbdaa...171e](https://stellar.expert/explorer/testnet/tx/413dbdaae445c0069d5481f28c80d75bf02378ae1f4c6c8ac1c021c31012171e) | 0.1670 |
| `stamp` | `GBLCY2PZ...F4Q4N` | wat-chalong | 3 | [d60f48d5...5a17](https://stellar.expert/explorer/testnet/tx/d60f48d57445e5289f58655c2c005f0e7f26aeb1b2563d5dad86a933b5f95a17) | 0.6666 |
| `activate_passport` | `GAO3HGZE...C7LMO` | - | - | [c1796257...fb38](https://stellar.expert/explorer/testnet/tx/c179625738aabe5fa5a26ba80e409ca5c1cdd8ba1ebf4c24dcadd3e43922fb38) | 0.1670 |
| `stamp` | `GAO3HGZE...C7LMO` | old-town | 4 | [a0418077...f638](https://stellar.expert/explorer/testnet/tx/a0418077886bbdc9f62e313da01088c6d0e89791a313f74092a77329e43ff638) | 0.6548 |

Token ids confirmed with `get_stamp` (simulated) on 2026-10-09. After these, `place_visit_count("wat-chalong")` reads `3`.

### attest.so mirror test

On 2026-10-09 the attestor key registered a Verapass stamp schema on attest.so's testnet protocol contract `CA2QET2KOUGAECEVYQEQT3SLDDZRUMAQHI7MMDTFVJY62WTHUTERAUCD` and mirrored token 4 as an attestation. This tests composability only; the Verapass contract stays the source of truth.

| Step | Result | Transaction | Fee charged (XLM) |
|------|--------|-------------|------|
| `register` schema "Verapass stamp v0" | schema uid `8de9e7e0ff5493c6554fb13bdaf10c174dd6e53a3d69fbb46e0ad327da6054d3` | [6f0a58bf...7fc9](https://stellar.expert/explorer/testnet/tx/6f0a58bf2bb699eb35d32e8d61970c898772af84445a5b97cf03084c01bc7fc9) | 9.3657 |
| `attest` token 4 | attestation uid `d36ce3df50f64f7e31f36ec375c87c51693630caaa1f5e849647374957c566ba` | [4a67c5aa...61ab](https://stellar.expert/explorer/testnet/tx/4a67c5aa9b342c0c6c25fb5dc5729b575593c46a9af8116ba45f9319d12e61ab) | 0.0656 |

### Notes

The demo passport's `payment_ref` is sha256 of the made-up id `cs_test_verapass_testnet_demo_1`, not a real Stripe session. The demo stamp's `receipt_hash` is sha256 of a demo string, not a real check-in receipt. The 10 places are every place in `server/places.ts` at deploy time. Their `geo_commitment` values use a salt kept outside the repo (see README).

## Checked after deploy

Read-only calls (simulated, not submitted) on 2026-10-09:

| Call | Result |
|------|--------|
| `has_stamp(traveller, "wat-chalong")` | `true` |
| `place_visit_count("wat-chalong")` | `1` |
| `stamps_of(traveller)` | `["wat-chalong"]` |
| `get_stamp(traveller, "wat-chalong")` | `token_id 1`, `checked_in_at 1791519629`, `stamped_at 1791519637` (2026-10-09 04:20:37 UTC) |
| `balance(traveller)`, `owner_of(1)` | `1`, the demo traveller |
| `creator_of("secret-reef")` | the placeholder creator |
| `admin()`, `attestor()`, `version()` | the addresses above, `1` |

Rejections seen on testnet:

- A second `stamp` for the same traveller and place, signed by the attestor, failed in simulation with `Error(Contract, #10)` (`AlreadyStamped`). Nothing was submitted.
- `transfer(traveller, contract, 1)` failed with `Error(Contract, #12)` (`NonTransferable`).
- A `stamp` submitted with the admin as source could not be sent: the CLI stopped with `Missing signing key for account GB4X4FC5...T4ZZ` (the attestor), because the contract asks for the attestor's signature. `has_stamp(traveller, "old-town")` stayed `false`. On-chain rejection of wrong signers is covered by the unit tests.

## Fees

The "Fee charged" column in the tables on this page is Horizon's `fee_charged` for each transaction (`https://horizon-testnet.stellar.org/transactions/<hash>`), read on 2026-10-12 and converted from stroops (1 XLM = 10,000,000 stroops). It is what the source account actually paid: the inclusion fee plus the Soroban resource fee, after the refund of unused resources. Most of it is rent for the new ledger entries each call writes.

| Call | Paid by | Fee charged on testnet |
|------|---------|------------------------|
| `stamp` (first stamp for a traveller at a place) | attestor | 0.6548 to 0.6666 XLM (4 transactions) |
| `activate_passport` | attestor | 0.1664 to 0.1670 XLM (4 transactions) |
| `add_place` | admin | 0.2843 to 0.2963 XLM (10 transactions) |
| `add_creator` | admin | 0.2489 XLM |
| attest.so `attest` (mirror of one stamp) | attestor | 0.0656 XLM |
| attest.so `register` (schema, one-off) | attestor | 9.3657 XLM |
| Wasm upload and deploy (one-off) | admin | 5.6519 XLM and 18.61 XLM |
| TTL extension to 120 days: instance, Wasm code (one-off per extension) | admin | 0.2400 XLM and 80.69 XLM |

A repeat visit costs nothing on chain: the attestor reads the existing stamp and sends no transaction. These are testnet figures under testnet's fee settings, not a mainnet quote. Mainnet fees are measured and published at launch (T3).

## Calling it

```bash
export PATH="$PWD/contracts/.tools/bin:$PATH"
stellar contract invoke --id CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65 \
  --source verapass-admin --network testnet --send=no -- \
  place_visit_count --place_id wat-chalong
```

## TTL extension (2026-10-10)

The contract's own calls keep the instance alive for at most 30 days past the last admin or attestor call, so the instance and its Wasm entry were set to expire around ledger 5,617,594 (about 2026-11-08), before the SCF panel window (2026-11-11 to 2026-11-18). Both were extended with `stellar contract extend` (one call with `--id`, one with `--wasm-hash`), admin identity `verapass-admin` as source. Horizon shows two `extend_footprint_ttl` operations with `extend_to` 2,073,600 ledgers (120 days).

| Entry | Transaction | Ledger | New live-until ledger | About | Fee charged (XLM) |
|-------|-------------|--------|-----------------------|-------|------|
| Contract instance | [82664414...b7](https://stellar.expert/explorer/testnet/tx/82664414a23514a51080baa8edffbc02538522c00252c06cad3804d9515ac0b7) | 5,122,173 | 7,195,773 | 2027-02-07 | 0.2400 |
| Wasm code `9f12baf5...a7d1` | [a59d254c...0f](https://stellar.expert/explorer/testnet/tx/a59d254c056fe24a201b0cbe1fd6c3a0eee23dccbf82c70c77d0b199027be10f) | 5,122,174 | 7,195,774 | 2027-02-07 | 80.69 |

Read back with RPC `getLedgerEntries` at ledger 5,125,518 (2026-10-10 16:52 UTC). Dates assume 5 seconds per ledger from that point.

The persistent entries did not need a separate extension. Every write extends them to 120 days, and all of them were written on 2026-10-09, so they read live until ledgers 7,172,795 to 7,173,353 (about 2027-02-06):

- `Creator` for the placeholder creator
- `Place` for all 10 places
- `Token` 1 to 4
- `Passport`, `StampsOf` and `Stamp` for the demo traveller and the three team test travellers

Everything now outlives 2026-12-15. The scheduled testnet reset on 2026-12-16 wipes the contract regardless of TTL, so after that the script has to be re-run and this file updated.
