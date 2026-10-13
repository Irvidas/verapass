import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, type AppDeps } from '../../server/app'
import { MockAttestor } from '../../server/attestor'
import { getPlace } from '../../server/places'
import { createReceiptSigner } from '../../server/receipts'
import { redisBackend } from '../../server/redisStore'
import { memoryBackend, type StateBackend } from '../../server/store'
import { fakeRedisRest, type FakeRedis } from '../support/fakeRedisRest'
import { at, checkin, newTraveller, nonceFor, TRAVELLER_SECRET, visit, type Ctx } from './helpers'

/**
 * Vercel may answer each request from a different instance. These tests run two app instances
 * side by side, the way two Vercel instances of api/index.ts would: same secrets and signing key,
 * one shared Redis REST store (each with its own client), one clock.
 */
const watChalong = getPlace('wat-chalong')
const promthep = getPlace('promthep-cape')
const khaoSok = getPlace('khao-sok-lake')
if (!watChalong || !promthep || !khaoSok) throw new Error('fixture places missing')

function cluster(options: { shared?: boolean; replica?: boolean; overrides?: Partial<AppDeps> } = {}) {
  let t = 1_760_000_000_000
  const now = () => t
  const redis: FakeRedis = fakeRedisRest({ now, replica: options.replica })
  const signer = createReceiptSigner()
  const instance = (): Ctx => {
    const state: StateBackend = options.shared === false ? memoryBackend(now) : redisBackend({ url: redis.url, token: redis.token, fetch: redis.fetch })
    const app = createApp({
      publicOrigin: 'http://localhost:5173',
      attestor: new MockAttestor(),
      signer,
      allowSimulated: true,
      travellerSecret: TRAVELLER_SECRET,
      trustProxy: true,
      attestationWaitMs: 200,
      attestationRetryDelayMs: 0,
      now,
      state,
      ...options.overrides,
    })
    const post = (path: string, body: unknown, headers: Record<string, string> = {}, ip = '203.0.113.1') =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      })
    const get = (path: string, ip = '203.0.113.1') => app.request(path, { headers: { 'x-forwarded-for': ip } })
    return { app, signer, post, get, now, advance: (ms: number) => void (t += ms) }
  }
  return { a: instance(), b: instance(), redis, advance: (ms: number) => void (t += ms) }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('two instances with in-memory state (the bug this store fixes)', () => {
  it('a nonce issued by one instance is unknown to the other', async () => {
    const { a, b } = cluster({ shared: false })
    const traveller = await newTraveller(a)
    const { nonce } = await nonceFor(a, traveller, watChalong.id)
    const r = await checkin(b, { traveller, placeId: watChalong.id, nonce, deviceTs: a.now(), ...at(watChalong) })
    expect(r.status).toBe(422)
    expect(r.body.error).toBe('nonce-unknown')
  })
})

describe('two instances sharing a Redis REST store', () => {
  it('reports the shared store in /api/health', async () => {
    const { a } = cluster()
    expect(await (await a.get('/api/health')).json()).toMatchObject({ ok: true, state: 'redis' })
  })

  it('a nonce issued by one instance is accepted once by the other, and the replay is refused everywhere', async () => {
    const { a, b } = cluster()
    const traveller = await newTraveller(a)
    const { nonce } = await nonceFor(a, traveller, watChalong.id)
    const body = { traveller, placeId: watChalong.id, nonce, deviceTs: a.now(), ...at(watChalong) }
    expect((await checkin(b, body)).status).toBe(200)
    const replayA = await checkin(a, body)
    expect(replayA.status).toBe(409)
    expect(replayA.body.error).toBe('nonce-used')
    expect((await checkin(b, body)).status).toBe(409)
  })

  it('the same nonce sent to both instances at once is accepted exactly once', async () => {
    const { a, b } = cluster()
    const traveller = await newTraveller(a)
    const { nonce } = await nonceFor(a, traveller, watChalong.id)
    const body = { traveller, placeId: watChalong.id, nonce, deviceTs: a.now(), ...at(watChalong), simulated: true }
    const results = await Promise.all([checkin(a, body), checkin(b, body), checkin(a, body), checkin(b, body)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409])
  })

  it('a demo pass bought on one instance unlocks the hidden places on the other', async () => {
    const { a, b } = cluster()
    const traveller = await newTraveller(a)
    const checkout = (await (await a.post('/api/checkout', { traveller })).json()) as { sessionId: string }
    expect(await (await b.get(`/api/pass/${checkout.sessionId}?traveller=${traveller}`)).json()).toMatchObject({ paid: true, demo: true })
    const hidden = await b.get(`/api/places/hidden?traveller=${traveller}`)
    expect(hidden.status).toBe(200)
    expect(Object.keys(((await hidden.json()) as { places: Record<string, unknown> }).places).length).toBeGreaterThan(0)
  })

  it('the attestation status can be polled from the other instance', async () => {
    const { a, b } = cluster()
    const traveller = await newTraveller(a)
    const r = await visit(a, traveller, watChalong)
    expect(r.status).toBe(200)
    const status = await b.get(`/api/attestation/${r.body.receipt.proofHash}`)
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ status: 'confirmed', record: { mode: 'mock' } })
  })

  it('the speed check sees the last fix recorded by the other instance', async () => {
    const { a, b, advance } = cluster()
    const traveller = await newTraveller(a)
    expect((await visit(a, traveller, promthep)).status).toBe(200)
    advance(60_000)
    const r = await visit(b, traveller, khaoSok)
    expect(r.status).toBe(422)
    expect(r.body.error).toBe('too-fast')
  })

  it('two real check-ins sent to two instances at the same moment cannot both pass the speed check', async () => {
    const { a, b } = cluster()
    const traveller = await newTraveller(a)
    const na = await nonceFor(a, traveller, promthep.id)
    const nb = await nonceFor(b, traveller, khaoSok.id)
    const [ra, rb] = await Promise.all([
      checkin(a, { traveller, placeId: promthep.id, nonce: na.nonce, deviceTs: a.now(), lat: promthep.lat, lng: promthep.lng, accuracy: 10 }),
      checkin(b, { traveller, placeId: khaoSok.id, nonce: nb.nonce, deviceTs: b.now(), lat: khaoSok.lat, lng: khaoSok.lng, accuracy: 10 }),
    ])
    expect([ra.status, rb.status].sort()).toEqual([200, 422])
    expect([ra.body.error, rb.body.error]).toContain('too-fast')
  })

  it('rate limits count requests across instances', async () => {
    const { a, b } = cluster({ overrides: { limits: { apiPerMinute: 4 } } })
    const traveller = await newTraveller(a)
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await (i % 2 ? b : a).post('/api/nonce', { traveller, placeId: watChalong.id })).status)
    expect(statuses).toEqual([200, 200, 200, 200, 429, 429])
  })

  it('answers 503 with a JSON error while the store is unreachable, and recovers', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { a, redis } = cluster()
    const traveller = await newTraveller(a)
    redis.setDown(true)
    const res = await a.post('/api/nonce', { traveller, placeId: watChalong.id })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ error: 'state-unavailable' })
    expect(error).toHaveBeenCalledWith('[verapass] state store unavailable:', expect.stringContaining('Redis REST request failed'))
    redis.setDown(false)
    expect((await a.post('/api/nonce', { traveller, placeId: watChalong.id })).status).toBe(200)
  })

  it('keeps every key under the prefix and gives every key an expiry', async () => {
    const { a, redis } = cluster()
    const traveller = await newTraveller(a)
    await visit(a, traveller, watChalong)
    await a.post('/api/checkout', { traveller })
    expect(redis.data.size).toBeGreaterThan(0)
    for (const [key, entry] of redis.data) {
      expect(key.startsWith('verapass:'), key).toBe(true)
      expect(entry.expiresAt, key).toBeTypeOf('number')
    }
  })

  it('releases the check-in lock after every check-in, accepted or refused', async () => {
    const { a, b, advance, redis } = cluster()
    const traveller = await newTraveller(a)
    expect((await visit(a, traveller, promthep)).status).toBe(200)
    advance(60_000)
    expect((await visit(b, traveller, khaoSok)).status).toBe(422)
    expect([...redis.data.keys()].filter((k) => k.includes('checkin-lock'))).toEqual([])
    // The lock is taken with a random owner id and released with the compare-and-delete script.
    const locks = redis.requests.filter((r) => Array.isArray(r.body) && r.body.some((arg) => String(arg).includes(':checkin-lock:')))
    const takes = locks.filter((r) => (r.body as unknown[])[0] === 'SET')
    expect(takes.length).toBe(2)
    for (const take of takes) expect((take.body as unknown[])[2]).toMatch(/^"[0-9a-f]{24}"$/)
    expect(locks.filter((r) => (r.body as unknown[])[0] === 'EVAL')).toHaveLength(2)
  })

  it('fails a check-in closed (503, nonce kept) when the store breaks halfway, and accepts it after recovery', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { a, b, redis } = cluster()
    const traveller = await newTraveller(a)
    const { nonce } = await nonceFor(a, traveller, watChalong.id)
    const body = { traveller, placeId: watChalong.id, nonce, deviceTs: a.now(), ...at(watChalong) }
    // The burn (SET NX on the "used" key) cannot reach the store.
    redis.failCommands((cmd) => cmd[0] === 'SET' && String(cmd[1]).includes(':nonce-used:'))
    const broken = await b.post('/api/checkin', body)
    expect(broken.status).toBe(503)
    expect(await broken.json()).toMatchObject({ error: 'state-unavailable' })
    expect([...redis.data.keys()].some((k) => k.includes(':fix:'))).toBe(false)
    expect([...redis.data.keys()].some((k) => k.includes('checkin-lock'))).toBe(false)
    redis.failCommands(undefined)
    expect((await checkin(a, body)).status).toBe(200)
    expect((await checkin(b, body)).status).toBe(409)
    expect(error).toHaveBeenCalledWith('[verapass] state store unavailable:', expect.stringContaining('Redis REST request failed'))
  })

  it('a failed pass lookup during a real check-in answers 503 before the nonce is burnt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { a, redis } = cluster()
    const traveller = await newTraveller(a)
    const { nonce } = await nonceFor(a, traveller, watChalong.id)
    const body = { traveller, placeId: watChalong.id, nonce, deviceTs: a.now(), ...at(watChalong) }
    redis.failCommands((cmd) => cmd[0] === 'GET' && String(cmd[1]).includes(':pass-by-traveller:'))
    expect((await checkin(a, body)).status).toBe(503)
    expect([...redis.data.keys()].some((k) => k.includes(':nonce-used:'))).toBe(false)
    redis.failCommands(undefined)
    expect((await checkin(a, body)).status).toBe(200)
  })

  it('fails closed when the check-in lock cannot be taken', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { a, redis } = cluster()
    const traveller = await newTraveller(a)
    const { nonce } = await nonceFor(a, traveller, watChalong.id)
    redis.failCommands((cmd) => String(cmd[1]).includes('checkin-lock'))
    const r = await checkin(a, { traveller, placeId: watChalong.id, nonce, deviceTs: a.now(), ...at(watChalong) })
    expect(r.status).toBe(503)
    expect(r.body.error).toBe('state-unavailable')
    expect(error).toHaveBeenCalled()
  })

  it('never puts the token in a response or a log line while the store is down', async () => {
    const lines: string[] = []
    const capture = (...args: unknown[]) => void lines.push(args.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' '))
    vi.spyOn(console, 'error').mockImplementation(capture)
    vi.spyOn(console, 'warn').mockImplementation(capture)
    vi.spyOn(console, 'log').mockImplementation(capture)
    const { a, redis } = cluster()
    const traveller = await newTraveller(a)
    const { nonce } = await nonceFor(a, traveller, watChalong.id)
    redis.setDown(true)
    const bodies: string[] = []
    bodies.push(await (await a.post('/api/nonce', { traveller, placeId: watChalong.id })).text())
    bodies.push(await (await a.post('/api/checkin', { traveller, placeId: watChalong.id, nonce, deviceTs: a.now(), ...at(watChalong) })).text())
    bodies.push(await (await a.get(`/api/attestation/${'a'.repeat(64)}`)).text())
    bodies.push(await (await a.get(`/api/places/hidden?traveller=${traveller}`)).text())
    expect(lines.length).toBeGreaterThan(0)
    for (const text of [...bodies, ...lines]) expect(text).not.toContain(redis.token)
  })
})

describe('two instances on a database with a lagging read replica', () => {
  it('the speed check still sees the other instance\'s last fix: the lock\'s sync token covers it', async () => {
    const { a, b, advance } = cluster({ replica: true })
    const traveller = await newTraveller(a)
    expect((await visit(a, traveller, promthep)).status).toBe(200)
    advance(60_000)
    const r = await visit(b, traveller, khaoSok)
    expect(r.status).toBe(422)
    expect(r.body.error).toBe('too-fast')
  })

  it('a nonce from one instance is still accepted once by the other', async () => {
    const { a, b } = cluster({ replica: true })
    const traveller = await newTraveller(a)
    const { nonce } = await nonceFor(a, traveller, watChalong.id)
    const body = { traveller, placeId: watChalong.id, nonce, deviceTs: a.now(), ...at(watChalong) }
    expect((await checkin(b, body)).status).toBe(200)
    expect((await checkin(a, body)).status).toBe(409)
  })
})
