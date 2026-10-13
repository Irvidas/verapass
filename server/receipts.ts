import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto'
import { canonicalJson } from '../shared/checkin.js'

export interface ReceiptSigner {
  /** Base64 DER (SPKI) public key, so anyone can verify a receipt. */
  publicKey: string
  /** True when the key came from RECEIPT_SIGNING_KEY, false when it was generated for this process. */
  persistent: boolean
  /** Signs the canonical JSON of any plain object (a receipt, or an attestation envelope). */
  sign(payload: object): string
  verify(payload: object, signature: string): boolean
}

/**
 * Ed25519 signer for check-in receipts. Pass a PKCS#8 PEM key to keep signatures stable
 * across restarts; without one, a fresh key is generated per process (fine for local demos,
 * refused in production by loadConfig).
 */
export function createReceiptSigner(privateKeyPem?: string): ReceiptSigner {
  let privateKey: KeyObject
  let publicKey: KeyObject
  if (privateKeyPem) {
    privateKey = createPrivateKey(privateKeyPem)
    if (privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error(`RECEIPT_SIGNING_KEY must be an Ed25519 key, got ${privateKey.asymmetricKeyType ?? 'unknown'}.`)
    }
    publicKey = createPublicKey(privateKey)
  } else {
    ;({ privateKey, publicKey } = generateKeyPairSync('ed25519'))
  }
  const publicDer = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  return {
    publicKey: publicDer,
    persistent: Boolean(privateKeyPem),
    sign: (payload) => sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    verify: (payload, signature) =>
      verify(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(signature, 'base64')),
  }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
