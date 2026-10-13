import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { ConfigError, DEFAULT_LIMITS, loadConfig } from '../../server/config'

/** A random throwaway key, made per run. */
const SECRET = Keypair.random().secret()
const CONTRACT = 'CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65'
const PEM = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----' // fake fixture, publish-check: allow

describe('loadConfig', () => {
  it('runs a local demo with no settings at all', () => {
    const c = loadConfig({})
    expect(c).toMatchObject({ production: false, port: 8787, publicOrigin: 'http://localhost:5173', allowSimulated: true, serveStatic: false, trustProxy: false })
    expect(c.limits).toEqual(DEFAULT_LIMITS)
    expect(c.travellerSecretPersistent).toBe(false)
    expect(c.travellerSecret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('treats empty strings as unset', () => {
    const c = loadConfig({ STRIPE_SECRET_KEY: '', STELLAR_SECRET: ' ', ALLOW_SIMULATED_CHECKINS: '' })
    expect(c.stripeSecretKey).toBeUndefined()
    expect(c.stellarSecret).toBeUndefined()
    expect(c.allowSimulated).toBe(true)
  })

  it('turns simulated check-ins off by default once a Stellar key is set', () => {
    expect(loadConfig({ STELLAR_SECRET: SECRET }).allowSimulated).toBe(false)
    expect(loadConfig({ STELLAR_SECRET: SECRET, ALLOW_SIMULATED_CHECKINS: 'true' }).allowSimulated).toBe(true)
    expect(loadConfig({ ALLOW_SIMULATED_CHECKINS: 'false' }).allowSimulated).toBe(false)
  })

  it('goes live on chain only with both the attestor key and the contract id', () => {
    expect(loadConfig({}).chainLive).toBe(false)
    const live = loadConfig({ STELLAR_SECRET: SECRET, VERAPASS_CONTRACT_ID: CONTRACT, STELLAR_RPC_URL: 'https://rpc.example.org' })
    expect(live).toMatchObject({ chainLive: true, stellarSecret: SECRET, contractId: CONTRACT, stellarRpcUrl: 'https://rpc.example.org' })
    expect(live.warnings.join(' ')).not.toContain('VERAPASS_CONTRACT_ID')

    const keyOnly = loadConfig({ STELLAR_SECRET: SECRET })
    expect(keyOnly.chainLive).toBe(false)
    expect(keyOnly.warnings.join(' ')).toContain('VERAPASS_CONTRACT_ID is not')
    const idOnly = loadConfig({ VERAPASS_CONTRACT_ID: CONTRACT })
    expect(idOnly.chainLive).toBe(false)
    expect(idOnly.warnings.join(' ')).toContain('STELLAR_SECRET is not')
  })

  it('rejects a malformed Stellar key, contract id or RPC URL', () => {
    expect(() => loadConfig({ STELLAR_SECRET: 'SABC' })).toThrow(ConfigError)
    expect(() => loadConfig({ STELLAR_SECRET: 'GBZWMQM2Y3XRELOHYK3IQ57NAARTI4TTWAGHGHLUEXAUFMUUJWDUBKTU' })).toThrow(/STELLAR_SECRET/)
    expect(() => loadConfig({ VERAPASS_CONTRACT_ID: 'not-a-contract' })).toThrow(/VERAPASS_CONTRACT_ID/)
    expect(() => loadConfig({ STELLAR_RPC_URL: 'soroban-testnet.stellar.org' })).toThrow(/STELLAR_RPC_URL/)
  })

  it('rejects anything but true or false for ALLOW_SIMULATED_CHECKINS', () => {
    expect(() => loadConfig({ ALLOW_SIMULATED_CHECKINS: 'yes' })).toThrow(ConfigError)
  })

  it('refuses to start in production without the keys that make receipts and passes work', () => {
    let message = ''
    try {
      loadConfig({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x' })
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      message = (err as Error).message
    }
    expect(message).toContain('RECEIPT_SIGNING_KEY')
    expect(message).toContain('TRAVELLER_SECRET')
    expect(message).toContain('STRIPE_WEBHOOK_SECRET')
    expect(message).toContain('ALLOW_SIMULATED_CHECKINS')
  })

  it('starts in production when everything is set explicitly', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      RECEIPT_SIGNING_KEY: PEM,
      TRAVELLER_SECRET: 'a-long-enough-secret-value',
      ALLOW_SIMULATED_CHECKINS: 'false',
    })
    expect(c.production).toBe(true)
    expect(c.allowSimulated).toBe(false)
    expect(c.receiptSigningKey).toContain('\n')
    expect(c.travellerSecretPersistent).toBe(true)
    expect(c.warnings).toEqual([])
  })

  it('warns when Stripe is on without a webhook secret (outside production)', () => {
    const c = loadConfig({ STRIPE_SECRET_KEY: 'sk_test_x' })
    expect(c.warnings.some((w) => w.includes('STRIPE_WEBHOOK_SECRET'))).toBe(true)
  })

  it('reads rate limits and rejects nonsense numbers', () => {
    expect(loadConfig({ RATE_LIMIT_API_PER_MINUTE: '500', RATE_LIMIT_TRAVELLER_PER_HOUR: '7' }).limits).toMatchObject({ apiPerMinute: 500, travellerPerHour: 7 })
    expect(() => loadConfig({ RATE_LIMIT_API_PER_MINUTE: '-1' })).toThrow(ConfigError)
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(ConfigError)
  })

  it('keeps state in memory when no Redis REST store is set', () => {
    const c = loadConfig({})
    expect(c.redis).toBeUndefined()
    expect(c.vercel).toBe(false)
  })

  it('reads the Redis REST store from the VERAPASS_ names first, then the Upstash and Vercel ones', () => {
    expect(loadConfig({ VERAPASS_REDIS_REST_URL: 'https://a.example', VERAPASS_REDIS_REST_TOKEN: 'tok-a', KV_REST_API_URL: 'https://c.example', KV_REST_API_TOKEN: 'tok-c' }).redis).toEqual({
      url: 'https://a.example',
      token: 'tok-a',
      prefix: 'verapass:',
      source: 'VERAPASS_REDIS_REST_URL',
    })
    expect(loadConfig({ UPSTASH_REDIS_REST_URL: 'https://b.example', UPSTASH_REDIS_REST_TOKEN: 'tok-b' }).redis).toMatchObject({ url: 'https://b.example', source: 'UPSTASH_REDIS_REST_URL' })
    expect(loadConfig({ KV_REST_API_URL: 'https://c.example', KV_REST_API_TOKEN: 'tok-c', VERAPASS_REDIS_PREFIX: 'vp-preview:' }).redis).toMatchObject({ source: 'KV_REST_API_URL', prefix: 'vp-preview:' })
  })

  it('warns and stays in memory when only half of the Redis REST pair is set', () => {
    const urlOnly = loadConfig({ VERAPASS_REDIS_REST_URL: 'https://a.example' })
    expect(urlOnly.redis).toBeUndefined()
    expect(urlOnly.warnings.join(' ')).toContain('VERAPASS_REDIS_REST_URL is set but VERAPASS_REDIS_REST_TOKEN is not')
    const tokenOnly = loadConfig({ VERAPASS_REDIS_REST_TOKEN: 'tok' })
    expect(tokenOnly.redis).toBeUndefined()
    expect(tokenOnly.warnings.join(' ')).toContain('VERAPASS_REDIS_REST_TOKEN is set but VERAPASS_REDIS_REST_URL is not')
  })

  it('rejects a plain-http Redis REST URL (except localhost) and a bad key prefix', () => {
    expect(() => loadConfig({ VERAPASS_REDIS_REST_URL: 'http://redis.example', VERAPASS_REDIS_REST_TOKEN: 't' })).toThrow(/https REST URL/)
    expect(loadConfig({ VERAPASS_REDIS_REST_URL: 'http://localhost:8079', VERAPASS_REDIS_REST_TOKEN: 't' }).redis?.url).toBe('http://localhost:8079')
    expect(() => loadConfig({ VERAPASS_REDIS_REST_URL: 'https://a.example', VERAPASS_REDIS_REST_TOKEN: 't', VERAPASS_REDIS_PREFIX: 'has space' })).toThrow(/VERAPASS_REDIS_PREFIX/)
  })

  it('never echoes a rejected Redis URL: a pasted redis:// connection string carries the password', () => {
    const password = 'AbCdEfSecretPassword123'
    const attempt = () => loadConfig({ VERAPASS_REDIS_REST_URL: `rediss://default:${password}@eu1-example.upstash.io:6379`, VERAPASS_REDIS_REST_TOKEN: 't' })
    expect(attempt).toThrow(ConfigError)
    expect(attempt).toThrow(/not a rediss: URL/)
    expect(attempt).toThrow(/redis:\/\/ connection string/)
    try {
      attempt()
    } catch (err) {
      expect((err as Error).message).not.toContain(password)
      expect((err as Error).message).not.toContain('upstash.io')
    }
  })

  it('refuses a REST URL with credentials in it, without echoing them', () => {
    const attempt = () => loadConfig({ KV_REST_API_URL: 'https://user:pw-in-url-123@kv.example', KV_REST_API_TOKEN: 't' })
    expect(attempt).toThrow(/KV_REST_API_URL must not carry credentials\. Put the token in KV_REST_API_TOKEN/)
    try {
      attempt()
    } catch (err) {
      expect((err as Error).message).not.toContain('pw-in-url-123')
    }
    expect(() => loadConfig({ VERAPASS_REDIS_REST_URL: 'https://', VERAPASS_REDIS_REST_TOKEN: 't' })).toThrow(/not a valid URL/)
  })

  it('warns, but still starts, on Vercel without a shared store', () => {
    const env = { NODE_ENV: 'production', VERCEL: '1', RECEIPT_SIGNING_KEY: PEM, TRAVELLER_SECRET: 'a-long-enough-secret-value', ALLOW_SIMULATED_CHECKINS: 'true' }
    const c = loadConfig(env)
    expect(c.vercel).toBe(true)
    expect(c.warnings).toHaveLength(1)
    expect(c.warnings[0]).toContain('Server state is in memory on Vercel')
    expect(c.warnings[0]).toContain('VERAPASS_REDIS_REST_URL')
    const shared = loadConfig({ ...env, VERAPASS_REDIS_REST_URL: 'https://a.example', VERAPASS_REDIS_REST_TOKEN: 'tok' })
    expect(shared.warnings).toEqual([])
  })
})
