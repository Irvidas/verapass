import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildServer, createStateBackend, describeState } from '../../server/bootstrap'
import { fakeRedisRest } from '../support/fakeRedisRest'

const signingKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

describe('state backend selection', () => {
  it('uses memory when no Redis REST store is configured (local dev and tests)', () => {
    const { state, config } = buildServer({})
    expect(state.kind).toBe('memory')
    expect(describeState(config)).toBe('in memory (this process only)')
  })

  it('uses the Redis REST store when its URL and token are set, and routes requests through it', async () => {
    const fake = fakeRedisRest({ token: 'tok' })
    const { app, state, config } = buildServer(
      { VERAPASS_REDIS_REST_URL: fake.url, VERAPASS_REDIS_REST_TOKEN: 'tok', TRUST_PROXY: 'true' },
      { fetch: fake.fetch },
    )
    expect(state.kind).toBe('redis')
    expect(describeState(config)).toBe('shared Redis REST store (VERAPASS_REDIS_REST_URL, prefix "verapass:")')
    expect(describeState(config)).not.toContain('tok')
    const res = await app.request('/api/traveller', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' } })
    expect(res.status).toBe(200)
    // The per-IP limiter counted the request in the shared store.
    expect([...fake.data.keys()].some((k) => k.startsWith('verapass:rate:traveller:'))).toBe(true)
    expect(fake.requests.every((r) => r.authorization === 'Bearer tok')).toBe(true)
  })

  it('stays in memory in production on Vercel without the store, and says so', () => {
    const { state, config } = buildServer({
      NODE_ENV: 'production',
      VERCEL: '1',
      RECEIPT_SIGNING_KEY: signingKey,
      TRAVELLER_SECRET: 'a-traveller-secret-for-tests-only',
      ALLOW_SIMULATED_CHECKINS: 'true',
    })
    expect(state.kind).toBe('memory')
    expect(config.warnings.some((w) => w.includes('Server state is in memory on Vercel'))).toBe(true)
  })

  it('createStateBackend follows the config', () => {
    expect(createStateBackend({}).kind).toBe('memory')
    expect(createStateBackend({ redis: { url: 'https://r.example', token: 't', prefix: 'p:', source: 'X' } }).kind).toBe('redis')
  })
})
