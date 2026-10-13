import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const TOKEN = /^(trav_[0-9a-f]{16})\.([A-Za-z0-9_-]{22})$/

/**
 * Server-issued traveller ids: `trav_<16 hex>.<HMAC tag>`. The client cannot make one up, so
 * per-traveller checks (velocity, pass ownership) and per-IP limits on issuing new ids work
 * together. This is not authentication: until wallet-signed check-ins land (grant milestone 2.3),
 * anyone can ask for a fresh id, which is why issuing them is rate limited per IP.
 */
export interface TravellerIdentity {
  issue(): string
  verify(token: unknown): token is string
  /**
   * A stable stand-in for a traveller id, for receipts and proof preimages. The id itself works
   * as a bearer credential (it holds the browser's pass), and receipts travel in shared stamp
   * links, so they carry this instead. It cannot be turned back into the id and is never
   * accepted where an id is expected.
   */
  pseudonym(token: string): string
}

export function createTravellerIdentity(secret: string, random: (n: number) => Buffer = randomBytes): TravellerIdentity {
  if (secret.length < 16) throw new Error('TRAVELLER_SECRET must be at least 16 characters.')
  const tag = (id: string) => createHmac('sha256', secret).update(id).digest().subarray(0, 16).toString('base64url')
  return {
    issue() {
      const id = `trav_${random(8).toString('hex')}`
      return `${id}.${tag(id)}`
    },
    verify(token: unknown): token is string {
      if (typeof token !== 'string') return false
      const m = TOKEN.exec(token)
      if (!m?.[1] || !m[2]) return false
      const expected = Buffer.from(tag(m[1]))
      const given = Buffer.from(m[2])
      return expected.length === given.length && timingSafeEqual(expected, given)
    },
    pseudonym(token: string): string {
      return `anon_${createHmac('sha256', secret).update(`verapass-receipt-pseudonym-v1|${token}`).digest('hex').slice(0, 32)}`
    },
  }
}
