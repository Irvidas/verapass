import type { AttestationStatus } from '../../shared/checkin'
import type { Stamp } from '../../src/lib/passport'

export const confirmed: AttestationStatus = {
  status: 'confirmed',
  record: { mode: 'mock', network: 'stellar-testnet', id: 'mock-1', txHash: 'cd'.repeat(32), explorerUrl: 'https://x' },
  signature: 'sig',
}

export function stamp(placeId: string, at = 1_760_000_000_000, attestation: AttestationStatus = confirmed): Stamp {
  const proofHash = `${placeId.length.toString(16).padStart(2, '0')}${'ab'.repeat(31)}`
  return {
    placeId,
    collectedAt: at,
    proofHash,
    simulated: true,
    distanceM: 10,
    receipt: { traveller: 'trav_a', placeId, distanceM: 10, accuracy: 12, checkedInAt: at, simulated: true, proofHash },
    signature: 'c2ln',
    publicKey: 'a2V5',
    proof: { traveller: 'trav_a', placeId, nonce: 'n', lat: 7.8, lng: 98.3, accuracy: 12, deviceTs: at, serverTs: at, simulated: true },
    attestation,
  }
}
