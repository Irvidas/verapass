import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson, type CheckinReceipt } from '../../shared/checkin'
import { MockAttestor } from '../../server/attestor'
import { createReceiptSigner, sha256Hex } from '../../server/receipts'

const receipt: CheckinReceipt = {
  traveller: 'trav_abc',
  placeId: 'wat-chalong',
  distanceM: 12,
  accuracy: 9,
  checkedInAt: 1_760_000_000_000,
  simulated: false,
  proofHash: sha256Hex('proof'),
}

describe('canonicalJson', () => {
  it('sorts keys at every level and drops undefined values', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}')
  })
  it('is stable regardless of key order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }))
  })
})

describe('receipt signer', () => {
  it('signs and verifies a receipt', () => {
    const signer = createReceiptSigner()
    const sig = signer.sign(receipt)
    expect(signer.verify(receipt, sig)).toBe(true)
  })

  it('fails verification when any field is changed', () => {
    const signer = createReceiptSigner()
    const sig = signer.sign(receipt)
    expect(signer.verify({ ...receipt, placeId: 'old-town' }, sig)).toBe(false)
    expect(signer.verify({ ...receipt, simulated: true }, sig)).toBe(false)
  })

  it('refuses a key that is not Ed25519', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    expect(() => createReceiptSigner(pem)).toThrow(/must be an Ed25519 key, got ec/)
  })

  it('says whether the key survives a restart', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    expect(createReceiptSigner().persistent).toBe(false)
    expect(createReceiptSigner(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()).persistent).toBe(true)
  })

  it('keeps the same public key when given a PEM key', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    const a = createReceiptSigner(pem)
    const b = createReceiptSigner(pem)
    expect(a.publicKey).toBe(b.publicKey)
    expect(b.verify(receipt, a.sign(receipt))).toBe(true)
  })
})

describe('MockAttestor', () => {
  it('is deterministic per proof hash and says it is a mock', async () => {
    const attestor = new MockAttestor()
    const a = await attestor.attest(receipt)
    const b = await attestor.attest(receipt)
    expect(a).toEqual(b)
    expect(a.mode).toBe('mock')
    expect(a.id).toBe(`mock-${receipt.proofHash.slice(0, 16)}`)
    expect(a.txHash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.explorerUrl).toContain('stellar.expert/explorer/testnet/tx/')
  })
})
