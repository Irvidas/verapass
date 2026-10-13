import { createApp } from './app.js'
import { createAttestor } from './attestor.js'
import { loadConfig, type ServerConfig } from './config.js'
import { createReceiptSigner } from './receipts.js'
import { redisBackend, type FetchLike } from './redisStore.js'
import { memoryBackend, type StateBackend } from './store.js'

/** Shared Redis REST store when it is configured, otherwise this process's memory. */
export function createStateBackend(config: Pick<ServerConfig, 'redis'>, fetch?: FetchLike): StateBackend {
  if (!config.redis) return memoryBackend()
  return redisBackend({ url: config.redis.url, token: config.redis.token, prefix: config.redis.prefix, fetch })
}

/** One line for the startup log. Names the variable that was used, never its value. */
export function describeState(config: Pick<ServerConfig, 'redis'>): string {
  return config.redis ? `shared Redis REST store (${config.redis.source}, prefix "${config.redis.prefix}")` : 'in memory (this process only)'
}

/**
 * Builds the API from environment settings. Shared by the long-running Node server
 * (server/index.ts) and the Vercel function (api/index.ts). Throws ConfigError on bad settings.
 */
export function buildServer(env: Record<string, string | undefined>, options: { fetch?: FetchLike } = {}) {
  const config: ServerConfig = loadConfig(env)
  const attestor = createAttestor({
    stellarSecret: config.stellarSecret,
    contractId: config.contractId,
    addressSecret: config.travellerSecret,
    rpcUrl: config.stellarRpcUrl,
  })
  const state = createStateBackend(config, options.fetch)
  const app = createApp({
    stripeSecretKey: config.stripeSecretKey,
    stripeWebhookSecret: config.stripeWebhookSecret,
    publicOrigin: config.publicOrigin,
    attestor,
    signer: createReceiptSigner(config.receiptSigningKey),
    allowSimulated: config.allowSimulated,
    travellerSecret: config.travellerSecret,
    limits: config.limits,
    trustProxy: config.trustProxy,
    state,
  })
  return { app, config, attestor, state }
}
