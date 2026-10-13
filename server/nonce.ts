import { randomBytes } from 'node:crypto'
import type { NonceResponse } from '../shared/checkin.js'
import { memoryBackend, type StateBackend, type Store } from './store.js'

export const NONCE_TTL_MS = 120_000
export const MAX_CLOCK_SKEW_MS = 5 * 60_000
/** Hard cap on live nonces in memory, so a flood of /api/nonce calls cannot grow memory without bound. */
export const MAX_NONCES = 50_000

interface NonceEntry {
  traveller: string
  placeId: string
  issuedAt: number
  expiresAt: number
}

export type NonceCheck =
  | { ok: true }
  | { ok: false; reason: 'nonce-unknown' | 'nonce-used' | 'nonce-expired' | 'nonce-mismatch' }

export interface NonceStoreOptions {
  now?: () => number
  ttlMs?: number
  maxEntries?: number
  /** Where nonces live. In memory by default; a shared backend lets any instance consume them. */
  backend?: StateBackend
}

/**
 * Single-use, short-lived nonces bound to (traveller, place). Entries are kept for two windows,
 * so an expired nonce reads as 'nonce-expired' and a replay as 'nonce-used', not 'nonce-unknown'.
 * A nonce is burnt with Store.add on a separate "used" key: atomic in every backend, so two
 * check-ins racing with the same nonce (even on two instances) cannot both succeed. After the
 * burn the entry itself is dropped as well, so a replay still fails (as 'nonce-unknown') even if
 * the "used" key is lost, for example evicted from a full in-memory store.
 */
export class NonceStore {
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly entries: Store<NonceEntry>
  private readonly used: Store<true>

  constructor(options: NonceStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? NONCE_TTL_MS
    const backend = options.backend ?? memoryBackend(this.now)
    const storeOptions = { ttlMs: this.ttlMs * 2, maxEntries: options.maxEntries ?? MAX_NONCES }
    this.entries = backend.store<NonceEntry>('nonce', storeOptions)
    this.used = backend.store<true>('nonce-used', storeOptions)
  }

  async issue(traveller: string, placeId: string): Promise<NonceResponse> {
    const issuedAt = this.now()
    const nonce = randomBytes(16).toString('hex')
    const entry: NonceEntry = { traveller, placeId, issuedAt, expiresAt: issuedAt + this.ttlMs }
    await this.entries.set(nonce, entry)
    return { nonce, placeId, issuedAt, expiresAt: entry.expiresAt }
  }

  /** Validates and, on success, burns the nonce so it cannot be replayed. */
  async consume(nonce: string, traveller: string, placeId: string): Promise<NonceCheck> {
    const [entry, burnt] = await Promise.all([this.entries.get(nonce), this.used.get(nonce)])
    if (burnt) return { ok: false, reason: 'nonce-used' }
    if (!entry) return { ok: false, reason: 'nonce-unknown' }
    if (this.now() > entry.expiresAt) return { ok: false, reason: 'nonce-expired' }
    if (entry.traveller !== traveller || entry.placeId !== placeId) return { ok: false, reason: 'nonce-mismatch' }
    // The single-use guarantee: only one caller can create the "used" key.
    if (!(await this.used.add(nonce, true))) return { ok: false, reason: 'nonce-used' }
    // A second line of defence only: the "used" key above already decides, so a failed delete
    // must not fail a check-in that has just won its nonce.
    await this.entries.delete(nonce).catch((err: unknown) => {
      console.error('[verapass] could not drop a used nonce:', err instanceof Error ? err.message : err)
    })
    return { ok: true }
  }
}

/** The device clock must be close to the server clock, or the fix may be replayed from the past. */
export function isWithinClockSkew(deviceTs: number, serverNow: number, maxSkewMs: number = MAX_CLOCK_SKEW_MS): boolean {
  return Number.isFinite(deviceTs) && Math.abs(serverNow - deviceTs) <= maxSkewMs
}
