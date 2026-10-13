import { describe, expect, it } from 'vitest'
import { DELETE_IF_EQUALS_SCRIPT, RedisRestClient, redisBackend, SYNC_TOKEN_HEADER, type FetchLike } from '../../server/redisStore'
import { StoreError } from '../../server/store'
import { clock } from '../support/backends'
import { fakeRedisRest } from '../support/fakeRedisRest'

const TOKEN = 'test-token-not-a-secret'

function setup() {
  const c = clock()
  const fake = fakeRedisRest({ now: c.now, token: TOKEN })
  const backend = redisBackend({ url: `${fake.url}/`, token: TOKEN, prefix: 'vp-test:', fetch: fake.fetch })
  return { c, fake, backend }
}

/** A fetch that always answers with the given status and body. */
function answering(status: number, body: unknown): FetchLike {
  return async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

describe('Redis REST store: wire format', () => {
  it('sends one POST per command with a bearer token, prefixed keys, JSON values and PX', async () => {
    const { fake, backend } = setup()
    const store = backend.store<{ paid: boolean }>('pass', { ttlMs: 1500, maxEntries: 10 })
    await store.set('cs_1', { paid: true })
    expect(fake.requests[0]).toEqual({ path: '', authorization: `Bearer ${TOKEN}`, syncToken: null, body: ['SET', 'vp-test:pass:cs_1', '{"paid":true}', 'PX', 1500] })
    expect(await store.get('cs_1')).toEqual({ paid: true })
    expect(fake.requests[1]?.body).toEqual(['GET', 'vp-test:pass:cs_1'])
  })

  it('uses SET NX for add and DEL for delete', async () => {
    const { fake, backend } = setup()
    const store = backend.store<true>('nonce-used', { ttlMs: 240_000, maxEntries: 10 })
    expect(await store.add('n1', true)).toBe(true)
    expect(await store.add('n1', true)).toBe(false)
    await store.delete('n1')
    expect(fake.requests.map((r) => r.body)).toEqual([
      ['SET', 'vp-test:nonce-used:n1', 'true', 'PX', 240_000, 'NX'],
      ['SET', 'vp-test:nonce-used:n1', 'true', 'PX', 240_000, 'NX'],
      ['DEL', 'vp-test:nonce-used:n1'],
    ])
  })

  it('increments a counter and sets its expiry in one MULTI/EXEC transaction', async () => {
    const { fake, backend } = setup()
    const counter = backend.counter('rate:nonce:60000', { ttlMs: 120_000, maxEntries: 10 })
    expect(await counter.increment('1.2.3.4:0')).toBe(1)
    expect(fake.requests[0]).toMatchObject({
      path: '/multi-exec',
      body: [
        ['INCRBY', 'vp-test:rate:nonce:60000:1.2.3.4:0', 1],
        ['PEXPIRE', 'vp-test:rate:nonce:60000:1.2.3.4:0', 120_000],
      ],
    })
    expect(await new RedisRestClient({ url: fake.url, token: TOKEN, fetch: fake.fetch }).command(['PTTL', 'vp-test:rate:nonce:60000:1.2.3.4:0'])).toBe(120_000)
  })

  it('runs pipelines and returns each result', async () => {
    const { fake } = setup()
    const client = new RedisRestClient({ url: fake.url, token: TOKEN, fetch: fake.fetch })
    expect(await client.pipeline([['SET', 'a', '1'], ['GET', 'a'], ['GET', 'missing']])).toEqual(['OK', '1', null])
    expect(fake.requests[0]?.path).toBe('/pipeline')
  })

  it('uses one EVAL script for deleteIf, so the compare and the delete cannot be split', async () => {
    const { fake, backend } = setup()
    const store = backend.store<string>('checkin-lock', { ttlMs: 10_000, maxEntries: 10 })
    await store.set('trav_1', 'owner-a')
    expect(await store.deleteIf('trav_1', 'owner-a')).toBe(true)
    expect(fake.requests[1]?.body).toEqual(['EVAL', DELETE_IF_EQUALS_SCRIPT, 1, 'vp-test:checkin-lock:trav_1', '"owner-a"'])
  })

  it('sends back the latest upstash-sync-token, and none before the first reply', async () => {
    const { fake, backend } = setup()
    const store = backend.store<number>('fix', { ttlMs: 1000, maxEntries: 10 })
    await store.set('a', 1)
    await store.get('a')
    await store.set('b', 2)
    await store.get('b')
    expect(fake.requests.map((r) => r.syncToken)).toEqual([null, '1', '1', '2'])
  })

  it('uses "verapass:" as the default key prefix', async () => {
    const fake = fakeRedisRest({ token: TOKEN })
    await redisBackend({ url: fake.url, token: TOKEN, fetch: fake.fetch }).store<number>('fix', { ttlMs: 1000, maxEntries: 1 }).set('t', 1)
    expect([...fake.data.keys()]).toEqual(['verapass:fix:t'])
  })
})

describe('Redis REST store: read replicas (read your writes)', () => {
  it('a fresh client can read a stale replica; after its own write it reads what other clients wrote before', async () => {
    const fake = fakeRedisRest({ token: TOKEN, replica: true })
    const a = redisBackend({ url: fake.url, token: TOKEN, fetch: fake.fetch })
    const b = redisBackend({ url: fake.url, token: TOKEN, fetch: fake.fetch })
    await a.store<string>('fix', { ttlMs: 60_000, maxEntries: 1 }).set('trav_1', 'from a')

    // The fake really lags: a client with no token reads the replica's old state.
    const fresh = redisBackend({ url: fake.url, token: TOKEN, fetch: fake.fetch })
    expect(await fresh.store<string>('fix', { ttlMs: 60_000, maxEntries: 1 }).get('trav_1')).toBeUndefined()

    // Taking a lock is a write on the primary; its token covers a's earlier write.
    expect(await b.store<string>('checkin-lock', { ttlMs: 10_000, maxEntries: 1 }).add('trav_1', 'owner-b')).toBe(true)
    expect(await b.store<string>('fix', { ttlMs: 60_000, maxEntries: 1 }).get('trav_1')).toBe('from a')
  })
})

describe('Redis REST store: failures', () => {
  it('never puts the token in an error message, even when the endpoint echoes it back', async () => {
    const secret = 'tok_ABCDEF0123456789'
    const echo: FetchLike = async (_input, init) => {
      const auth = new Headers(init.headers).get('authorization') ?? ''
      return new Response(JSON.stringify({ error: `bad auth header: ${auth}` }), { status: 401 })
    }
    const err = await new RedisRestClient({ url: 'https://r.test', token: secret, fetch: echo }).command(['GET', 'k']).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StoreError)
    expect((err as Error).message).toContain('401')
    expect((err as Error).message).toContain('[redacted]')
    expect((err as Error).message).not.toContain(secret)
  })

  it('times out a hanging endpoint with a StoreError instead of waiting forever', async () => {
    const hang: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })
    const err = await new RedisRestClient({ url: 'https://r.test', token: TOKEN, fetch: hang, timeoutMs: 20 }).command(['GET', 'k']).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StoreError)
    expect((err as Error).message).toBe('Redis REST request failed: TimeoutError')
  })

  it('reports a transaction the server discarded as a whole', async () => {
    // Upstash answers a discarded MULTI/EXEC with one error object instead of a list.
    const discarded = answering(400, { error: 'EXECABORT Transaction discarded because of previous errors.' })
    await expect(new RedisRestClient({ url: 'https://r.test', token: TOKEN, fetch: discarded }).transaction([['INCRBY', 'k', 1]])).rejects.toThrow(/EXECABORT/)
  })

  it('reads the sync token header name Upstash documents', () => {
    expect(SYNC_TOKEN_HEADER).toBe('upstash-sync-token')
  })


  it('turns a wrong token into a StoreError that does not contain the token', async () => {
    const fake = fakeRedisRest({ token: 'the-real-token' })
    const store = redisBackend({ url: fake.url, token: 'wrong-token-value', fetch: fake.fetch }).store<number>('x', { ttlMs: 1000, maxEntries: 1 })
    const err = await store.get('k').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StoreError)
    expect((err as Error).message).toContain('401')
    expect((err as Error).message).not.toContain('wrong-token-value')
  })

  it('turns a network failure into a StoreError, and recovers', async () => {
    const { fake, backend } = setup()
    const store = backend.store<number>('x', { ttlMs: 1000, maxEntries: 1 })
    fake.setDown(true)
    await expect(store.set('k', 1)).rejects.toBeInstanceOf(StoreError)
    fake.setDown(false)
    await store.set('k', 1)
    expect(await store.get('k')).toBe(1)
  })

  it('reports error replies, non-JSON answers and mismatched pipeline replies', async () => {
    const opts = { url: 'https://r.test', token: TOKEN }
    await expect(new RedisRestClient({ ...opts, fetch: answering(400, { error: 'ERR syntax error' }) }).command(['SET'])).rejects.toThrow(/ERR syntax error/)
    await expect(new RedisRestClient({ ...opts, fetch: answering(502, '<html>bad gateway</html>') }).command(['GET', 'k'])).rejects.toThrow(/502 without JSON/)
    await expect(new RedisRestClient({ ...opts, fetch: answering(200, [{ result: 1 }]) }).pipeline([['GET', 'a'], ['GET', 'b']])).rejects.toThrow(/1 replies for 2/)
    await expect(new RedisRestClient({ ...opts, fetch: answering(200, [{ error: 'EXECABORT' }]) }).transaction([['INCRBY', 'k', 'x']])).rejects.toBeInstanceOf(StoreError)
    await expect(new RedisRestClient({ ...opts, fetch: answering(200, { error: 'not a list' }) }).pipeline([['GET', 'a']])).rejects.toThrow(/not a list/)
  })

  it('refuses stored values that are not JSON, and counters that are not numbers', async () => {
    const { fake, backend } = setup()
    fake.data.set('vp-test:x:k', { value: 'not json {' })
    await expect(backend.store<number>('x', { ttlMs: 1000, maxEntries: 1 }).get('k')).rejects.toThrow(/not JSON/)
    fake.data.set('vp-test:c:k', { value: 'abc' })
    await expect(backend.counter('c', { ttlMs: 1000, maxEntries: 1 }).get('k')).rejects.toThrow(/not a number/)
  })

  it('gives every request a timeout signal', async () => {
    let signal: AbortSignal | null | undefined
    const fetch: FetchLike = async (_input, init) => {
      signal = init.signal
      return new Response(JSON.stringify({ result: 'PONG' }))
    }
    expect(await new RedisRestClient({ url: 'https://r.test', token: TOKEN, fetch, timeoutMs: 50 }).command(['PING'])).toBe('PONG')
    expect(signal).toBeInstanceOf(AbortSignal)
  })
})
