import {
  attestationEnvelope,
  canonicalJson,
  type Attestation,
  type CheckinReceipt,
  type ProofPreimage,
} from './checkin.js'

/**
 * Checks a stamp without trusting the Verapass database: recompute the proof hash from the
 * stored preimage, compare it with the receipt, and check the server's Ed25519 signatures
 * against a public key you got separately (GET /api/health, or one pinned in your own tool).
 * Uses WebCrypto only, so the same code runs in the browser (the /verify page) and in Node.
 */
export interface VerifiableStamp {
  receipt: CheckinReceipt
  /** Base64 Ed25519 signature over canonicalJson(receipt). */
  signature: string
  /** Base64 DER (SPKI) public key the stamp says it was signed with. */
  publicKey: string
  proof: ProofPreimage
  attestation?: { record: Attestation; signature: string } | null
}

export interface VerifyReport {
  /** sha256(canonicalJson(proof)) equals receipt.proofHash. */
  proofHashMatches: boolean
  /** The receipt says the same thing as the preimage (traveller, place, time, simulated flag). */
  receiptMatchesProof: boolean
  /** The receipt signature checks out under the stamp's own key. */
  signatureValid: boolean
  /** The stamp's key is the expected (pinned) server key. */
  keyMatches: boolean
  /** The on-chain record is signed together with this proof hash. null: no record yet. */
  attestationValid: boolean | null
  /** Ed25519 is missing from this runtime's WebCrypto. Nothing could be checked. */
  unsupported: boolean
  ok: boolean
}

const encoder = new TextEncoder()

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', encoder.encode(text)))
}

/** The proof hash the server computed for this preimage. */
export function proofHashOf(proof: ProofPreimage): Promise<string> {
  return sha256Hex(canonicalJson(proof))
}

async function verifyEd25519(publicKeyB64: string, signatureB64: string, payload: unknown): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('spki', fromBase64(publicKeyB64), { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, fromBase64(signatureB64), encoder.encode(canonicalJson(payload)))
  } catch {
    return false
  }
}

let ed25519Support: Promise<boolean> | null = null

/** Whether this runtime's WebCrypto can verify Ed25519 (all current browsers and Node 22 can). */
export function supportsEd25519(): Promise<boolean> {
  ed25519Support ??= (async () => {
    try {
      await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
      return true
    } catch {
      return false
    }
  })()
  return ed25519Support
}

export function receiptMatchesProof(receipt: CheckinReceipt, proof: ProofPreimage): boolean {
  return (
    receipt.traveller === proof.traveller &&
    receipt.placeId === proof.placeId &&
    receipt.simulated === proof.simulated &&
    receipt.checkedInAt === proof.serverTs &&
    receipt.accuracy === Math.round(proof.accuracy)
  )
}

export async function verifyStamp(stamp: VerifiableStamp, expectedPublicKey?: string | null): Promise<VerifyReport> {
  if (!(await supportsEd25519())) {
    return {
      proofHashMatches: false,
      receiptMatchesProof: false,
      signatureValid: false,
      keyMatches: false,
      attestationValid: null,
      unsupported: true,
      ok: false,
    }
  }
  const proofHashMatches = (await proofHashOf(stamp.proof)) === stamp.receipt.proofHash
  const matches = receiptMatchesProof(stamp.receipt, stamp.proof)
  const signatureValid = await verifyEd25519(stamp.publicKey, stamp.signature, stamp.receipt)
  const keyMatches = expectedPublicKey ? expectedPublicKey === stamp.publicKey : true
  const attestationValid = stamp.attestation
    ? await verifyEd25519(stamp.publicKey, stamp.attestation.signature, attestationEnvelope(stamp.receipt.proofHash, stamp.attestation.record))
    : null
  return {
    proofHashMatches,
    receiptMatchesProof: matches,
    signatureValid,
    keyMatches,
    attestationValid,
    unsupported: false,
    ok: proofHashMatches && matches && signatureValid && keyMatches && attestationValid !== false,
  }
}
