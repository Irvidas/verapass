import { describe, expect, it, vi } from 'vitest'
import { isWithinClockSkew, MAX_CLOCK_SKEW_MS, NONCE_TTL_MS, NonceStore } from '../../server/nonce'
import { impliedSpeedKmh, isPlausibleTravel, MAX_TRAVEL_KMH } from '../../server/velocity'
import { memoryBackend, StoreError, type StateBackend, type Store, type StoreOptions } from '../../server/store'
import { BACKENDS, clock } from '../support/backends'

/** Run once per backend: the in-memory store and the Redis REST store must behave the same. */
describe.each(BACKENDS)('NonceStore ($name)', ({ make, realClock }) => {
  const nonceStore = (c: ReturnType<typeof clock>) => new NonceStore({ now: c.now, backend: make(c.now) })

  it('issues unique, hex nonces with a 2-minute window', async () => {
    const store = nonceStore(clock())
    const a = await store.issue('trav_1', 'wat-chalong')
    const b = await store.issue('trav_1', 'wat-chalong')
    expect(a.nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.expiresAt - a.issuedAt).toBe(NONCE_TTL_MS)
    expect(NONCE_TTL_MS).toBe(120_000)
  })

  it('accepts a fresh nonce once, then rejects the replay', async () => {
    const store = nonceStore(clock())
    const { nonce } = await store.issue('trav_1', 'wat-chalong')
    expect(await store.consume(nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: true })
    expect(await store.consume(nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: false, reason: 'nonce-used' })
  })

  it('rejects an unknown nonce', async () => {
    const store = nonceStore(clock())
    expect(await store.consume('deadbeef', 'trav_1', 'wat-chalong')).toEqual({ ok: false, reason: 'nonce-unknown' })
  })

  it('accepts at the last millisecond of the window and rejects after it', async () => {
    const c = clock()
    const store = nonceStore(c)
    const a = await store.issue('trav_1', 'wat-chalong')
    const b = await store.issue('trav_1', 'wat-chalong')
    c.advance(NONCE_TTL_MS)
    expect(await store.consume(a.nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: true })
    c.advance(1)
    expect(await store.consume(b.nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: false, reason: 'nonce-expired' })
  })

  it('binds the nonce to the traveller and the place', async () => {
    const store = nonceStore(clock())
    const { nonce } = await store.issue('trav_1', 'wat-chalong')
    expect(await store.consume(nonce, 'trav_2', 'wat-chalong')).toEqual({ ok: false, reason: 'nonce-mismatch' })
    expect(await store.consume(nonce, 'trav_1', 'old-town')).toEqual({ ok: false, reason: 'nonce-mismatch' })
    // A mismatch does not burn the nonce for its rightful owner.
    expect(await store.consume(nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: true })
  })

  it('is single-use under concurrency: of many racing consumes exactly one succeeds', async () => {
    const store = nonceStore(clock())
    const { nonce } = await store.issue('trav_1', 'wat-chalong')
    const results = await Promise.all(Array.from({ length: 10 }, () => store.consume(nonce, 'trav_1', 'wat-chalong')))
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual(Array(9).fill({ ok: false, reason: 'nonce-used' }))
  })

  it.skipIf(realClock)('forgets nonces two windows after they were issued', async () => {
    const c = clock()
    const store = nonceStore(c)
    const { nonce } = await store.issue('trav_1', 'wat-chalong')
    c.advance(NONCE_TTL_MS * 2 - 1)
    expect(await store.consume(nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: false, reason: 'nonce-expired' })
    c.advance(1)
    expect(await store.consume(nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: false, reason: 'nonce-unknown' })
  })
})

describe('NonceStore in memory', () => {
  it('caps live nonces, dropping the oldest first', async () => {
    const store = new NonceStore({ now: clock().now, maxEntries: 2 })
    const a = await store.issue('trav_1', 'wat-chalong')
    await store.issue('trav_1', 'old-town')
    await store.issue('trav_1', 'big-buddha')
    expect(await store.consume(a.nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: false, reason: 'nonce-unknown' })
  })
})

describe('NonceStore on a failing store', () => {
  it('still refuses a replay when the "used" marker is lost (evicted by the database, flushed...)', async () => {
    const base = memoryBackend(clock().now)
    const backend: StateBackend = {
      kind: 'memory',
      counter: base.counter,
      store: <V>(namespace: string, options: StoreOptions) => {
        const inner = base.store<V>(namespace, options)
        if (namespace !== 'nonce-used') return inner
        // A "used" store that forgets every marker right after writing it.
        return { ...bind(inner), get: async () => undefined, add: async () => true }
      },
    }
    const store = new NonceStore({ now: clock().now, backend })
    const { nonce } = await store.issue('trav_1', 'wat-chalong')
    expect(await store.consume(nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: true })
    expect(await store.consume(nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: false, reason: 'nonce-unknown' })
  })

  it('a failed clean-up after the burn does not fail the check-in that won the nonce', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const base = memoryBackend(clock().now)
    const backend: StateBackend = {
      kind: 'memory',
      counter: base.counter,
      store: <V>(namespace: string, options: StoreOptions) => {
        const inner = base.store<V>(namespace, options)
        if (namespace !== 'nonce') return inner
        return { ...bind(inner), delete: async () => Promise.reject(new StoreError('Redis REST request failed: TimeoutError')) }
      },
    }
    const store = new NonceStore({ now: clock().now, backend })
    const { nonce } = await store.issue('trav_1', 'wat-chalong')
    expect(await store.consume(nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: true })
    expect(await store.consume(nonce, 'trav_1', 'wat-chalong')).toEqual({ ok: false, reason: 'nonce-used' })
    expect(error).toHaveBeenCalledWith('[verapass] could not drop a used nonce:', expect.stringContaining('TimeoutError'))
    error.mockRestore()
  })

  it('a store that cannot burn the nonce fails the consume (fail closed), it never answers ok', async () => {
    const base = memoryBackend(clock().now)
    const backend: StateBackend = {
      kind: 'memory',
      counter: base.counter,
      store: <V>(namespace: string, options: StoreOptions) => {
        const inner = base.store<V>(namespace, options)
        if (namespace !== 'nonce-used') return inner
        return { ...bind(inner), add: async () => Promise.reject(new StoreError('Redis REST request failed: TypeError')) }
      },
    }
    const store = new NonceStore({ now: clock().now, backend })
    const { nonce } = await store.issue('trav_1', 'wat-chalong')
    await expect(store.consume(nonce, 'trav_1', 'wat-chalong')).rejects.toBeInstanceOf(StoreError)
  })
})

/** A Store's methods bound to it, so they can be spread into a wrapper. */
function bind<V>(store: Store<V>): Store<V> {
  return {
    get: (k) => store.get(k),
    set: (k, v) => store.set(k, v),
    add: (k, v) => store.add(k, v),
    delete: (k) => store.delete(k),
    deleteIf: (k, v) => store.deleteIf(k, v),
  }
}

describe('isWithinClockSkew', () => {
  const now = 1_760_000_000_000
  it('accepts device clocks within 5 minutes either way', () => {
    expect(isWithinClockSkew(now, now)).toBe(true)
    expect(isWithinClockSkew(now - MAX_CLOCK_SKEW_MS, now)).toBe(true)
    expect(isWithinClockSkew(now + MAX_CLOCK_SKEW_MS, now)).toBe(true)
  })
  it('rejects device clocks further off, and non-finite values', () => {
    expect(isWithinClockSkew(now - MAX_CLOCK_SKEW_MS - 1, now)).toBe(false)
    expect(isWithinClockSkew(now + MAX_CLOCK_SKEW_MS + 1, now)).toBe(false)
    expect(isWithinClockSkew(Number.NaN, now)).toBe(false)
  })
})

describe('velocity check', () => {
  const patong = { lat: 7.8961, lng: 98.296 }
  const khaoSok = { lat: 8.9483, lng: 98.819 }

  it('allows the first check-in', () => {
    expect(isPlausibleTravel(undefined, { ...patong, at: 0 })).toBe(true)
  })

  it('allows a normal road trip and rejects a teleport', () => {
    const start = { ...patong, at: 0 }
    expect(isPlausibleTravel(start, { ...khaoSok, at: 3 * 3_600_000 })).toBe(true)
    expect(isPlausibleTravel(start, { ...khaoSok, at: 60_000 })).toBe(false)
  })

  it('treats two fixes within 50 m as the same spot, whatever the timing', () => {
    expect(isPlausibleTravel({ ...patong, at: 0 }, { lat: patong.lat + 0.0003, lng: patong.lng, at: 1 })).toBe(true)
  })

  it('computes implied speed in km/h', () => {
    const speed = impliedSpeedKmh({ lat: 0, lng: 0, at: 0 }, { lat: 1, lng: 0, at: 3_600_000 })
    expect(speed).toBeCloseTo(111.2, 0)
    expect(speed).toBeLessThan(MAX_TRAVEL_KMH)
  })
})
