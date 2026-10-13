/** Wire types shared by the web app and the API for the check-in flow. */

export interface NonceRequest {
  traveller: string
  placeId: string
}

export interface NonceResponse {
  nonce: string
  placeId: string
  issuedAt: number
  expiresAt: number
}

export interface CheckinRequest {
  traveller: string
  placeId: string
  nonce: string
  lat: number
  lng: number
  accuracy: number
  /** Device clock in ms since epoch when the fix was taken. */
  deviceTs: number
  /** True when the visitor pressed "Demo: simulate being here". */
  simulated?: boolean
}

export interface Attestation {
  /** 'mock' means nothing was written on chain. */
  mode: 'mock' | 'testnet'
  network: 'stellar-testnet'
  id: string
  /** Empty when the stamp was already on chain from an earlier visit (see contract.alreadyStamped). */
  txHash: string
  explorerUrl: string
  /** Set when the record is a stamp on the verapass_stamps Soroban contract. */
  contract?: StampContractRef
}

export interface StampContractRef {
  /** Contract id (C...). */
  id: string
  /** stellar.expert page of the contract. */
  url: string
  /** The traveller's pseudonymous Stellar address the stamp belongs to. */
  traveller: string
  /** Token id of the stamp, when known. */
  tokenId?: number
  /** True when this traveller already had a stamp for the place, so no new one was minted. */
  alreadyStamped?: boolean
}

export interface CheckinReceipt {
  /**
   * `anon_<32 hex>`: an HMAC pseudonym of the traveller id, never the id itself (the id holds the
   * browser's pass, and receipts are shared in stamp links). Receipts made before 2026-10-10 hold
   * the raw `trav_...` id; they still verify.
   */
  traveller: string
  placeId: string
  distanceM: number
  accuracy: number
  checkedInAt: number
  simulated: boolean
  /** sha256 of the canonical proof JSON; this is what goes on chain. */
  proofHash: string
}

/**
 * Everything that went into the proof hash. The traveller keeps it with the stamp, so anyone
 * can recompute the hash and compare it with the one on chain. Raw location never goes on chain.
 */
export interface ProofPreimage {
  /** The same pseudonym as the receipt's traveller. */
  traveller: string
  placeId: string
  nonce: string
  lat: number
  lng: number
  accuracy: number
  deviceTs: number
  serverTs: number
  simulated: boolean
}

/**
 * Where the on-chain record of a check-in stands. Writing to Stellar runs in a background
 * queue, so a check-in can be accepted (signed receipt) before its record is confirmed.
 */
export type AttestationStatus =
  | { status: 'pending' }
  | {
      status: 'confirmed'
      record: Attestation
      /** Ed25519 signature by the server over canonicalJson({ proofHash, record }), so the tx link cannot be swapped. */
      signature: string
    }
  | { status: 'failed'; message: string }

export interface CheckinResponse {
  receipt: CheckinReceipt
  /** Ed25519 signature (base64) by the Verapass server over the canonical receipt JSON. */
  signature: string
  /** Base64 DER (SPKI) Ed25519 public key of the server. */
  publicKey: string
  proof: ProofPreimage
  attestation: AttestationStatus
}

export interface TravellerResponse {
  /** Server-issued, HMAC-signed traveller id. Send it with every nonce, check-in and pass call. */
  traveller: string
}

export type CheckinRejection =
  | 'bad-request'
  | 'unknown-place'
  | 'nonce-unknown'
  | 'nonce-used'
  | 'nonce-expired'
  | 'nonce-mismatch'
  | 'clock-skew'
  | 'invalid-coordinates'
  | 'too-far'
  | 'low-accuracy'
  | 'too-fast'
  | 'simulation-disabled'
  | 'traveller-invalid'
  | 'pass-required'
  | 'rate-limited'
  | 'place-busy'

export interface CheckinError {
  error: CheckinRejection
  message: string
  distanceM?: number
}

/** The payload the server signs to bind an on-chain record to a proof hash. */
export function attestationEnvelope(proofHash: string, record: Attestation): { proofHash: string; record: Attestation } {
  return { proofHash, record }
}

/** Stable JSON with sorted keys, so hashes and signatures are reproducible. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}
