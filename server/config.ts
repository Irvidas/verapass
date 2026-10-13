import { randomBytes } from 'node:crypto'
import { StrKey } from '@stellar/stellar-sdk'

export interface RateLimits {
  /** New traveller ids per IP per hour. */
  travellerPerHour: number
  /** Nonce, check-in, checkout and pass calls per IP per minute (each route counted on its own). */
  apiPerMinute: number
  /** Real (not simulated) check-ins per place per minute, across all travellers. */
  placePerMinute: number
}

/** A Redis-compatible REST endpoint (Upstash REST protocol) for state shared between instances. */
export interface RedisRestConfig {
  url: string
  token: string
  prefix: string
  /** Which variable pair the settings came from, for the startup log. Never the values. */
  source: string
}

export interface ServerConfig {
  production: boolean
  port: number
  publicOrigin: string
  stripeSecretKey?: string
  stripeWebhookSecret?: string
  stellarSecret?: string
  /** verapass_stamps contract id (C...). With stellarSecret it turns on live stamping. */
  contractId?: string
  stellarRpcUrl?: string
  /** True when both STELLAR_SECRET and VERAPASS_CONTRACT_ID are set: real check-ins are stamped on testnet. */
  chainLive: boolean
  receiptSigningKey?: string
  travellerSecret: string
  /** False when TRAVELLER_SECRET was not set and a random one was made for this process. */
  travellerSecretPersistent: boolean
  allowSimulated: boolean
  serveStatic: boolean
  /** Read the client IP from X-Forwarded-For (only behind a proxy you control). */
  trustProxy: boolean
  limits: RateLimits
  /** Shared state store. Undefined: state lives in this process only. */
  redis?: RedisRestConfig
  /** Running as a Vercel function (VERCEL is set), where requests may reach different instances. */
  vercel: boolean
  /** Things that work but should be fixed before a real launch. Logged at startup. */
  warnings: string[]
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

const DEFAULT_LIMITS: RateLimits = { travellerPerHour: 30, apiPerMinute: 60, placePerMinute: 120 }

/**
 * Variable pairs for the shared store, first match wins. The project's own names come first; the
 * other two are what the Upstash and Vercel Redis integrations set on their own.
 */
const REDIS_ENV_PAIRS = [
  ['VERAPASS_REDIS_REST_URL', 'VERAPASS_REDIS_REST_TOKEN'],
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
] as const

const DEFAULT_REDIS_PREFIX = 'verapass:'
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/|$)/

/** Reads the shared-store settings. Half a pair is a warning (state stays in memory), a bad URL an error. */
function loadRedis(env: Record<string, string | undefined>, warnings: string[]): RedisRestConfig | undefined {
  for (const [urlName, tokenName] of REDIS_ENV_PAIRS) {
    const url = empty(env[urlName])?.trim()
    const token = empty(env[tokenName])?.trim()
    if (!url && !token) continue
    if (!url || !token) {
      warnings.push(`${url ? urlName : tokenName} is set but ${url ? tokenName : urlName} is not: server state stays in memory.`)
      return undefined
    }
    if (!url.startsWith('https://') && !LOCAL_HTTP.test(url)) {
      // Name only the scheme: a pasted redis:// or rediss:// connection string carries the password.
      const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]
      throw new ConfigError(
        `${urlName} must be the https REST URL (http only for localhost), not ${scheme ? `a ${scheme}: URL` : 'this value'}. Use the REST URL and token, not the redis:// connection string.`,
      )
    }
    let parsed: URL | undefined
    try {
      parsed = new URL(url)
    } catch {
      parsed = undefined
    }
    if (!parsed) throw new ConfigError(`${urlName} is not a valid URL.`)
    if (parsed.username || parsed.password) {
      throw new ConfigError(`${urlName} must not carry credentials. Put the token in ${tokenName}.`)
    }
    const prefix = empty(env.VERAPASS_REDIS_PREFIX)?.trim() ?? DEFAULT_REDIS_PREFIX
    if (!/^[\w:.-]{1,64}$/.test(prefix)) {
      throw new ConfigError('VERAPASS_REDIS_PREFIX may only use letters, digits, "_", ":", "." and "-" (up to 64 characters).')
    }
    return { url, token, prefix, source: urlName }
  }
  return undefined
}

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new ConfigError(`${name} must be a positive integer, got "${value}".`)
  return n
}

function empty(value: string | undefined): string | undefined {
  return value && value.trim() !== '' ? value : undefined
}

/**
 * Reads the server settings from the environment. Pure, so it can be tested.
 * In production (NODE_ENV=production) it refuses settings that would make receipts
 * unverifiable or payments unconfirmable, and simulated check-ins must be chosen explicitly.
 */
export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const production = env.NODE_ENV === 'production'
  const warnings: string[] = []
  const stripeSecretKey = empty(env.STRIPE_SECRET_KEY)
  const stripeWebhookSecret = empty(env.STRIPE_WEBHOOK_SECRET)
  const stellarSecret = empty(env.STELLAR_SECRET)?.trim()
  const contractId = empty(env.VERAPASS_CONTRACT_ID)?.trim()
  const stellarRpcUrl = empty(env.STELLAR_RPC_URL)?.trim()
  const receiptSigningKey = empty(env.RECEIPT_SIGNING_KEY)?.replace(/\\n/g, '\n')
  const travellerSecretEnv = empty(env.TRAVELLER_SECRET)
  const simulatedEnv = empty(env.ALLOW_SIMULATED_CHECKINS)

  if (simulatedEnv !== undefined && simulatedEnv !== 'true' && simulatedEnv !== 'false') {
    throw new ConfigError(`ALLOW_SIMULATED_CHECKINS must be "true" or "false", got "${simulatedEnv}".`)
  }

  if (stellarSecret && !StrKey.isValidEd25519SecretSeed(stellarSecret)) {
    throw new ConfigError('STELLAR_SECRET must be a Stellar secret key (S..., 56 characters).')
  }
  if (contractId && !StrKey.isValidContract(contractId)) {
    throw new ConfigError(`VERAPASS_CONTRACT_ID must be a contract id (C..., 56 characters), got "${contractId}".`)
  }
  if (stellarRpcUrl && !/^https?:\/\//.test(stellarRpcUrl)) {
    throw new ConfigError(`STELLAR_RPC_URL must be an http(s) URL, got "${stellarRpcUrl}".`)
  }
  const chainLive = Boolean(stellarSecret && contractId)

  if (production) {
    const missing: string[] = []
    if (!receiptSigningKey) missing.push('RECEIPT_SIGNING_KEY (receipts signed with a throwaway key cannot be verified after a restart)')
    if (!travellerSecretEnv) missing.push('TRAVELLER_SECRET (traveller ids would stop working after a restart)')
    if (stripeSecretKey && !stripeWebhookSecret) missing.push('STRIPE_WEBHOOK_SECRET (passes would never unlock)')
    if (simulatedEnv === undefined) missing.push('ALLOW_SIMULATED_CHECKINS (set it to "true" or "false" on purpose)')
    if (missing.length > 0) throw new ConfigError(`Refusing to start in production without:\n- ${missing.join('\n- ')}`)
  }

  // Simulated check-ins default to on only for local demos with no chain key.
  const allowSimulated = simulatedEnv !== undefined ? simulatedEnv === 'true' : !production && !stellarSecret

  if (stellarSecret && !contractId) {
    warnings.push('STELLAR_SECRET is set but VERAPASS_CONTRACT_ID is not: stamps use the mock attestor and nothing is written on chain.')
  }
  if (contractId && !stellarSecret) {
    warnings.push('VERAPASS_CONTRACT_ID is set but STELLAR_SECRET is not: stamps use the mock attestor and nothing is written on chain.')
  }

  if (stripeSecretKey && !stripeWebhookSecret) {
    warnings.push('STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not: passes unlock only through the Checkout Session lookup on the success page.')
  }
  if (!receiptSigningKey) warnings.push('RECEIPT_SIGNING_KEY is not set: receipts are signed with a new key on every start.')
  if (!travellerSecretEnv) warnings.push('TRAVELLER_SECRET is not set: traveller ids are only valid until the server restarts.')

  const redis = loadRedis(env, warnings)
  const vercel = empty(env.VERCEL) !== undefined
  if (vercel && !redis) {
    // Not a refusal: the demo keeps working, only less reliably.
    warnings.push(
      'Server state is in memory on Vercel, where requests can reach different instances: check-ins can fail with an unknown nonce and a paid pass can stay locked. Set VERAPASS_REDIS_REST_URL and VERAPASS_REDIS_REST_TOKEN to share state.',
    )
  }

  return {
    production,
    port: positiveInt(env.PORT, 8787, 'PORT'),
    publicOrigin: empty(env.PUBLIC_ORIGIN) ?? 'http://localhost:5173',
    stripeSecretKey,
    stripeWebhookSecret,
    stellarSecret,
    contractId,
    stellarRpcUrl,
    chainLive,
    receiptSigningKey,
    travellerSecret: travellerSecretEnv ?? randomBytes(32).toString('hex'),
    travellerSecretPersistent: Boolean(travellerSecretEnv),
    allowSimulated,
    serveStatic: env.SERVE_STATIC === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
    limits: {
      travellerPerHour: positiveInt(env.RATE_LIMIT_TRAVELLER_PER_HOUR, DEFAULT_LIMITS.travellerPerHour, 'RATE_LIMIT_TRAVELLER_PER_HOUR'),
      apiPerMinute: positiveInt(env.RATE_LIMIT_API_PER_MINUTE, DEFAULT_LIMITS.apiPerMinute, 'RATE_LIMIT_API_PER_MINUTE'),
      placePerMinute: positiveInt(env.RATE_LIMIT_PLACE_PER_MINUTE, DEFAULT_LIMITS.placePerMinute, 'RATE_LIMIT_PLACE_PER_MINUTE'),
    },
    redis,
    vercel,
    warnings,
  }
}

export { DEFAULT_LIMITS }
