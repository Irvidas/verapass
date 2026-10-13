import { serve } from '@hono/node-server'
import { buildServer, describeState } from './bootstrap.js'
import { ConfigError } from './config.js'
import { mountStatic } from './static.js'

try {
  process.loadEnvFile('.env')
} catch {
  // No .env file: run in demo mode with whatever the environment provides.
}

let server: ReturnType<typeof buildServer>
try {
  server = buildServer(process.env)
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`[verapass] ${err.message}`)
    process.exit(1)
  }
  throw err
}
const { app, config, attestor } = server

if (config.serveStatic) mountStatic(app, './dist')

for (const warning of config.warnings) console.warn(`[verapass] warning: ${warning}`)

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(
    `[verapass] API on http://localhost:${info.port} - payments: ${config.stripeSecretKey ? 'Stripe test mode' : 'demo mode'}, attestation: ${attestor.contractId ? `testnet contract ${attestor.contractId}` : 'mock (nothing on chain)'}, simulated check-ins: ${config.allowSimulated ? 'on' : 'off'}, state: ${describeState(config)}`,
  )
})
