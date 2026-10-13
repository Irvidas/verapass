import { describe, expect, it } from 'vitest'
import { createTravellerIdentity } from '../../server/identity'
import { RateLimiter } from '../../server/rateLimit'
import { MemoryStore } from '../../server/store'
import { BACKENDS, clock } from '../support/backends'

const opts = (ttlMs: number, maxEntries = 1000) => ({ ttlMs, maxEntries })

/** One contract, run against every backend: the in-memory store and the Redis REST store. */
describe.each(BACKENDS)('Store contract ($name)', ({ make, realClock }) => {
  it('returns undefined for a missing key and round-trips JSON values', async () => {
    const backend = make(clock().now)
    const store = backend.store<unknown>('t', opts(60_000))
    expect(await store.get('nope')).toBeUndefined()
    const value = { traveller: 'trav_1', paid: true, at: 1_760_000_000_000, nested: { list: [1, 'two', null] } }
    await store.set('k', value)
    expect(await store.get('k')).toEqual(value)
    await store.set('s', 'plain string')
    expect(await store.get('s')).toBe('plain string')
  })

  it.skipIf(realClock)('forgets entries after their time to live', async () => {
    const c = clock()
    const store = make(c.now).store<number>('t', opts(1000))
    await store.set('a', 1)
    c.advance(999)
    expect(await store.get('a')).toBe(1)
    c.advance(1)
    expect(await store.get('a')).toBeUndefined()
  })

  it.skipIf(realClock)('restarts the time to live on every write', async () => {
    const c = clock()
    const store = make(c.now).store<number>('t', opts(1000))
    await store.set('a', 1)
    c.advance(800)
    await store.set('a', 2)
    c.advance(800)
    expect(await store.get('a')).toBe(2)
  })

  it('deletes', async () => {
    const store = make(clock().now).store<number>('t', opts(60_000))
    await store.set('a', 1)
    await store.delete('a')
    await store.delete('never-there')
    expect(await store.get('a')).toBeUndefined()
  })

  it.skipIf(realClock)('add writes only when the key is absent, deleted or expired', async () => {
    const c = clock()
    const store = make(c.now).store<string>('t', opts(1000))
    expect(await store.add('k', 'first')).toBe(true)
    expect(await store.add('k', 'second')).toBe(false)
    expect(await store.get('k')).toBe('first')
    await store.delete('k')
    expect(await store.add('k', 'third')).toBe(true)
    c.advance(1000)
    expect(await store.add('k', 'fourth')).toBe(true)
    expect(await store.get('k')).toBe('fourth')
  })

  it('add is atomic: of many racing calls exactly one wins', async () => {
    const store = make(clock().now).store<number>('t', opts(60_000))
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => store.add('race', i)))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await store.get('race')).toBe(results.indexOf(true))
  })

  it('deleteIf deletes only while the key still holds the given value', async () => {
    const store = make(clock().now).store<string>('lock', opts(60_000))
    expect(await store.deleteIf('k', 'owner-a')).toBe(false)
    await store.set('k', 'owner-b')
    expect(await store.deleteIf('k', 'owner-a')).toBe(false)
    expect(await store.get('k')).toBe('owner-b')
    expect(await store.deleteIf('k', 'owner-b')).toBe(true)
    expect(await store.get('k')).toBeUndefined()
    expect(await store.deleteIf('k', 'owner-b')).toBe(false)
  })

  it('deleteIf compares structured values as JSON', async () => {
    const store = make(clock().now).store<{ owner: string; n: number }>('lock', opts(60_000))
    await store.set('k', { owner: 'a', n: 1 })
    expect(await store.deleteIf('k', { owner: 'a', n: 2 })).toBe(false)
    expect(await store.deleteIf('k', { owner: 'a', n: 1 })).toBe(true)
  })

  it.skipIf(realClock)('deleteIf leaves an expired key alone and reports false', async () => {
    const c = clock()
    const store = make(c.now).store<string>('lock', opts(1000))
    await store.set('k', 'owner-a')
    c.advance(1000)
    expect(await store.deleteIf('k', 'owner-a')).toBe(false)
  })

  it('a lock taken over by a new owner survives the old owner releasing it', async () => {
    const store = make(clock().now).store<string>('lock', opts(60_000))
    expect(await store.add('traveller', 'old')).toBe(true)
    // The old owner's lock is gone (expired or released); a new owner takes it.
    await store.delete('traveller')
    expect(await store.add('traveller', 'new')).toBe(true)
    // The old owner's late release must not free the new owner's lock.
    expect(await store.deleteIf('traveller', 'old')).toBe(false)
    expect(await store.add('traveller', 'third')).toBe(false)
  })

  it('keeps stores with different namespaces apart', async () => {
    const backend = make(clock().now)
    const a = backend.store<string>('a', opts(60_000))
    const b = backend.store<string>('b', opts(60_000))
    await a.set('same-key', 'from a')
    expect(await b.get('same-key')).toBeUndefined()
    expect(await b.add('same-key', 'from b')).toBe(true)
    expect(await a.get('same-key')).toBe('from a')
  })
})

describe.each(BACKENDS)('Counter contract ($name)', ({ make, realClock }) => {
  it('counts up and down from zero', async () => {
    const counter = make(clock().now).counter('c', opts(60_000))
    expect(await counter.get('k')).toBe(0)
    expect(await counter.increment('k')).toBe(1)
    expect(await counter.increment('k', 4)).toBe(5)
    expect(await counter.increment('k', -2)).toBe(3)
    expect(await counter.get('k')).toBe(3)
  })

  it.skipIf(realClock)('forgets a count a time to live after its last increment', async () => {
    const c = clock()
    const counter = make(c.now).counter('c', opts(1000))
    await counter.increment('k')
    c.advance(900)
    await counter.increment('k')
    c.advance(900)
    expect(await counter.get('k')).toBe(2)
    c.advance(100)
    expect(await counter.get('k')).toBe(0)
  })

  it('loses no increments under concurrency', async () => {
    const counter = make(clock().now).counter('c', opts(60_000))
    const results = await Promise.all(Array.from({ length: 25 }, () => counter.increment('k')))
    expect(await counter.get('k')).toBe(25)
    expect(new Set(results).size).toBe(25)
  })
})

describe.each(BACKENDS)('RateLimiter ($name)', ({ make }) => {
  it('allows up to the limit, then refuses with a retry delay', async () => {
    const c = clock(0)
    const limiter = new RateLimiter(3, 60_000, { now: c.now, backend: make(c.now) })
    const oks: boolean[] = []
    for (let i = 0; i < 4; i++) oks.push((await limiter.hit('ip')).ok)
    expect(oks).toEqual([true, true, true, false])
    expect((await limiter.hit('ip')).retryAfterMs).toBe(60_000)
    expect((await limiter.hit('other')).ok).toBe(true)
  })

  it('slides: requests from the previous window still count, weighted by overlap', async () => {
    const c = clock(0)
    const limiter = new RateLimiter(4, 60_000, { now: c.now, backend: make(c.now) })
    for (let i = 0; i < 4; i++) await limiter.hit('ip')
    c.advance(60_000 + 15_000) // a quarter into the next window: 3 of the old 4 still count
    expect((await limiter.hit('ip')).ok).toBe(true)
    expect((await limiter.hit('ip')).ok).toBe(false)
    c.advance(60_000) // two windows later the old ones are gone
    expect((await limiter.hit('ip')).ok).toBe(true)
  })

  it('does not count refused requests, so hammering does not extend the block', async () => {
    const c = clock(0)
    const limiter = new RateLimiter(2, 60_000, { now: c.now, backend: make(c.now) })
    for (let i = 0; i < 10; i++) await limiter.hit('ip')
    c.advance(60_000 + 30_000) // half of the old window's 2 counted requests remain: 1
    expect((await limiter.hit('ip')).ok).toBe(true)
    expect((await limiter.hit('ip')).ok).toBe(false)
  })

  it('lets through no more than the limit when requests race', async () => {
    const c = clock(0)
    const limiter = new RateLimiter(5, 60_000, { now: c.now, backend: make(c.now) })
    const results = await Promise.all(Array.from({ length: 12 }, () => limiter.hit('ip')))
    expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(5)
    expect(results.some((r) => r.ok)).toBe(true)
  })

  it('keeps limiters with different names apart on one backend', async () => {
    const c = clock(0)
    const backend = make(c.now)
    const a = new RateLimiter(1, 60_000, { now: c.now, backend, name: 'a' })
    const b = new RateLimiter(1, 60_000, { now: c.now, backend, name: 'b' })
    expect((await a.hit('ip')).ok).toBe(true)
    expect((await a.hit('ip')).ok).toBe(false)
    expect((await b.hit('ip')).ok).toBe(true)
  })
})

describe('MemoryStore (in-process only)', () => {
  it('evicts the oldest entries beyond the size cap', async () => {
    const store = new MemoryStore<number>({ ttlMs: 60_000, maxEntries: 3, now: clock().now })
    for (let i = 0; i < 5; i++) await store.set(`k${i}`, i)
    expect(store.size()).toBe(3)
    expect(await store.get('k0')).toBeUndefined()
    expect(await store.get('k1')).toBeUndefined()
    expect(await store.get('k4')).toBe(4)
  })

  it('treats a rewrite as the newest entry', async () => {
    const store = new MemoryStore<number>({ ttlMs: 60_000, maxEntries: 2, now: clock().now })
    await store.set('a', 1)
    await store.set('b', 2)
    await store.set('a', 3)
    await store.set('c', 4)
    expect(await store.get('a')).toBe(3)
    expect(await store.get('b')).toBeUndefined()
  })

  it('sweeps expired entries so memory is released without reads', async () => {
    const c = clock()
    const store = new MemoryStore<number>({ ttlMs: 10, maxEntries: 100_000, now: c.now })
    for (let i = 0; i < 1000; i++) await store.set(`k${i}`, i)
    c.advance(11)
    store.sweep()
    expect(store.size()).toBe(0)
    expect([...store.values()]).toEqual([])
  })
})

describe('traveller identity', () => {
  const identity = createTravellerIdentity('unit-test-secret-1234')

  it('issues ids it can verify', () => {
    const id = identity.issue()
    expect(id).toMatch(/^trav_[0-9a-f]{16}\.[\w-]{22}$/)
    expect(identity.verify(id)).toBe(true)
  })

  it('refuses tampered, made-up, foreign and non-string ids', () => {
    const id = identity.issue()
    const tampered = `${id.slice(0, 6)}${id[6] === 'a' ? 'b' : 'a'}${id.slice(7)}`
    expect(identity.verify(tampered)).toBe(false)
    expect(identity.verify('trav_x2')).toBe(false)
    expect(identity.verify(createTravellerIdentity('another-secret-12345').issue())).toBe(false)
    expect(identity.verify(undefined)).toBe(false)
    expect(identity.verify(42)).toBe(false)
  })

  it('gives each id a stable pseudonym that is not the id and is never accepted as one', () => {
    const id = identity.issue()
    const other = identity.issue()
    const p = identity.pseudonym(id)
    expect(p).toMatch(/^anon_[0-9a-f]{32}$/)
    expect(identity.pseudonym(id)).toBe(p)
    expect(identity.pseudonym(other)).not.toBe(p)
    expect(createTravellerIdentity('another-secret-12345').pseudonym(id)).not.toBe(p)
    expect(p).not.toContain(id.slice(5, 21))
    expect(identity.verify(p)).toBe(false)
  })

  it('needs a secret of at least 16 characters', () => {
    expect(() => createTravellerIdentity('short')).toThrow(/16 characters/)
  })
})
