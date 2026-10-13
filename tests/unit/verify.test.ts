import { describe, expect, it } from 'vitest'
import { attestationEnvelope, canonicalJson, type CheckinReceipt, type ProofPreimage } from '../../shared/checkin'
import { proofHashOf, receiptMatchesProof, sha256Hex, supportsEd25519, verifyStamp, type VerifiableStamp } from '../../shared/verify'
import { MockAttestor } from '../../server/attestor'
import { createReceiptSigner, sha256Hex as nodeSha256 } from '../../server/receipts'

const proof: ProofPreimage = {
  traveller: 'trav_0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAA',
  placeId: 'wat-chalong',
  nonce: 'ab'.repeat(16),
  lat: 7.8468,
  lng: 98.3369,
  accuracy: 9.4,
  deviceTs: 1_760_000_000_000,
  serverTs: 1_760_000_000_050,
  simulated: false,
}

async function makeStamp(signer = createReceiptSigner()): Promise<VerifiableStamp> {
  const receipt: CheckinReceipt = {
    traveller: proof.traveller,
    placeId: proof.placeId,
    distanceM: 11,
    accuracy: 9,
    checkedInAt: proof.serverTs,
    simulated: false,
    proofHash: nodeSha256(canonicalJson(proof)),
  }
  const record = await new MockAttestor().attest(receipt)
  return {
    receipt,
    signature: signer.sign(receipt),
    publicKey: signer.publicKey,
    proof,
    attestation: { record, signature: signer.sign(attestationEnvelope(receipt.proofHash, record)) },
  }
}

describe('shared/verify', () => {
  it('hashes exactly like the server, so the preimage hashes to the on-chain memo', async () => {
    expect(await sha256Hex('verapass')).toBe(nodeSha256('verapass'))
    expect(await proofHashOf(proof)).toBe(nodeSha256(canonicalJson(proof)))
  })

  it('runs where the tests run (Node 22 WebCrypto has Ed25519)', async () => {
    expect(await supportsEd25519()).toBe(true)
  })

  it('accepts an untouched stamp against the pinned server key', async () => {
    const signer = createReceiptSigner()
    const stamp = await makeStamp(signer)
    const report = await verifyStamp(stamp, signer.publicKey)
    expect(report).toEqual({
      proofHashMatches: true,
      receiptMatchesProof: true,
      signatureValid: true,
      keyMatches: true,
      attestationValid: true,
      unsupported: false,
      ok: true,
    })
  })

  it('fails a stamp whose receipt was edited (simulated flag flipped)', async () => {
    const stamp = await makeStamp()
    const report = await verifyStamp({ ...stamp, receipt: { ...stamp.receipt, simulated: true } }, stamp.publicKey)
    expect(report.signatureValid).toBe(false)
    expect(report.receiptMatchesProof).toBe(false)
    expect(report.ok).toBe(false)
  })

  it('fails a stamp whose preimage was edited (location moved)', async () => {
    const stamp = await makeStamp()
    const report = await verifyStamp({ ...stamp, proof: { ...stamp.proof, lat: 13.75 } }, stamp.publicKey)
    expect(report.proofHashMatches).toBe(false)
    expect(report.ok).toBe(false)
  })

  it('fails a stamp signed by someone else, even if it is internally consistent', async () => {
    const server = createReceiptSigner()
    const forger = createReceiptSigner()
    const stamp = await makeStamp(forger)
    const report = await verifyStamp(stamp, server.publicKey)
    expect(report.signatureValid).toBe(true)
    expect(report.keyMatches).toBe(false)
    expect(report.ok).toBe(false)
  })

  it('fails a stamp whose tx link was swapped', async () => {
    const stamp = await makeStamp()
    if (!stamp.attestation) throw new Error('fixture has an attestation')
    const swapped = { ...stamp, attestation: { ...stamp.attestation, record: { ...stamp.attestation.record, txHash: 'ff'.repeat(32) } } }
    const report = await verifyStamp(swapped, stamp.publicKey)
    expect(report.attestationValid).toBe(false)
    expect(report.ok).toBe(false)
  })

  it('accepts a stamp whose on-chain record is still pending', async () => {
    const stamp = await makeStamp()
    const report = await verifyStamp({ ...stamp, attestation: null }, stamp.publicKey)
    expect(report.attestationValid).toBeNull()
    expect(report.ok).toBe(true)
  })

  it('compares the receipt with the preimage field by field', () => {
    const receipt = { traveller: proof.traveller, placeId: proof.placeId, distanceM: 1, accuracy: 9, checkedInAt: proof.serverTs, simulated: false, proofHash: 'x' }
    expect(receiptMatchesProof(receipt, proof)).toBe(true)
    expect(receiptMatchesProof({ ...receipt, placeId: 'old-town' }, proof)).toBe(false)
    expect(receiptMatchesProof({ ...receipt, checkedInAt: 1 }, proof)).toBe(false)
  })
})
