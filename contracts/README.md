# Verapass contracts

`verapass_stamps` is the Soroban contract behind Verapass. It holds the registry of verified creators and their places, and mints non-transferable stamps that prove a traveller checked in at a place. The testnet deployment is described in [DEPLOYMENT.md](DEPLOYMENT.md).

Contract code and tests were written with AI assistance (Claude) and reviewed by the founders.

## What the contract enforces

- Only the admin can register creators and places, revoke creators, rotate the attestor, hand over the admin role or upgrade the code.
- Only the attestor (the Verapass server key) can activate a passport or mint a stamp. The traveller signs nothing on-chain and needs no XLM.
- A place must belong to an active creator. A revoked creator's places stop accepting stamps; stamps already minted stay.
- A stamp needs an active passport (activated after the Stripe payment), and there is one stamp per traveller per place.
- The check-in time passed to `stamp` must be no more than 5 minutes ahead of ledger time and no more than 24 hours old.
- Stamps cannot move: `transfer`, `transfer_from` and `approve` always fail with `NonTransferable`.
- Each place keeps a visit count ("validated by N real visitors").

The geofence, the server nonce and the time window are checked off-chain by the check-in API. The contract records the result as `checkin_receipt_hash` and enforces the rules above.

## What goes on-chain

Only ids, addresses and 32-byte hashes. No names, coordinates or other personal data.

| Data | Stored as |
|------|-----------|
| Creator | Stellar address, `licence_hash` = sha256 of the off-chain verification record (TAT licence check for the pilot) |
| Place | id (kebab-case slug, max 32 bytes, `[a-z0-9-]`), creator address, `geo_commitment` |
| Passport | traveller address, `payment_ref` = sha256(Stripe Checkout Session id) |
| Stamp | traveller address, place id, token id, `receipt_hash` = sha256 of the server check-in receipt, check-in time, ledger time |

`geo_commitment` = sha256(`verapass-geo-v1|<id>|<lat>|<lng>|<radiusM>|<salt_hex>`), computed by [scripts/place-commitments.ts](scripts/place-commitments.ts). The salt (32 random bytes, env `VERAPASS_GEO_SALT`) stops anyone from brute-forcing the location of a hidden place out of its commitment. It is kept outside the repo.

## Versions

| Tool | Version | Why |
|------|---------|-----|
| soroban-sdk | 29.0.0 | Latest stable on crates.io (2026-10-07). Matches testnet, which runs protocol 29 (checked with RPC `getNetwork` on 2026-10-09). Declares `rust-version = 1.91.0`. |
| Rust | 1.93.0, pinned in [rust-toolchain.toml](rust-toolchain.toml) | The contract needs 1.91 or newer (soroban-sdk MSRV). Building stellar-cli 28.1.0 from source needs 1.93.0, so one pinned toolchain covers both. rustup installs it for this directory only; the global default is untouched. |
| Target | `wasm32v1-none` | The target Stellar's setup guide requires. Listed in rust-toolchain.toml so rustup adds it. |
| stellar-cli | 28.1.0, installed into `contracts/.tools` | soroban-sdk 29 refuses plain `cargo build` for wasm and asks for `stellar contract build` from stellar-cli 25.2.0 or newer. The machine has 23.4.0. |

Install the CLI locally (about 10 minutes, nothing global changes):

```bash
cd contracts
cargo install --locked stellar-cli@28.1.0 --root "$PWD/.tools"
export PATH="$PWD/.tools/bin:$PATH"
```

## Build and test

```bash
cd contracts
cargo test                                # unit tests (soroban-sdk testutils)
cargo clippy --all-targets -- -D warnings
stellar contract build                    # -> target/wasm32v1-none/release/verapass_stamps.wasm
```

The tests cover every public function: happy path, auth failures (no signature, admin trying to stamp, traveller signing their own stamp, attestor trying to edit the registry, old attestor after rotation, old admin accepting a handover), duplicates (stamp, creator, place, passport), revocation, counts across travellers and places, timestamp and place id validation, the non-transferable methods and events.

## Deploy to testnet

```bash
export VERAPASS_GEO_SALT=$(openssl rand -hex 32)   # store it in your password manager, not in the repo
contracts/scripts/deploy-testnet.sh
```

The script builds the wasm, creates CLI identities (`verapass-admin` and `verapass-attestor` are funded by Friendbot; `verapass-sukanya-placeholder` and `verapass-demo-traveller` are unfunded addresses), deploys with the constructor, registers the creator and every place from `server/places.ts`, activates one demo passport and mints one demo stamp. Secret keys stay in the CLI keystore (`~/.config/stellar`). Testnet resets wipe the deployment (next scheduled reset 2026-12-16); re-run the script afterwards.

To upgrade in place: `stellar contract upload --wasm <new.wasm> --source verapass-admin --network testnet` prints a wasm hash, then `stellar contract invoke --id <contract> --source verapass-admin --network testnet -- upgrade --new_wasm_hash <hash>`.

## Interface for the server (TypeScript)

Generate a typed client with `stellar contract bindings typescript --network testnet --contract-id <id> --output-dir <dir>`, or call it with `@stellar/stellar-sdk` (`Contract.call` plus `nativeToScVal`). Type mapping:

| Soroban | JS / `nativeToScVal` |
|---------|----------------------|
| `Address` | G... or C... string, `nativeToScVal(addr, { type: 'address' })` or `new Address(addr).toScVal()` |
| `String` | string, `nativeToScVal(s, { type: 'string' })` (not `symbol`) |
| `BytesN<32>` | 32-byte `Buffer`, `nativeToScVal(Buffer.from(hex, 'hex'))` (becomes `scvBytes`) |
| `u32` | number, `nativeToScVal(n, { type: 'u32' })` |
| `u64` | bigint, `nativeToScVal(BigInt(ts), { type: 'u64' })` |
| `bool`, `Vec<String>`, `Option<T>` | `scValToNative` gives boolean, string[], value or undefined |

Writes. The signer must sign the Soroban auth entry; with the source account equal to the signer, the default source-account auth covers it.

| Function | Args | Returns | Signer |
|----------|------|---------|--------|
| `activate_passport` | `traveller: Address, payment_ref: BytesN<32>` | `void` | attestor |
| `stamp` | `traveller: Address, place_id: String, checkin_receipt_hash: BytesN<32>, ts: u64` | `u32` token id | attestor |
| `add_creator` | `creator: Address, licence_hash: BytesN<32>` | `void` | admin |
| `revoke_creator` | `creator: Address` | `void` | admin |
| `add_place` | `place_id: String, creator: Address, geo_commitment: BytesN<32>` | `void` | admin |
| `set_attestor` | `attestor: Address` | `void` | admin |
| `propose_admin` | `pending_admin: Address` | `void` | admin |
| `accept_admin` | none | `void` | pending admin |
| `upgrade` | `new_wasm_hash: BytesN<32>` | `void` | admin |

Reads (simulate only, no fee, no signature):

| Function | Args | Returns |
|----------|------|---------|
| `has_stamp` | `traveller: Address, place_id: String` | `bool` |
| `get_stamp` | `traveller: Address, place_id: String` | `Option<StampRecord>` `{ token_id: u32, receipt_hash: BytesN<32>, checked_in_at: u64, stamped_at: u64 }` |
| `stamps_of` | `traveller: Address` | `Vec<String>` place ids in stamping order |
| `place_visit_count` | `place_id: String` | `u32` (error `PlaceNotFound` for unknown ids) |
| `creator_of` | `place_id: String` | `Address` |
| `get_place` | `place_id: String` | `Option<PlaceRecord>` `{ creator, geo_commitment, visits: u32, added_at: u64 }` |
| `get_creator` | `creator: Address` | `Option<CreatorRecord>` `{ licence_hash, active: bool, added_at: u64 }` |
| `is_creator_active` | `creator: Address` | `bool` |
| `is_passport_active` | `traveller: Address` | `bool` |
| `balance` | `owner: Address` | `u32` |
| `owner_of`, `token_place` | `token_id: u32` | `Address`, `String` |
| `admin`, `attestor`, `version`, `name`, `symbol` | none | `Address`, `Address`, `u32`, `String`, `String` |

Mapping from the server's check-in receipt: `checkin_receipt_hash` = the receipt's `proofHash` (sha256 hex, decode to 32 bytes); `ts` = check-in time in unix seconds; `payment_ref` = sha256(Checkout Session id). Call `activate_passport` before the first `stamp` for a traveller, or `stamp` fails with `PassportNotActive`. A retried `activate_passport` with the same `payment_ref` succeeds without changes.

Errors come back as `Error(Contract, #n)`:

| n | Name | n | Name |
|---|------|---|------|
| 1 | NoPendingAdmin | 8 | PassportNotActive |
| 2 | CreatorAlreadyRegistered | 9 | PassportAlreadyActive |
| 3 | CreatorNotFound | 10 | AlreadyStamped |
| 4 | CreatorRevoked | 11 | InvalidTimestamp |
| 5 | PlaceAlreadyRegistered | 12 | NonTransferable |
| 6 | PlaceNotFound | 13 | StampNotFound |
| 7 | InvalidPlaceId | | |

A missing or wrong signature fails in the host auth check with a host error, not with one of these codes. Simulation runs in recording mode and does not check signatures, so a simulated write can succeed and the real submission still fail. Treat `AlreadyStamped` as success when retrying a stamp.

Events (topics, then data map). Each event's first topic is its snake_case name:

| Event | Topics | Data |
|-------|--------|------|
| `stamped` | `traveller`, `place_id` | `token_id`, `receipt_hash`, `checked_in_at` |
| `passport_activated` | `traveller` | `payment_ref` |
| `creator_added` | `creator` | `licence_hash` |
| `creator_revoked` | `creator` | none |
| `place_added` | `place_id` | `creator`, `geo_commitment` |
| `attestor_changed`, `admin_proposed`, `admin_changed`, `upgraded` | none | the new value |

## Design notes

- The function names follow research/tech-architecture.md with two differences: the visit counter is `place_visit_count` (an earlier draft called it `place_visits`), and `token_uri` is left out because stamps carry no off-chain metadata yet.
- SEP-50 is a draft and assumes transferability, and OpenZeppelin `stellar-tokens` documents no soulbound extension, so this is a custom contract with SEP-50 read names (`name`, `symbol`, `balance`, `owner_of`) so tools can read stamps the familiar way. It has no `token_uri` and no `mint` event, so it does not claim SEP-50 compatibility or wallet display.
- Storage: admin, attestor and the token counter are instance storage; creators, places, passports and stamps are persistent storage, with TTL extended to 120 days on a write once fewer than 30 days remain (the instance: to 30 days on an admin or attestor call once fewer than 7 remain). Since protocol 23 a transaction that includes an archived entry in its footprint restores it automatically; the v1 server attestor does not build such transactions yet (planned for T1).
- `stamps_of` stores one list per traveller. It grows by one entry per place, and the pilot has 10 places.
