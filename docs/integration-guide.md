# Integration guide: reading Verapass stamps from another app

This page is for a second app, a guide's own site, or anyone who wants to use Verapass data without going through the Verapass web app. It is split in two: what you can do on testnet today with the Stellar CLI or Soroban RPC, and what the grant tranches add. The second part is a plan, not working code.

## Part 1: what works today

Everything in this part was run against testnet on 2026-10-10. No keys, no account and no XLM are needed: reads are simulated transactions, and simulation does not check signatures or charge fees.

### What is on chain

| Data | How to read it | Notes |
|---|---|---|
| Creators | `get_creator(address)`, `is_creator_active(address)`, `creator_added` events | today one placeholder creator, not Sukanya's own wallet (see `contracts/DEPLOYMENT.md`) |
| Places | `get_place(id)`, `creator_of(id)`, `place_added` events | 10 places, ids such as `wat-chalong`, `old-town`, `secret-reef` |
| Visit count per place | `place_visit_count(id)` | the number of stamps minted at that place |
| Stamps of a traveller | `stamps_of(address)`, `has_stamp(address, id)`, `get_stamp(address, id)`, `balance(address)` | one stamp per traveller per place |
| A stamp by token id | `owner_of(id)`, `token_place(id)` | token ids start at 1 |
| Stamp history | `stamped` events | about 7 days on RPC; older history from an archive source or an explorer |

What a stamp means: the Verapass attestor accepted a check-in under the published server rules (one-time nonce, time window, geofence, accuracy cap, speed check) and the contract's own rules held (active creator, active passport, first stamp at this place). It does not mean the contract saw the traveller there. Browser GPS can be spoofed; see "What the server can and cannot prove" in the code repository README.

The full function, event and error list is in [contract-interface.md](contract-interface.md).

### Read with the Stellar CLI

Install `stellar` (stellar-cli). The commands below were run with 28.1.0, the version the repository installs under `contracts/.tools` (see `contracts/README.md`). Testnet is built in as `--network testnet`.

```bash
C=CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65
G=GDB4SY4VZVHOC6AFARET5EHB4IZJHXEH2PTN2WH64A4552KIDWY5YAGC   # simulation source; any valid G address

# "Validated by N real visitors"
stellar contract invoke --network testnet --send=no --id $C --source-account $G -- place_visit_count --place_id wat-chalong
# -> 3

# who vouches for the place, and is that creator still active?
stellar contract invoke --network testnet --send=no --id $C --source-account $G -- creator_of --place_id wat-chalong
stellar contract invoke --network testnet --send=no --id $C --source-account $G -- is_creator_active --creator GDFMVBRRVUFWUTEDIZYESOAYUTQQ73VYLVJVMXQPTNZHOELOJ77AMHRX
# -> "GDFMVBRRVUFWUTEDIZYESOAYUTQQ73VYLVJVMXQPTNZHOELOJ77AMHRX", true

# a traveller's stamps (here the demo traveller from the deploy script)
stellar contract invoke --network testnet --send=no --id $C --source-account $G -- stamps_of --traveller $G
stellar contract invoke --network testnet --send=no --id $C --source-account $G -- get_stamp --traveller $G --place_id wat-chalong
# -> ["wat-chalong"]
# -> {"checked_in_at":1791519629,"receipt_hash":"cec89b5d...ebd2","stamped_at":1791519637,"token_id":1}
```

Events, filtered to `stamped`. A topic filter segment is a base64 XDR `ScVal`; `AAAADwAAAAdzdGFtcGVkAA==` is the symbol `stamped` (make others with `echo '{"symbol":"place_added"}' | stellar xdr encode --type ScVal`). The start ledger must be inside RPC retention, about the last 7 days.

```bash
stellar events --network testnet --id $C --start-ledger 5099190 \
  --topic 'AAAADwAAAAdzdGFtcGVkAA==,*,*' --output json --count 20
```

Output on 2026-10-10 (one line per event, shortened):

```json
{"ledger":5099210,"event_name":"Stamped","prefix_topics":["stamped"],"params":{"traveller":"GDB4SY4V...YAGC","place_id":"wat-chalong","token_id":1,"receipt_hash":"cec89b5d...ebd2","checked_in_at":1791519629}}
{"ledger":5099753,"event_name":"Stamped","prefix_topics":["stamped"],"params":{"traveller":"GAO3HGZE...7LMO","place_id":"old-town","token_id":4,"receipt_hash":"7d484508...16bf","checked_in_at":1791522343}}
```

Ledger 5,099,190 is just before the deployment. These deploy-day events fall out of RPC retention around 2026-10-16; after that, pick a recent start ledger, or read the history on stellar.expert.

### Read with Soroban RPC from JavaScript

This uses `@stellar/stellar-sdk` (the repository already depends on version 17). Save it as `read-stamps.mjs` inside a project that has the SDK installed and run `node read-stamps.mjs`.

```js
import { Account, Address, Contract, nativeToScVal, Networks, rpc, scValToNative, TransactionBuilder, xdr } from '@stellar/stellar-sdk'

const RPC_URL = 'https://soroban-testnet.stellar.org'
const CONTRACT_ID = 'CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65'
// Any valid G address works as the simulation source. It does not sign and needs no funds.
const SOURCE = 'GDB4SY4VZVHOC6AFARET5EHB4IZJHXEH2PTN2WH64A4552KIDWY5YAGC'

const server = new rpc.Server(RPC_URL)
const contract = new Contract(CONTRACT_ID)

async function read(method, ...args) {
  const tx = new TransactionBuilder(new Account(SOURCE, '0'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build()
  const sim = await server.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error.split('\n')[0]}`)
  return scValToNative(sim.result.retval)
}

const str = (s) => nativeToScVal(s, { type: 'string' })
const addr = (a) => new Address(a).toScVal()

console.log('visits at wat-chalong:', await read('place_visit_count', str('wat-chalong')))
console.log('stamps of traveller:', await read('stamps_of', addr(SOURCE)))
const stamp = await read('get_stamp', addr(SOURCE), str('wat-chalong'))
console.log('stamp:', { ...stamp, receipt_hash: Buffer.from(stamp.receipt_hash).toString('hex') })
console.log('token 4 owner:', await read('owner_of', nativeToScVal(4, { type: 'u32' })))
try { await read('place_visit_count', str('nowhere')) } catch (e) { console.log('unknown place ->', e.message) }

// Events: RPC keeps about 7 days of them and scans a limited ledger range per call,
// so page with the cursor until it passes the latest ledger.
const topic = xdr.ScVal.scvSymbol('stamped').toXDR('base64')
const filters = [{ type: 'contract', contractIds: [CONTRACT_ID], topics: [[topic, '*', '*']] }]
const { sequence } = await server.getLatestLedger()
let page = await server.getEvents({ startLedger: Math.max(sequence - 120_000, 1), filters, limit: 100 })
const stamped = [...page.events]
const ledgerOf = (cursor) => Number(BigInt(cursor.split('-')[0]) >> 32n)
while (ledgerOf(page.cursor) < page.latestLedger) {
  page = await server.getEvents({ cursor: page.cursor, filters, limit: 100 })
  stamped.push(...page.events)
}
for (const e of stamped) {
  const [, who, place] = e.topic.map(scValToNative)
  const data = scValToNative(e.value)
  console.log(`stamped token ${data.token_id} at ${place} by ${who.slice(0, 8)}... ledger ${e.ledger} tx ${e.txHash.slice(0, 8)}`)
}
```

Output on 2026-10-10:

```text
visits at wat-chalong: 3
stamps of traveller: [ 'wat-chalong' ]
stamp: { checked_in_at: 1791519629n, receipt_hash: 'cec89b5d88fcbe4276527226d4d0d3770435824b409892a00b59a02b7299ebd2', stamped_at: 1791519637n, token_id: 1 }
token 4 owner: GAO3HGZE3BRO6WIBY3WQPBW4WSJ265UO6CPPJUCUD2U4FDMQRYPC7LMO
unknown place -> place_visit_count: HostError: Error(Contract, #6)
stamped token 1 at wat-chalong by GDB4SY4V... ledger 5099210 tx 3e9431cf
stamped token 2 at wat-chalong by GA5NPXLR... ledger 5099744 tx 4d82543f
stamped token 3 at wat-chalong by GBLCY2PZ... ledger 5099750 tx d60f48d5
stamped token 4 at old-town by GAO3HGZE... ledger 5099753 tx a0418077
```

`u64` values come back as `BigInt` and `BytesN<32>` as a `Buffer`. A typed client can also be generated with `stellar contract bindings typescript --network testnet --contract-id <id> --output-dir <dir>`.

### Read with raw JSON-RPC

Any language with an HTTP client can call `getEvents` directly. Simulated reads need a transaction encoded as XDR, so for those use an SDK or the CLI.

```bash
curl -s -X POST https://soroban-testnet.stellar.org -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "getEvents",
  "params": {
    "startLedger": 5099190,
    "filters": [{ "type": "contract",
                  "contractIds": ["CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65"],
                  "topics": [["AAAADwAAAAdzdGFtcGVkAA==", "*", "*"]] }],
    "pagination": { "limit": 10 }
  }
}'
```

Each event comes back with `ledger`, `txHash`, `topic` (array of base64 `ScVal`) and `value` (a base64 `ScVal` map). An example is in [contract-interface.md](contract-interface.md#events).

### Tie an off-chain receipt to its on-chain stamp

When the server runs in live mode, the check-in response a traveller keeps holds everything needed to find and check the stamp:

1. Verify the receipt and the attestation signature as described in [verify-a-receipt.md](verify-a-receipt.md).
2. From the signed attestation record take `record.contract.id` (the contract), `record.contract.traveller` (the traveller's Stellar address) and `record.contract.tokenId`.
3. Call `get_stamp(traveller, receipt.placeId)` on that contract.
4. Check that `receipt_hash` (hex) equals `receipt.proofHash`, and that `checked_in_at` equals `floor(receipt.checkedInAt / 1000)`. Optionally check `owner_of(tokenId)` returns the same traveller.

Steps 3 and 4 are exactly what `server/attestor.ts` writes: `stamp(traveller, place_id, proofHash as 32 bytes, floor(checkedInAt / 1000))`.

Limits of this check today:

- Simulated (demo) check-ins never reach the chain. Their attestation has `mode: "mock"` and no contract reference.
- Repeat visits do not mint again. The record then has `alreadyStamped: true`, an empty `txHash`, and the on-chain `receipt_hash` belongs to the first visit, not this one.
- The traveller address is derived by the server from the traveller id with an HMAC keyed by its `TRAVELLER_SECRET`. Nobody holds its private key and nobody without the secret can link the address to the traveller id. A second app cannot ask a traveller to prove they own the address.
- Token 1 is the deploy script's demo stamp: its `receipt_hash` is sha256 of a demo string, not of a real check-in.

### Example: a guide's "validated by N visitors" badge

1. List the guide's places: read `place_added` events and keep those whose `creator` is the guide's address, or call `creator_of(id)` for the ids you already know.
2. For each place, call `place_visit_count(id)`.
3. Call `is_creator_active(creator)` and hide the badge if it returns `false`.
4. Link the number to the contract on stellar.expert so a reader can check it.

No Verapass server is involved. Cache the results; every read is a simulation against a public RPC.

### Things to know before you build on v1

- Testnet only. Testnet resets on 2026-12-16 and the contract id changes; the new id is published in `contracts/DEPLOYMENT.md`. Do not hard-code the id without a way to update it.
- The contract instance entry has a 30-day TTL that is extended only by admin or attestor calls. Check it with `stellar contract read --network testnet --id <contract>`: the output ends with the last-modified ledger and the live-until ledger. On 2026-10-10 that was 5,099,753 and 5,617,594; after a manual extend the same day the live-until ledger is 7,195,773, about 2027-02-07. With `--output json` it also prints the instance storage; `NextTokenId` was 5, so four stamps exist.
- Free passports exist. Today the server activates a passport with a free-passport `payment_ref` when a traveller checks in at a free place before paying, so v1 data cannot tell paid from free passports.
- All stamps so far are team test visits (tokens 1 to 4), listed in `contracts/DEPLOYMENT.md`. There is no traveller traffic on chain yet.
- There is no public Verapass read API and no indexer. The Verapass HTTP API ([api-reference.md](api-reference.md)) serves the web app's check-in flow; it has no endpoint for listing stamps or places.
- Only the attestor can write. A second app cannot mint stamps or register places.

### attest.so mirror (manual test, exists today)

On 2026-10-09 the Verapass attestor registered a "Verapass stamp v0" schema on attest.so's testnet protocol contract `CA2QET2KOUGAECEVYQEQT3SLDDZRUMAQHI7MMDTFVJY62WTHUTERAUCD` (schema uid `8de9e7e0ff5493c6554fb13bdaf10c174dd6e53a3d69fbb46e0ad327da6054d3`) and mirrored token 4 as one attestation (uid `d36ce3df50f64f7e31f36ec375c87c51693630caaa1f5e849647374957c566ba`, [tx](https://stellar.expert/explorer/testnet/tx/4a67c5aa9b342c0c6c25fb5dc5729b575593c46a9af8116ba45f9319d12e61ab)). It was done once by hand to show the two compose. New stamps are not mirrored automatically.

## Part 2: what the grant tranches add (planned, not built)

Nothing in this part exists yet. Each line is an SCF #46 deliverable with its tranche and target date. Dates move with the award date.

| Tranche, target | Deliverable | What it changes for an integrator |
|---|---|---|
| T1, 2027-02-05 | D1.1 contract v2 | Two-party stamps: each stamp is also signed by the traveller's own wallet, over the server nonce. A separate passport-issuer key; `deactivate_passport`; daily caps; two-step creator registry; `move_place`. New `stamp` signature and a new contract id. |
| T1 | D1.2 payment on-chain | Passports only from a paid checkout (and refunds deactivate them), so free passports stop. |
| T1 | D1.3 durable attestor | Scheduled `extend_ttl` keep-alive, so the instance no longer depends on traffic; tested restore path; a durable check-in ledger whose reconciliation query equals the contract's `stamped` events. |
| T1 | D1.4 app reads the chain | Check-in protocol spec v0 and a TypeScript read client, published under Apache-2.0. |
| T2, 2027-03-26 | D2.1 passkey wallets | Travellers hold their own passkey smart accounts, so a second app can ask a traveller to sign and prove they own an address. |
| T2 | D2.2 guide USDC credit | Each accepted stamp accrues a USDC credit to the place's creator, readable and claimable on chain (testnet). |
| T2 | D2.3 anti-spoofing v1 | Rotating on-site QR code, protocol spec v1 with each defence and what it does not stop. |
| T2 | D2.4 beta and attest.so mirror | Every accepted stamp mirrored to attest.so automatically, with a mirror status in the read API; the SDK reads a stamp back from attest.so. |
| T3, 2027-05-28 | D3.1 mainnet | Contract v2 on mainnet with a multisig admin. |
| T3 | D3.2 indexer and public read API | Continuous event ingestion from deployment (no 7-day limit), an HTTP API for stamps, per-place counts and creator status, a lookup page, and a published Hubble query that reproduces every count. |
| T3 | D3.4 SDK v1.0 | TypeScript SDK on npm (check-in client, stamp reads, verify), an example app, and a quickstart to a first verified read in under 15 minutes. |

Until those ship, Part 1 is the integration surface: contract reads, events and signed receipts.
