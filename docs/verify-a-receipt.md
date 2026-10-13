# Verify a check-in receipt

Every accepted check-in comes back with a signed receipt. A traveller keeps it with the stamp, and anyone they share it with can check it without asking the Verapass server or its database. This page describes the format and the checks, from `server/app.ts`, `server/receipts.ts`, `server/attestations.ts`, `shared/checkin.ts` and `shared/verify.ts`.

## What the server signs

`POST /api/checkin` answers with a `CheckinResponse`:

| Field | Type | What it is |
|---|---|---|
| `proof` | object | the proof preimage: everything that went into the proof hash |
| `receipt` | object | the short receipt, which carries the proof hash |
| `signature` | string | base64 Ed25519 signature over `canonicalJson(receipt)` |
| `publicKey` | string | base64 DER (SPKI) Ed25519 public key of the server |
| `attestation` | object | where the on-chain record stands: `pending`, `confirmed` or `failed` |

### proof (`ProofPreimage`)

| Field | Type | Meaning |
|---|---|---|
| `traveller` | string | `anon_<32 hex>`: a pseudonym of the traveller id (HMAC-SHA256 keyed by `TRAVELLER_SECRET`, first 16 bytes in hex), never the id itself. Receipts made before 2026-10-10 hold the raw id (`trav_<16 hex>.<22-char HMAC tag>`) and still verify |
| `placeId` | string | place id, for example `wat-chalong` |
| `nonce` | string | the one-time code from `POST /api/nonce` (32 hex characters) |
| `lat`, `lng` | number | the fix the device sent |
| `accuracy` | number | reported accuracy in metres |
| `deviceTs` | number | device clock, ms since epoch |
| `serverTs` | number | server clock at check-in, ms since epoch |
| `simulated` | boolean | `true` when the visitor used "Demo: simulate being here" |

### receipt (`CheckinReceipt`)

| Field | Type | Meaning |
|---|---|---|
| `traveller` | string | same as in the proof |
| `placeId` | string | same as in the proof |
| `distanceM` | number | distance from the place's check-in point, rounded to whole metres |
| `accuracy` | number | `Math.round(proof.accuracy)` |
| `checkedInAt` | number | equal to `proof.serverTs` |
| `simulated` | boolean | same as in the proof |
| `proofHash` | string | sha256 hex of `canonicalJson(proof)`; this is what goes on chain |

### attestation (`AttestationStatus`)

- `{ "status": "pending" }`: the server did not get the Stellar result within about 4 seconds. Poll `GET /api/attestation/<proofHash>`.
- `{ "status": "failed", "message": "..." }`: writing to Stellar failed. The signed receipt is still valid.
- `{ "status": "confirmed", "record": Attestation, "signature": string }`: `signature` is base64 Ed25519 over `canonicalJson({ proofHash, record })`, signed with the same key as the receipt. This binds the transaction link to the proof hash, so nobody can swap in another transaction.

`record` (`Attestation`) has `mode` (`"mock"` or `"testnet"`), `network` (`"stellar-testnet"`), `id`, `txHash`, `explorerUrl`, and, for a stamp on the contract, `contract` with `id`, `url`, `traveller` (the traveller's Stellar address), `tokenId`, and `alreadyStamped` on a repeat visit. In `mock` mode nothing was written on chain: the tx hash is `sha256("verapass-mock:" + proofHash)` and its explorer link will not resolve.

## Canonical JSON

Hashes and signatures are computed over `canonicalJson(value)` from `shared/checkin.ts`, encoded as UTF-8:

```ts
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}
```

Object keys are sorted, keys with `undefined` values are dropped, and there is no whitespace. Numbers and strings are written exactly as JavaScript's `JSON.stringify` writes them. A port to another language has to match that, in particular number formatting (`98.337`, not `98.3370`; `12`, not `12.0`).

## The key

- Algorithm: Ed25519, no pre-hashing. The signature is the 64-byte Ed25519 signature, base64.
- Public key: base64 of the DER SubjectPublicKeyInfo. Ed25519 SPKI keys are 44 bytes and always start with the same 12-byte prefix, so in base64 they start with `MCowBQYDK2VwAyEA`; the raw 32-byte key is the last 32 bytes.
- Where to get it: `GET /api/health` returns `receiptPublicKey` and `receiptKeyPersistent`. Pin the key you expect instead of trusting the `publicKey` inside the receipt: a forger can sign with their own key and put that key in the receipt.
- When `receiptKeyPersistent` is `false`, the server made a fresh key at startup (no `RECEIPT_SIGNING_KEY`), and receipts from before a restart no longer match `/api/health`. With `NODE_ENV=production` the server refuses to start without a fixed key.

## The checks

These are the checks `verifyStamp` in `shared/verify.ts` runs. The browser page `/verify` runs the same code.

| Check | How | Fails when |
|---|---|---|
| `proofHashMatches` | `sha256(canonicalJson(proof))` in hex equals `receipt.proofHash` | the preimage was edited |
| `receiptMatchesProof` | `traveller`, `placeId` and `simulated` are equal, `receipt.checkedInAt === proof.serverTs`, `receipt.accuracy === Math.round(proof.accuracy)` | the receipt and the preimage disagree |
| `signatureValid` | Ed25519 verify of `signature` over `canonicalJson(receipt)` with `publicKey` | the receipt was edited, or signed by another key |
| `keyMatches` | `publicKey` equals the key you pinned (skipped when you pass none) | another server, or a key rotation |
| `attestationValid` | Ed25519 verify of `attestation.signature` over `canonicalJson({ proofHash: receipt.proofHash, record })` | the transaction record was swapped; `null` when there is no confirmed record |

The stamp is `ok` when the first four are true and `attestationValid` is not `false`.

## Verify with Node, no dependencies

`verify-receipt.mjs` uses only `node:crypto` (Node 18 or newer). Save a check-in response as `response.json`, then run `node verify-receipt.mjs response.json <pinned public key>`.

```js
// verify-receipt.mjs - checks a Verapass check-in response with Node's built-in crypto only.
// Usage: node verify-receipt.mjs response.json [expectedPublicKeyBase64]
import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Same rules as shared/checkin.ts canonicalJson: sorted keys, undefined dropped, no spaces.
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
}

const [file, pinnedKey] = process.argv.slice(2)
const { receipt, signature, publicKey, proof, attestation } = JSON.parse(readFileSync(file, 'utf8'))
const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' })
const ed25519 = (payload, sig) => verify(null, Buffer.from(canonicalJson(payload)), key, Buffer.from(sig, 'base64'))

const checks = {
  proofHashMatches: createHash('sha256').update(canonicalJson(proof)).digest('hex') === receipt.proofHash,
  receiptMatchesProof:
    receipt.traveller === proof.traveller &&
    receipt.placeId === proof.placeId &&
    receipt.simulated === proof.simulated &&
    receipt.checkedInAt === proof.serverTs &&
    receipt.accuracy === Math.round(proof.accuracy),
  signatureValid: ed25519(receipt, signature),
  keyMatches: pinnedKey ? pinnedKey === publicKey : 'not checked (no pinned key given)',
  attestationValid:
    attestation?.status === 'confirmed'
      ? ed25519({ proofHash: receipt.proofHash, record: attestation.record }, attestation.signature)
      : `no confirmed record (status: ${attestation?.status ?? 'none'})`,
}
console.log(checks)
console.log('simulated:', receipt.simulated, '| mode:', attestation?.record?.mode ?? '-')
```

## Verify with the repository code

`shared/verify.ts` uses WebCrypto only, so it runs in the browser and in Node 22:

```ts
import { verifyStamp } from './shared/verify'

const r = JSON.parse(responseJson)
const report = await verifyStamp(
  {
    receipt: r.receipt,
    signature: r.signature,
    publicKey: r.publicKey,
    proof: r.proof,
    attestation: r.attestation.status === 'confirmed' ? { record: r.attestation.record, signature: r.attestation.signature } : null,
  },
  pinnedPublicKey,
)
// report: { proofHashMatches, receiptMatchesProof, signatureValid, keyMatches, attestationValid, unsupported, ok }
```

In the web app, each passport stamp has a "Check this stamp" link: `/verify#stamp=<base64url of the stamp JSON>`. The stamp travels in the URL fragment, which the browser never sends to a server. The `/verify` page also accepts pasted JSON and compares the key with `/api/health`.

## Worked example

A simulated check-in at `wat-chalong`, made on 2026-10-10 by the API app built in-process with no keys: a random `TRAVELLER_SECRET` and a throwaway receipt key generated for that one run. The traveller id behind the pseudonym was never used again and died with the process, so this pair is safe to use as a test vector: it verifies against the `publicKey` it carries.

```json
{
  "receipt": {
    "traveller": "anon_53ebefd8000ff117804e0c30e3426080",
    "placeId": "wat-chalong",
    "distanceM": 16,
    "accuracy": 12,
    "checkedInAt": 1791615878132,
    "simulated": true,
    "proofHash": "f1ef3870455aadb89fad345b16b56a956a29e513d6e4ba3c0622b73632b9d020"
  },
  "signature": "3EqPy/MHeNd6AvmxgbyegDF3NkNbrV4nvhr5ufj8/rPPDImVS+KvEtq/bBdVgLku2lYd7KYqlOiP/oe+YnIWBw==",
  "publicKey": "MCowBQYDK2VwAyEAKBmw024uWDc1dMmajS4onMxPFdpkO1o1cdz8VpzshKQ=",
  "proof": {
    "traveller": "anon_53ebefd8000ff117804e0c30e3426080",
    "placeId": "wat-chalong",
    "nonce": "dfec6e29049ce7bc93e27c5ed6f1b64d",
    "lat": 7.8468,
    "lng": 98.337,
    "accuracy": 12,
    "deviceTs": 1791615878132,
    "serverTs": 1791615878132,
    "simulated": true
  },
  "attestation": {
    "status": "confirmed",
    "record": {
      "mode": "mock",
      "network": "stellar-testnet",
      "id": "mock-f1ef3870455aadb8",
      "txHash": "0ca5cb1812457aae594d6084dbb30f45a342892c42c0281ef3e2892899ab425c",
      "explorerUrl": "https://stellar.expert/explorer/testnet/tx/0ca5cb1812457aae594d6084dbb30f45a342892c42c0281ef3e2892899ab425c"
    },
    "signature": "ggqT/0rY12UdcKd6iVSYcNsediFwoRwaFUn4r+oWAwhIX53tv9POdOOb3P3dPq7LQ2dA6phbSpWPMdY2bbhdAA=="
  }
}
```

Results with the key pinned:

| Input | proofHash | receipt vs proof | signature | key | attestation | ok |
|---|---|---|---|---|---|---|
| as above | true | true | true | true | true | yes |
| `receipt.placeId` changed to `old-town` | true | false | false | true | true | no |

Both `verify-receipt.mjs` and `verifyStamp` gave these results. The attestation signature still checks out in the second row because it binds the record to the proof hash only, and the proof hash did not change; the receipt signature catches the edit. This record is `mode: "mock"` and `simulated: true`, so it says nothing about the chain.

## Cross-check with the chain (live mode only)

When the server runs with the attestor key and contract id set, a confirmed record of a real (not simulated) check-in has `mode: "testnet"` and a `contract` reference. Then:

1. Call `get_stamp(record.contract.traveller, receipt.placeId)` on `record.contract.id`.
2. Its `receipt_hash` (hex) equals `receipt.proofHash`, and `checked_in_at` equals `floor(receipt.checkedInAt / 1000)`.

Commands and code for that read are in [integration-guide.md](integration-guide.md#tie-an-off-chain-receipt-to-its-on-chain-stamp). On a repeat visit (`alreadyStamped: true`) the on-chain hash is the one from the first visit.

## What a valid receipt proves, and what it does not

It proves:

- the holder of the Verapass server key signed this receipt, and the preimage is the one that was hashed;
- the transaction record (when confirmed) belongs to this proof hash;
- whether the visit was simulated: the flag is inside the signed receipt and the hashed preimage.

It does not prove:

- that the traveller stood at the place. The location is what the phone reported; browser GPS can be spoofed, and the server's defences make faking slow and visible, not impossible (`tests/integration/attacks.test.ts` keeps the undefended attacks as expected-fail tests);
- anything on chain when `mode` is `mock` or the status is `pending` or `failed`;
- anything about the server key itself. A receipt is only as trustworthy as the key you pinned.

Privacy: the proof holds the raw location fix and the device time. Sharing a receipt shares that fix. Only the hash goes on chain.

Warning about older receipts: until 2026-10-10 the `traveller` field held the raw server-issued traveller id. That id is also what the browser sends to use its pass (it works as a bearer credential), so anyone who received a stamp link from before that date could act as that traveller in the demo. Receipts made since then carry the `anon_` pseudonym, which the server refuses wherever a traveller id is expected (`tests/integration/attacks.test.ts`, "a shared stamp link does not hand over the traveller's session or paid pass"). Do not share stamp links made before that date. The traveller-held wallet from T1 replaces the server-issued id altogether.

## Planned changes (grant-funded, not built)

- T1 (D1.1): the traveller's wallet signs the `stamp` call, and its arguments include the server nonce and the receipt hash, so the traveller's signature covers both.
- T1 (D1.3): the attestor and passport-issuer keys move to separate AWS KMS keys with tested rotation. The receipt signing key is separate from both today and is set with `RECEIPT_SIGNING_KEY`.
- T3 (D3.4): the TypeScript SDK on npm includes the verify function.
