import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import {
  PILOT_CONTRACT_ID,
  checkEnv,
  checkRpcHealth,
  checkServerHealth,
  formatReport,
  isValidStrKey,
  parseArgs,
  probeRpc,
  probeServer,
  type CheckResult,
} from '../../scripts/pilot-preflight.mjs'

/** Throwaway values made per run. None of them is a real key. */
const SECRET = Keypair.random().secret()
const TRAVELLER = randomBytes(32).toString('hex')
const PEM = (generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }) as string).replace(/\n/g, '\\n')

const GOOD: Record<string, string> = {
  NODE_ENV: 'production',
  STELLAR_SECRET: SECRET,
  VERAPASS_CONTRACT_ID: PILOT_CONTRACT_ID,
  TRAVELLER_SECRET: TRAVELLER,
  RECEIPT_SIGNING_KEY: PEM,
  ALLOW_SIMULATED_CHECKINS: 'false',
  PUBLIC_ORIGIN: 'https://pilot.example.org',
  SERVE_STATIC: 'true',
  TRUST_PROXY: 'true',
}

function byName(results: CheckResult[], name: string): CheckResult {
  const found = results.find((r) => r.name === name)
  if (!found) throw new Error(`no result for ${name}`)
  return found
}

describe('isValidStrKey', () => {
  it('accepts real secret seeds and contract ids', () => {
    expect(isValidStrKey(SECRET, 'S')).toBe(true)
    expect(isValidStrKey(PILOT_CONTRACT_ID, 'C')).toBe(true)
    expect(isValidStrKey(StrKey.encodeContract(randomBytes(32)), 'C')).toBe(true)
  })

  it('rejects the wrong kind, a broken checksum and junk', () => {
    expect(isValidStrKey(SECRET, 'C')).toBe(false)
    expect(isValidStrKey(PILOT_CONTRACT_ID, 'S')).toBe(false)
    expect(isValidStrKey(Keypair.random().publicKey(), 'S')).toBe(false)
    const last = PILOT_CONTRACT_ID.at(-1) === 'A' ? 'B' : 'A'
    expect(isValidStrKey(PILOT_CONTRACT_ID.slice(0, -1) + last, 'C')).toBe(false)
    expect(isValidStrKey('C123', 'C')).toBe(false)
    expect(isValidStrKey(undefined, 'C')).toBe(false)
  })
})

describe('checkEnv', () => {
  it('passes a complete pilot configuration, with a warning for the memory store', () => {
    const results = checkEnv(GOOD, { distBuilt: true })
    expect(results.filter((r) => r.status === 'FAIL')).toEqual([])
    expect(byName(results, 'state store').status).toBe('WARN')
    expect(formatReport(results).ok).toBe(true)
  })

  it('fails every required setting when the environment is empty', () => {
    const results = checkEnv({})
    for (const name of ['NODE_ENV', 'STELLAR_SECRET', 'VERAPASS_CONTRACT_ID', 'TRAVELLER_SECRET', 'RECEIPT_SIGNING_KEY', 'ALLOW_SIMULATED_CHECKINS', 'SERVE_STATIC', 'TRUST_PROXY']) {
      expect(byName(results, name)).toMatchObject({ status: 'FAIL' })
      expect(byName(results, name).detail).toMatch(/^missing/)
    }
    // Only the card checkout uses PUBLIC_ORIGIN, and checkout is off in the pilot.
    expect(byName(results, 'PUBLIC_ORIGIN')).toMatchObject({ status: 'WARN', detail: expect.stringMatching(/^missing/) })
    expect(formatReport(results).ok).toBe(false)
  })

  it('rejects settings that are present but wrong', () => {
    const results = checkEnv(
      {
        ...GOOD,
        STELLAR_SECRET: Keypair.random().publicKey(),
        VERAPASS_CONTRACT_ID: 'CNOTACONTRACT',
        TRAVELLER_SECRET: 'short',
        // Built from parts so the publish check's private-key scan does not flag this fake value.
        RECEIPT_SIGNING_KEY: ['-----BEGIN', 'PRIVATE KEY-----\\nabc\\n-----END', 'PRIVATE KEY-----'].join(' '),
        ALLOW_SIMULATED_CHECKINS: 'true',
        PUBLIC_ORIGIN: 'http://pilot.example.org',
        TRUST_PROXY: 'false',
        STRIPE_SECRET_KEY: 'sk_test_x',
        STELLAR_RPC_URL: 'http://rpc.example.org',
        PORT: '99999',
        RATE_LIMIT_API_PER_MINUTE: '0',
        RATE_LIMIT_PLACE_PER_MINUTE: '1.5',
      },
      { distBuilt: true },
    )
    for (const name of ['STELLAR_SECRET', 'VERAPASS_CONTRACT_ID', 'TRAVELLER_SECRET', 'RECEIPT_SIGNING_KEY', 'ALLOW_SIMULATED_CHECKINS', 'TRUST_PROXY', 'STRIPE_SECRET_KEY', 'STELLAR_RPC_URL', 'PORT', 'RATE_LIMIT_API_PER_MINUTE', 'RATE_LIMIT_PLACE_PER_MINUTE']) {
      expect(byName(results, name).status, name).toBe('FAIL')
    }
    expect(byName(results, 'PUBLIC_ORIGIN').status).toBe('WARN')
  })

  it('accepts a plain-http RPC only on localhost, and valid rate limits', () => {
    const results = checkEnv({ ...GOOD, STELLAR_RPC_URL: 'http://localhost:8000/soroban/rpc', RATE_LIMIT_TRAVELLER_PER_HOUR: '100' }, { distBuilt: true })
    expect(byName(results, 'STELLAR_RPC_URL').status).toBe('PASS')
    expect(byName(results, 'RATE_LIMIT_TRAVELLER_PER_HOUR').status).toBe('PASS')
    expect(results.filter((r) => r.status === 'FAIL')).toEqual([])
  })

  it('rejects an RSA receipt key and a public origin with a path', () => {
    const rsa = (generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ format: 'pem', type: 'pkcs8' }) as string)
    const results = checkEnv({ ...GOOD, RECEIPT_SIGNING_KEY: rsa, PUBLIC_ORIGIN: 'https://pilot.example.org/app' })
    expect(byName(results, 'RECEIPT_SIGNING_KEY').status).toBe('FAIL')
    expect(byName(results, 'PUBLIC_ORIGIN').status).toBe('WARN')
  })

  it('warns, without failing, on a valid contract id that is not the pilot contract', () => {
    const other = StrKey.encodeContract(randomBytes(32))
    expect(byName(checkEnv({ ...GOOD, VERAPASS_CONTRACT_ID: other }), 'VERAPASS_CONTRACT_ID').status).toBe('WARN')
  })

  it('fails SERVE_STATIC when the web app is not built', () => {
    expect(byName(checkEnv(GOOD, { distBuilt: false }), 'SERVE_STATIC').detail).toMatch(/npm run build/)
  })

  it('counts a complete Redis REST pair as shared state', () => {
    const token = randomBytes(16).toString('hex')
    expect(byName(checkEnv({ ...GOOD, VERAPASS_REDIS_REST_URL: 'https://redis.example.org', VERAPASS_REDIS_REST_TOKEN: token }), 'state store').status).toBe('PASS')
    expect(byName(checkEnv({ ...GOOD, KV_REST_API_URL: 'https://kv.example.org', KV_REST_API_TOKEN: token }), 'state store').detail).toContain('KV_REST_API_URL')
  })

  it('fails Redis settings the server would ignore or refuse', () => {
    const token = randomBytes(16).toString('hex')
    const store = (env: Record<string, string>) => byName(checkEnv({ ...GOOD, ...env }), 'state store')
    // Half a pair: the server warns and keeps state in memory, which the operator did not intend.
    expect(store({ VERAPASS_REDIS_REST_URL: 'https://redis.example.org' })).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('VERAPASS_REDIS_REST_TOKEN is not') })
    expect(store({ UPSTASH_REDIS_REST_TOKEN: token })).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('UPSTASH_REDIS_REST_URL is not') })
    // The first pair with either half set wins, as in server/config.ts.
    expect(store({ VERAPASS_REDIS_REST_TOKEN: token, KV_REST_API_URL: 'https://kv.example.org', KV_REST_API_TOKEN: token }).status).toBe('FAIL')
    expect(store({ VERAPASS_REDIS_REST_URL: 'rediss://default:pw@redis.example.org:6379', VERAPASS_REDIS_REST_TOKEN: token }).status).toBe('FAIL')
    expect(store({ VERAPASS_REDIS_REST_URL: 'https://user:pw@redis.example.org', VERAPASS_REDIS_REST_TOKEN: token }).status).toBe('FAIL')
    expect(store({ VERAPASS_REDIS_REST_URL: 'https://redis.example.org', VERAPASS_REDIS_REST_TOKEN: token, VERAPASS_REDIS_PREFIX: 'bad prefix!' }).status).toBe('FAIL')
    const text = formatReport(checkEnv({ ...GOOD, VERAPASS_REDIS_REST_URL: 'rediss://default:pw@redis.example.org:6379', VERAPASS_REDIS_REST_TOKEN: token })).text
    expect(text).not.toContain('pw@')
    expect(text).not.toContain(token)
  })

  it('agrees with the server about which environments start at all', async () => {
    const { loadConfig } = await import('../../server/config')
    const token = randomBytes(16).toString('hex')
    const refused = [
      { ...GOOD, ALLOW_SIMULATED_CHECKINS: 'maybe' },
      { ...GOOD, STELLAR_SECRET: Keypair.random().publicKey() },
      { ...GOOD, VERAPASS_CONTRACT_ID: 'CNOTACONTRACT' },
      { ...GOOD, RECEIPT_SIGNING_KEY: '' },
      { ...GOOD, TRAVELLER_SECRET: '' },
      { ...GOOD, RATE_LIMIT_API_PER_MINUTE: '0' },
      { ...GOOD, VERAPASS_REDIS_REST_URL: 'redis://redis.example.org', VERAPASS_REDIS_REST_TOKEN: token },
    ]
    for (const env of refused) {
      expect(() => loadConfig(env)).toThrow()
      expect(formatReport(checkEnv(env, { distBuilt: true })).ok).toBe(false)
    }
    const config = loadConfig(GOOD)
    expect(config).toMatchObject({ production: true, chainLive: true, allowSimulated: false, serveStatic: true, trustProxy: true, travellerSecretPersistent: true })
    expect(formatReport(checkEnv(GOOD, { distBuilt: true })).ok).toBe(true)
  })

  it('fails padded values the server compares exactly, instead of passing a server that is not in pilot mode', async () => {
    const { loadConfig } = await import('../../server/config')
    // The server reads these with `=== value`: with a stray space it would run outside production,
    // without static files or without the proxy IP, while a trimming preflight said PASS.
    const padded = { ...GOOD, NODE_ENV: 'production ', SERVE_STATIC: ' true', TRUST_PROXY: 'true ' }
    const config = loadConfig(padded)
    expect(config).toMatchObject({ production: false, serveStatic: false, trustProxy: false })
    const results = checkEnv(padded, { distBuilt: true })
    for (const name of ['NODE_ENV', 'SERVE_STATIC', 'TRUST_PROXY']) {
      expect(byName(results, name).status, name).toBe('FAIL')
      expect(byName(results, name).detail, name).toMatch(/spaces around/)
    }
    // The server refuses " false" outright.
    expect(() => loadConfig({ ...GOOD, ALLOW_SIMULATED_CHECKINS: ' false' })).toThrow()
    expect(byName(checkEnv({ ...GOOD, ALLOW_SIMULATED_CHECKINS: ' false' }), 'ALLOW_SIMULATED_CHECKINS').status).toBe('FAIL')
  })

  it('fails a PORT or rate limit made of spaces, which the server refuses', async () => {
    const { loadConfig } = await import('../../server/config')
    for (const env of [{ ...GOOD, PORT: '  ' }, { ...GOOD, RATE_LIMIT_PLACE_PER_MINUTE: ' ' }]) {
      expect(() => loadConfig(env)).toThrow()
      expect(formatReport(checkEnv(env, { distBuilt: true })).ok).toBe(false)
    }
    expect(byName(checkEnv({ ...GOOD, PORT: '' }), 'PORT')).toMatchObject({ status: 'PASS', detail: 'not set, uses 8787' })
  })

  it('never prints a value, good or bad', () => {
    const bad = { ...GOOD, TRAVELLER_SECRET: 'tiny-secret', PUBLIC_ORIGIN: 'http://leak.example.org', STRIPE_SECRET_KEY: 'sk_test_leakme' }
    for (const env of [GOOD, bad]) {
      const { text } = formatReport(checkEnv(env, { distBuilt: true }))
      for (const value of Object.values(env)) {
        if (['production', 'true', 'false'].includes(value)) continue
        expect(text).not.toContain(value)
      }
      expect(text).not.toContain(SECRET.slice(0, 12))
      expect(text).not.toContain(['BEGIN', 'PRIVATE KEY'].join(' '))
    }
  })
})

describe('Stellar RPC check', () => {
  it('reads getHealth answers', () => {
    expect(checkRpcHealth({ jsonrpc: '2.0', id: 1, result: { status: 'healthy', latestLedger: 1 } }).status).toBe('PASS')
    expect(checkRpcHealth({ jsonrpc: '2.0', id: 1, result: { status: 'unhealthy' } })).toMatchObject({ status: 'FAIL', detail: expect.stringContaining('unhealthy') })
    expect(checkRpcHealth({ jsonrpc: '2.0', id: 1, error: { code: -32601 } }).status).toBe('FAIL')
    expect(checkRpcHealth(null).status).toBe('FAIL')
  })

  it('sends getHealth and handles HTTP errors and unreachable hosts', async () => {
    let sent: unknown
    const healthy = async (_url: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { status: 'healthy' } }))
    }
    expect((await probeRpc('https://rpc.test', healthy)).status).toBe('PASS')
    expect(sent).toMatchObject({ jsonrpc: '2.0', method: 'getHealth' })
    expect(await probeRpc('https://rpc.test', async () => new Response('no', { status: 503 }))).toMatchObject({ status: 'FAIL', detail: 'HTTP 503 from getHealth' })
    const down = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await probeRpc('https://rpc.test', down)).toMatchObject({ status: 'FAIL', detail: 'not reachable' })
  })
})

describe('running server check', () => {
  const LIVE = {
    ok: true,
    state: 'memory',
    payments: 'demo',
    attestation: 'testnet',
    contractId: PILOT_CONTRACT_ID,
    simulation: false,
    receiptPublicKey: 'MCowBQYDK2VwAyEA',
    receiptKeyPersistent: true,
  }

  it('passes a live pilot server', () => {
    const results = checkServerHealth(LIVE, GOOD)
    expect(results.map((r) => r.name)).toEqual(['server attestation', 'server contract', 'server simulation', 'server receipt key', 'server payments', 'server state'])
    expect(results.filter((r) => r.status !== 'PASS')).toEqual([])
  })

  it('fails a demo-mode server or one started with another environment', () => {
    const demo = { ...LIVE, attestation: 'mock', contractId: null, simulation: true, receiptKeyPersistent: false, payments: 'stripe-test', state: 'redis' }
    const results = checkServerHealth(demo, GOOD)
    expect(results.every((r) => r.status === 'FAIL')).toBe(true)
    const other = StrKey.encodeContract(randomBytes(32))
    expect(byName(checkServerHealth({ ...LIVE, contractId: other }, GOOD), 'server contract').status).toBe('FAIL')
    expect(checkServerHealth({ ok: false }, GOOD)).toMatchObject([{ name: 'server health', status: 'FAIL' }])
    expect(checkServerHealth('<html>', GOOD)).toMatchObject([{ name: 'server health', status: 'FAIL' }])
  })

  it('never prints the contract id or the receipt key', () => {
    const text = formatReport(checkServerHealth({ ...LIVE, contractId: StrKey.encodeContract(randomBytes(32)) }, GOOD)).text
    expect(text).not.toContain(PILOT_CONTRACT_ID)
    expect(text).not.toContain(LIVE.receiptPublicKey)
  })

  it('reads /api/health from the given origin and handles errors', async () => {
    let asked = ''
    const ok = async (url: string) => {
      asked = url
      return new Response(JSON.stringify(LIVE))
    }
    expect((await probeServer('https://pilot.example.org/', GOOD, ok)).every((r) => r.status === 'PASS')).toBe(true)
    expect(asked).toBe('https://pilot.example.org/api/health')
    expect(await probeServer('https://pilot.example.org', GOOD, async () => new Response('down', { status: 502 }))).toMatchObject([{ status: 'FAIL', detail: 'HTTP 502 from /api/health' }])
    expect(await probeServer('https://pilot.example.org', GOOD, async () => new Response('not json'))).toMatchObject([{ status: 'FAIL' }])
    const down = async () => {
      throw new TypeError('fetch failed')
    }
    expect(await probeServer('https://pilot.example.org', GOOD, down)).toMatchObject([{ status: 'FAIL', detail: 'not reachable' }])
    expect(await probeServer('pilot.example.org/app', GOOD, ok)).toMatchObject([{ status: 'FAIL' }])
  })

  it('parses --server in both forms and flags anything else', () => {
    expect(parseArgs(['--server', 'https://a.example'])).toEqual({ server: 'https://a.example' })
    expect(parseArgs(['--server=https://a.example'])).toEqual({ server: 'https://a.example' })
    expect(parseArgs([])).toEqual({})
    expect(parseArgs(['--verbose'])).toEqual({ unknown: '--verbose' })
  })
})
