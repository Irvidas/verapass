/**
 * Prints one line per place: "<place_id> <geo_commitment_hex>".
 *
 * geo_commitment = sha256("verapass-geo-v1|<id>|<lat>|<lng>|<radiusM>|<salt_hex>")
 *
 * The salt keeps hidden places' coordinates from being brute-forced out of the
 * on-chain commitment. It is read from VERAPASS_GEO_SALT (64 hex chars) and must
 * never be written into the repo. Places come from server/places.ts, which is
 * the only list of places with full details (shared/places.ts plus hidden ones).
 *
 * Run from the repo root: VERAPASS_GEO_SALT=... npx tsx contracts/scripts/place-commitments.ts
 */
import { createHash } from 'node:crypto'
import { allPlaces } from '../../server/places'

export function geoCommitment(p: { id: string; lat: number; lng: number; radiusM: number }, saltHex: string): string {
  const preimage = `verapass-geo-v1|${p.id}|${p.lat}|${p.lng}|${p.radiusM}|${saltHex}`
  return createHash('sha256').update(preimage).digest('hex')
}

const salt = process.env.VERAPASS_GEO_SALT ?? ''
if (!/^[0-9a-f]{64}$/.test(salt)) {
  console.error('VERAPASS_GEO_SALT must be 64 lowercase hex chars (32 random bytes)')
  process.exit(1)
}
for (const p of allPlaces()) {
  console.log(`${p.id} ${geoCommitment(p, salt)}`)
}
