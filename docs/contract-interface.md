# Contract interface: verapass_stamps v1

This page describes the contract that is deployed on Stellar testnet today. Everything here is read from `contracts/verapass_stamps/src/lib.rs` (contract `VERSION = 1`, soroban-sdk 29.0.0) and checked against the live deployment where a check is possible. The planned v2 changes are listed at the end and are not built.

| Item | Value |
|---|---|
| Network | Stellar testnet, passphrase `Test SDF Network ; September 2015` |
| Contract id | `CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65` |
| Wasm hash | `9f12baf585c2dff7c7e2bcb5da8a3ad6ffee968932b55069144b4f024171a7d1` |
| Admin | `GBZWMQM2Y3XRELOHYK3IQ57NAARTI4TTWAGHGHLUEXAUFMUUJWDUBKTU` |
| Attestor (server key) | `GB4X4FC54RMVWFJW75OSMCFCXD64T7FALBT5ICOS5WFDXADBPCBTT4ZZ` |
| Explorer | [stellar.expert](https://stellar.expert/explorer/testnet/contract/CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65), [Stellar Lab](https://lab.stellar.org/r/testnet/contract/CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65) |
| Source | `contracts/verapass_stamps/src/lib.rs`, tests in `src/test.rs` (21 tests) |

Testnet resets on 2026-12-16 and wipes this contract. After the reset it is redeployed with `contracts/scripts/deploy-testnet.sh` and the new id is published in `contracts/DEPLOYMENT.md`.

## Roles

| Role | Who | Set by |
|---|---|---|
| Admin | one Stellar address | the constructor; changed only by `propose_admin` then `accept_admin` |
| Attestor | one Stellar address, the Verapass server key | the constructor; changed by the admin with `set_attestor` |
| Creator | an address in the registry | the admin with `add_creator` |
| Traveller | any address | nobody; the attestor activates a passport for it |

"Admin" in the tables below means the call runs `admin.require_auth()` on the stored admin address. "Attestor" means `attestor.require_auth()` on the stored attestor address. Creators and travellers sign nothing in v1. A missing or wrong signature fails in the host auth check with a host error, not with one of the contract error codes below.

## Constants

| Name | Value | Used by |
|---|---|---|
| `VERSION` | `1` | `version()` |
| `MAX_PLACE_ID_LEN` | `32` bytes | `add_place` |
| `MAX_STAMP_AGE_SECS` | `86400` (24 hours) | `stamp` |
| `MAX_CLOCK_SKEW_SECS` | `300` (5 minutes) | `stamp` |

## Write functions

| Function | Args | Returns | Auth | Errors | Event |
|---|---|---|---|---|---|
| `__constructor` | `admin: Address, attestor: Address` | - | none (runs once, at deploy) | - | - |
| `set_attestor` | `attestor: Address` | - | admin | - | `attestor_changed` |
| `propose_admin` | `pending_admin: Address` | - | admin | - | `admin_proposed` |
| `accept_admin` | none | `Result<(), Error>` | the pending admin | 1 | `admin_changed` |
| `upgrade` | `new_wasm_hash: BytesN<32>` | - | admin | - | `upgraded` |
| `add_creator` | `creator: Address, licence_hash: BytesN<32>` | `Result<(), Error>` | admin | 2 | `creator_added` |
| `revoke_creator` | `creator: Address` | `Result<(), Error>` | admin | 3, 4 | `creator_revoked` |
| `add_place` | `place_id: String, creator: Address, geo_commitment: BytesN<32>` | `Result<(), Error>` | admin | 7, 3, 4, 5 | `place_added` |
| `activate_passport` | `traveller: Address, payment_ref: BytesN<32>` | `Result<(), Error>` | attestor | 9 | `passport_activated` |
| `stamp` | `traveller: Address, place_id: String, checkin_receipt_hash: BytesN<32>, ts: u64` | `Result<u32, Error>` (token id) | attestor | 11, 6, 3, 4, 8, 10 | `stamped` |

Errors are listed in the order the function checks them.

### Behaviour notes

- `__constructor` stores the admin and the attestor and sets the next token id to 1.
- `accept_admin` reads the pending admin, requires its signature, makes it the admin and clears the proposal. With no proposal it fails with `NoPendingAdmin` (1).
- `upgrade` replaces the code with an already uploaded wasm (`stellar contract upload`). Storage and the contract id stay.
- `add_creator` writes `CreatorRecord { licence_hash, active: true, added_at }`. The creator does not sign. A second call for the same address fails with `CreatorAlreadyRegistered` (2), also after a revoke.
- `revoke_creator` sets `active` to `false`. A revoked creator's places stop accepting stamps; stamps already minted stay. v1 has no call to re-activate a creator, and `add_creator` refuses an address that is already registered, so a revoke is final for that address.
- `add_place` checks the id format first: 1 to 32 bytes, each `a-z`, `0-9` or `-` (`InvalidPlaceId`, 7). Then the creator must exist (3) and be active (4), and the id must be new (5). It writes `PlaceRecord { creator, geo_commitment, visits: 0, added_at }`. v1 cannot move a place to another creator.
- `activate_passport` stores `payment_ref` for the traveller. A repeat call with the same `payment_ref` returns `Ok` and emits no event, so a retried call is safe. The server calls it before a traveller's first stamp, with the sha256 of the Stripe Checkout Session id for a paid pass or a free-passport ref otherwise (`paymentRef` in `server/attestor.ts`). A call with a different `payment_ref` fails with `PassportAlreadyActive` (9). v1 has no way to deactivate a passport.
- `stamp` checks, in order: `ts` is not more than 300 seconds ahead of ledger time and not more than 86,400 seconds behind it (`InvalidTimestamp`, 11); the place exists (6); the place's creator exists (3) and is active (4); the traveller has a passport (8); the traveller has no stamp for this place (10). It then takes the next token id, writes the stamp, appends the place id to the traveller's list, writes the token record, adds 1 to the place's `visits`, emits `stamped` and returns the token id. `ts` is unix seconds as reported by the attestor; `stamped_at` is the ledger time.
- The contract does not check location, the server nonce or the payment. Those are checked off-chain by the check-in API, which passes the result in as `checkin_receipt_hash` (the sha256 proof hash of the check-in, see [verify-a-receipt.md](verify-a-receipt.md)).

## Read functions

Reads need no signature and no fee. Call them by simulating a transaction (see [integration-guide.md](integration-guide.md)).

| Function | Args | Returns | Errors |
|---|---|---|---|
| `admin` | none | `Address` | - |
| `attestor` | none | `Address` | - |
| `version` | none | `u32` (`1`) | - |
| `has_stamp` | `traveller: Address, place_id: String` | `bool` | - |
| `get_stamp` | `traveller: Address, place_id: String` | `Option<StampRecord>` | - |
| `stamps_of` | `traveller: Address` | `Vec<String>`, place ids in stamping order (empty when none) | - |
| `place_visit_count` | `place_id: String` | `Result<u32, Error>` | 6 |
| `get_place` | `place_id: String` | `Option<PlaceRecord>` | - |
| `creator_of` | `place_id: String` | `Result<Address, Error>` | 6 |
| `get_creator` | `creator: Address` | `Option<CreatorRecord>` | - |
| `is_creator_active` | `creator: Address` | `bool` (`false` for an unknown address) | - |
| `is_passport_active` | `traveller: Address` | `bool` | - |
| `name` | none | `String`, `"Verapass Stamps"` | - |
| `symbol` | none | `String`, `"VPSTAMP"` | - |
| `balance` | `owner: Address` | `u32`, the length of `stamps_of(owner)` | - |
| `owner_of` | `token_id: u32` | `Result<Address, Error>` | 13 |
| `token_place` | `token_id: u32` | `Result<String, Error>` | 13 |

### Always-failing functions

Stamps cannot move. These take the usual NFT arguments, check no signature and always return `NonTransferable` (12):

| Function | Args |
|---|---|
| `transfer` | `from: Address, to: Address, token_id: u32` |
| `transfer_from` | `spender: Address, from: Address, to: Address, token_id: u32` |
| `approve` | `approver: Address, approved: Address, token_id: u32, live_until_ledger: u32` |

The read names `name`, `symbol`, `balance` and `owner_of` follow SEP-50, which is a Draft that assumes transferable tokens. There is no `token_uri` and no mint event in the SEP-50 sense, so we do not claim SEP-50 compatibility or wallet display.

## Types

```rust
pub struct CreatorRecord {
    pub licence_hash: BytesN<32>, // sha256 of the off-chain verification record
    pub active: bool,
    pub added_at: u64,            // ledger time
}

pub struct PlaceRecord {
    pub creator: Address,
    pub geo_commitment: BytesN<32>, // commitment to the check-in point and radius
    pub visits: u32,
    pub added_at: u64,
}

pub struct StampRecord {
    pub token_id: u32,
    pub receipt_hash: BytesN<32>, // sha256 proof hash of the check-in
    pub checked_in_at: u64,       // check-in time from the attestor, unix seconds
    pub stamped_at: u64,          // ledger time at mint
}

pub struct TokenRecord {          // stored, not returned by any read as a whole
    pub owner: Address,
    pub place_id: String,
}
```

`geo_commitment` is sha256 of `verapass-geo-v1|<id>|<lat>|<lng>|<radiusM>|<salt_hex>`, computed by `contracts/scripts/place-commitments.ts`. The salt is kept outside the repository, so the location of a hidden place cannot be brute-forced from its commitment.

Example read on testnet (2026-10-10), `get_stamp` for the demo traveller at `wat-chalong`:

```json
{"checked_in_at":1791519629,"receipt_hash":"cec89b5d88fcbe4276527226d4d0d3770435824b409892a00b59a02b7299ebd2","stamped_at":1791519637,"token_id":1}
```

## Errors

Returned as `Error(Contract, #n)`.

| n | Name | Raised by | Meaning |
|---|---|---|---|
| 1 | `NoPendingAdmin` | `accept_admin` | no admin proposal to accept |
| 2 | `CreatorAlreadyRegistered` | `add_creator` | the address is already in the registry |
| 3 | `CreatorNotFound` | `revoke_creator`, `add_place`, `stamp` | no such creator |
| 4 | `CreatorRevoked` | `revoke_creator`, `add_place`, `stamp` | the creator is revoked (for `revoke_creator`: already revoked) |
| 5 | `PlaceAlreadyRegistered` | `add_place` | the place id is taken |
| 6 | `PlaceNotFound` | `stamp`, `place_visit_count`, `creator_of` | no such place |
| 7 | `InvalidPlaceId` | `add_place` | empty, longer than 32 bytes, or not `[a-z0-9-]` |
| 8 | `PassportNotActive` | `stamp` | the traveller has no passport |
| 9 | `PassportAlreadyActive` | `activate_passport` | a passport exists with a different `payment_ref` |
| 10 | `AlreadyStamped` | `stamp` | one stamp per traveller per place |
| 11 | `InvalidTimestamp` | `stamp` | `ts` more than 5 minutes ahead or more than 24 hours old |
| 12 | `NonTransferable` | `transfer`, `transfer_from`, `approve` | stamps never move |
| 13 | `StampNotFound` | `owner_of`, `token_place` | no such token id |

Seen on testnet: `place_visit_count("nowhere")` fails with `Error(Contract, #6)`, `owner_of(99)` with `#13`, and `transfer` with `#12`. The server's attestor treats `AlreadyStamped` on a retry as success and returns the existing token (`server/attestor.ts`).

## Events

Each event's first topic is its name in snake_case. Fields marked as topics follow it; the other fields are the event data, published as a map keyed by field name.

| Event | Topics after the name | Data map |
|---|---|---|
| `creator_added` | `creator: Address` | `licence_hash: BytesN<32>` |
| `creator_revoked` | `creator: Address` | no fields |
| `place_added` | `place_id: String` | `creator: Address`, `geo_commitment: BytesN<32>` |
| `passport_activated` | `traveller: Address` | `payment_ref: BytesN<32>` |
| `stamped` | `traveller: Address`, `place_id: String` | `token_id: u32`, `receipt_hash: BytesN<32>`, `checked_in_at: u64` |
| `attestor_changed` | none | `attestor: Address` |
| `admin_proposed` | none | `pending_admin: Address` |
| `admin_changed` | none | `admin: Address` |
| `upgraded` | none | `wasm_hash: BytesN<32>` |

A repeated `activate_passport` with the same `payment_ref` emits nothing. Failing calls emit nothing.

A `stamped` event as returned by Soroban RPC `getEvents` on testnet (token 1):

```json
{
  "ledger": 5099210,
  "txHash": "3e9431cfbb9a3345537c67623d3c3736b45f520d4d72ee7e41cda161212f8f3a",
  "topic": ["AAAADwAAAAdzdGFtcGVkAA==", "AAAAEgAAAAAAAAAAw8ljlc1O4XgFBEk+kOHiMpPch9Pm3Vj+4Dne6Ugdsdw=", "AAAADgAAAAt3YXQtY2hhbG9uZwA="],
  "value": "AAAAEQAAAAEAAAADAAAADwAAAA1jaGVja2VkX2luX2F0AAAAAAAABQAAAABqyGuNAAAADwAAAAxyZWNlaXB0X2hhc2gAAAANAAAAIM7Im12I/L5CdlJyJtTQ03cENYJLQJiSoAtZoCtymevSAAAADwAAAAh0b2tlbl9pZAAAAAMAAAAB"
}
```

Decoded: topics `stamped`, the traveller address, `"wat-chalong"`; data `{ checked_in_at: 1791519629, receipt_hash: cec89b5d..., token_id: 1 }`. Topic and value are base64 XDR `ScVal`s. Soroban RPC keeps about 7 days of events.

## Storage

| Key | Storage | Value | Written by |
|---|---|---|---|
| `Admin` | instance | `Address` | constructor, `accept_admin` |
| `PendingAdmin` | instance | `Address` | `propose_admin` (removed by `accept_admin`) |
| `Attestor` | instance | `Address` | constructor, `set_attestor` |
| `NextTokenId` | instance | `u32` | constructor, `stamp` |
| `Creator(Address)` | persistent | `CreatorRecord` | `add_creator`, `revoke_creator` |
| `Place(String)` | persistent | `PlaceRecord` | `add_place`, `stamp` (visit count) |
| `Passport(Address)` | persistent | `BytesN<32>` (the `payment_ref`) | `activate_passport` |
| `Stamp(Address, String)` | persistent | `StampRecord` | `stamp` |
| `StampsOf(Address)` | persistent | `Vec<String>` | `stamp` |
| `Token(u32)` | persistent | `TokenRecord` | `stamp` |

Keys are a `contracttype` enum, so on the ledger each key is an `ScVal` vector of the variant name as a symbol followed by its fields. For example `Place("wat-chalong")` is `["Place", "wat-chalong"]`, which the CLI reads with:

```bash
stellar contract read --network testnet --id CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65 \
  --key-xdr AAAAEAAAAAEAAAACAAAADwAAAAVQbGFjZQAAAAAAAA4AAAALd2F0LWNoYWxvbmcA
```

Only hashes, ids and addresses are stored. No names, coordinates or card data. `stamps_of` keeps one list per traveller, one entry per stamped place.

A stamp writes 5 entries: `NextTokenId` (instance), `Stamp`, `StampsOf`, `Token` and the `Place` record.

## TTL policy

Ledgers are counted at about 5 seconds each (`DAY_IN_LEDGERS = 17_280`).

| Storage | Extended when | Threshold | Extended to |
|---|---|---|---|
| Instance (admin, attestor, next token id) | constructor, every admin-signed or attestor-signed call, `accept_admin` | 7 days (120,960 ledgers) | 30 days (518,400 ledgers) |
| Persistent entries | each time that entry is written | 30 days (518,400 ledgers) | 120 days (2,073,600 ledgers) |

`extend_ttl(threshold, extend_to)` only acts when the remaining TTL is below the threshold. Reads never extend a TTL. A persistent entry is extended only when it is written: a stamp extends the `Place` record it updates, but not the `Creator` or `Passport` entries it only reads.

Checked on testnet on 2026-10-10 with `stellar contract read` (last modified ledger, live-until ledger): `Place("wat-chalong")` 5,099,750 and 7,172,799, about 120 days; the contract instance 5,099,753 and 5,617,594, about 30 days. The instance is extended by any admin or attestor call made once fewer than 7 days remain. On 2026-10-10 the instance and the Wasm code entry were also extended by hand to live-until ledgers 7,195,773 and 7,195,774, about 2027-02-07 (see `contracts/DEPLOYMENT.md`, "TTL extension").

Since Protocol 23, archived persistent entries are restored automatically when a transaction's footprint includes them. The v1 server attestor does not handle that case: when simulation asks for a restore it reports "contract state is archived and needs a restore" and retries (`server/attestor.ts`).

## Calling it from the CLI

Argument names are the Rust names. `Address` is a G or C string, `String` is a plain string, `BytesN<32>` is 64 hex characters, numbers are plain numbers.

```bash
C=CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65
G=GDB4SY4VZVHOC6AFARET5EHB4IZJHXEH2PTN2WH64A4552KIDWY5YAGC   # any valid G address; it signs nothing

stellar contract invoke --network testnet --send=no --id $C --source-account $G -- place_visit_count --place_id wat-chalong
stellar contract invoke --network testnet --send=no --id $C --source-account $G -- get_stamp --traveller $G --place_id wat-chalong
stellar contract invoke --network testnet --send=no --id $C --source-account $G -- owner_of --token_id 4
```

`--send=no` only simulates: nothing is signed or submitted. Write calls need the admin or attestor key and are not something a third party can make.

## Planned in contract v2 (grant tranche 1, not built)

These are deliverable D1.1 of the SCF proposal. None of it is in the deployed contract.

- `stamp(traveller, place_id, checkin_nonce, receipt_hash, ts)` that calls `traveller.require_auth()` and also requires the attestor, so the traveller's signature covers the server nonce.
- A passport-issuer role separate from the attestor: only the issuer calls `activate_passport` and the new `deactivate_passport`.
- A per-passport daily stamp cap and a contract-wide daily mint cap.
- A two-step creator registry (the creator requests, a verifier approves, either side can revoke) and `move_place`.
- Leaner storage: one of `Token` or `StampsOf` dropped and derived from events.

v2 changes the `stamp` signature and adds roles, so integrations written against v1 need an update. The read functions above are expected to keep their names, but that is a plan, not a guarantee, until v2 ships.
