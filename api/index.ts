import { handle } from 'hono/vercel'
import { buildServer, describeState } from '../server/bootstrap.js'

// The Vercel function for every /api/* path (vercel.json rewrites them here). Built once per
// instance. Instances share state only when a Redis REST store is configured
// (VERAPASS_REDIS_REST_URL and VERAPASS_REDIS_REST_TOKEN); otherwise each keeps its own, in memory.
const { app, config } = buildServer(process.env)
for (const warning of config.warnings) console.warn(`[verapass] warning: ${warning}`)
console.log(`[verapass] state: ${describeState(config)}`)

const handler = handle(app)
export const GET = handler
export const POST = handler
export const OPTIONS = handler
