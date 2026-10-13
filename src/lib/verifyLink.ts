import type { VerifiableStamp } from '../../shared/verify'
import type { Stamp } from './passport'
import { toVerifiable } from './verification'

/** A server-issued traveller id (server/identity.ts). It works as a bearer credential for the browser's pass. */
const TRAVELLER_ID = /^trav_[0-9a-f]{16}\.[A-Za-z0-9_-]{22}$/

/**
 * True for stamps made before receipts switched to the `anon_` pseudonym (2026-10-10): their signed
 * receipt and preimage hold the raw traveller id. The id cannot be removed without breaking the
 * signature, so such a stamp is never put into a link that people share.
 */
export function carriesTravellerId(s: Pick<Stamp, 'receipt' | 'proof'>): boolean {
  return TRAVELLER_ID.test(s.receipt.traveller) || TRAVELLER_ID.test(s.proof.traveller)
}

/** base64url of UTF-8 JSON, so a stamp fits in a link fragment (never sent to a server). */
export function encodeStamp(stamp: VerifiableStamp): string {
  const bytes = new TextEncoder().encode(JSON.stringify(stamp))
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeStamp(encoded: string): unknown {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

/**
 * A link to the verify page with the stamp in the fragment, or null for an older stamp that still
 * carries the traveller id (see carriesTravellerId).
 */
export function verifyLink(s: Stamp): string | null {
  if (carriesTravellerId(s)) return null
  return `/verify#stamp=${encodeStamp(toVerifiable(s))}`
}
