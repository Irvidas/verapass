import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeRedisRest } from '../support/fakeRedisRest'

const signingKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  RECEIPT_SIGNING_KEY: signingKey,
  TRAVELLER_SECRET: 'a-traveller-secret-for-tests-only',
  ALLOW_SIMULATED_CHECKINS: 'true',
  TRUST_PROXY: 'true',
}

/** Loads api/index.ts fresh with the given environment, the way a new Vercel instance would. */
async function loadFunction(env: Record<string, string>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  return import('../../api/index')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Vercel function (api/index.ts)', () => {
  it('answers /api/health through the same app as the Node server', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const fn = await loadFunction(PRODUCTION_ENV)
    expect(log).toHaveBeenCalledWith('[verapass] state: in memory (this process only)')
    const res = await fn.GET(new Request('https://verapass.test/api/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, payments: 'demo', attestation: 'mock', simulation: true, receiptKeyPersistent: true })
  })

  it('issues a traveller id on POST', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const fn = await loadFunction(PRODUCTION_ENV)
    const res = await fn.POST(new Request('https://verapass.test/api/traveller', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.7' } }))
    expect(res.status).toBe(200)
  })

  it('refuses to load in production without the required settings', async () => {
    // A fresh module graph means a fresh ConfigError class, so match on the name and message.
    await expect(loadFunction({ NODE_ENV: 'production', RECEIPT_SIGNING_KEY: '', TRAVELLER_SECRET: '' })).rejects.toMatchObject({
      name: 'ConfigError',
      message: expect.stringContaining('Refusing to start in production'),
    })
  })

  it('logs a clear warning on Vercel without a shared store, and keeps serving', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fn = await loadFunction({ ...PRODUCTION_ENV, VERCEL: '1' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[verapass] warning: Server state is in memory on Vercel'))
    expect((await fn.GET(new Request('https://verapass.test/api/health'))).status).toBe(200)
  })

  it('shares state through the Redis REST store when VERAPASS_REDIS_REST_URL and _TOKEN are set', async () => {
    const fake = fakeRedisRest({ token: 'tok-for-tests' })
    vi.stubGlobal('fetch', fake.fetch)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const env = { ...PRODUCTION_ENV, VERCEL: '1', VERAPASS_REDIS_REST_URL: fake.url, VERAPASS_REDIS_REST_TOKEN: 'tok-for-tests' }
    const first = await loadFunction(env)
    expect(warn).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('shared Redis REST store'))
    const health = await first.GET(new Request('https://verapass.test/api/health'))
    expect(await health.json()).toMatchObject({ state: 'redis' })

    // A traveller and nonce from one instance, the check-in on a fresh one.
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' }
    const { traveller } = (await (await first.POST(new Request('https://verapass.test/api/traveller', { method: 'POST', headers }))).json()) as { traveller: string }
    const nonceRes = await first.POST(new Request('https://verapass.test/api/nonce', { method: 'POST', headers, body: JSON.stringify({ traveller, placeId: 'wat-chalong' }) }))
    const { nonce } = (await nonceRes.json()) as { nonce: string }
    const second = await loadFunction(env)
    const { getPlace } = await import('../../server/places')
    const place = getPlace('wat-chalong')
    if (!place) throw new Error('fixture place missing')
    const body = { traveller, placeId: place.id, nonce, deviceTs: Date.now(), lat: place.lat, lng: place.lng, accuracy: 10, simulated: true }
    const res = await second.POST(new Request('https://verapass.test/api/checkin', { method: 'POST', headers, body: JSON.stringify(body) }))
    expect(res.status).toBe(200)
  })
})
