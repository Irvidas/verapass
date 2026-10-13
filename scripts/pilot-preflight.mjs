#!/usr/bin/env node
// Pilot preflight: checks the live pilot server's settings before `npm start`.
//
//   node --env-file=.env scripts/pilot-preflight.mjs
//   node --env-file=.env scripts/pilot-preflight.mjs --server https://pilot.example.org
//
// Reads process.env only (Node loads the .env file, this script never opens it). Prints one line
// per setting with PASS, WARN or FAIL and never prints a value: only "set", "missing" or "ok" and
// what is wrong. Then asks the Stellar RPC for getHealth. With --server <url> it also reads
// <url>/api/health from the running server and checks that it really is in live mode.
// Exits 1 if anything failed.
// Plain Node, no dependencies. The checking logic is pure and tested in tests/unit/pilotPreflight.test.ts.
// Setup guide: docs/pilot-server.md.

import { createPrivateKey } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The verapass_stamps v1 contract on testnet (contracts/DEPLOYMENT.md). */
export const PILOT_CONTRACT_ID = 'CDIVZILQLADI72TXKQEGBZO7V6624VTBFUNF6UXUD337G6WTOUEKEZ65'
export const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org'

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
/** StrKey version bytes: S (ed25519 secret seed) and C (contract). */
const VERSION_BYTES = { S: 18 << 3, C: 2 << 3 }

function crc16xmodem(bytes) {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

/**
 * True when `value` is a valid Stellar StrKey of the given kind ('S' secret seed or 'C' contract):
 * 56 base32 characters, the right version byte and a matching CRC16 checksum.
 */
export function isValidStrKey(value, kind) {
  const version = VERSION_BYTES[kind]
  if (version === undefined || typeof value !== 'string' || !/^[A-Z2-7]{56}$/.test(value)) return false
  let bits = 0
  let acc = 0
  const bytes = []
  for (const ch of value) {
    acc = (acc << 5) | BASE32.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 0xff)
    }
  }
  if (bytes.length !== 35 || bytes[0] !== version) return false
  const payload = bytes.slice(0, 33)
  const crc = crc16xmodem(payload)
  return bytes[33] === (crc & 0xff) && bytes[34] === crc >> 8
}

const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/|$)/

/** Same pairs and order as server/config.ts: the first pair with either half set is the one used. */
const REDIS_ENV_PAIRS = [
  ['VERAPASS_REDIS_REST_URL', 'VERAPASS_REDIS_REST_TOKEN'],
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
]

const RATE_LIMITS = ['RATE_LIMIT_TRAVELLER_PER_HOUR', 'RATE_LIMIT_API_PER_MINUTE', 'RATE_LIMIT_PLACE_PER_MINUTE']

function blank(value) {
  return value === undefined || value.trim() === ''
}

function isEd25519Pem(value) {
  try {
    return createPrivateKey(value.replace(/\\n/g, '\n')).asymmetricKeyType === 'ed25519'
  } catch {
    return false
  }
}

/**
 * Checks the pilot settings. Pure apart from parsing the receipt key in memory.
 * Returns [{ name, status: 'PASS' | 'WARN' | 'FAIL', detail }]. A detail never contains a value.
 * `options.distBuilt`: whether dist/index.html exists (only checked when SERVE_STATIC=true).
 */
export function checkEnv(env, options = {}) {
  const results = []
  const add = (name, status, detail) => results.push({ name, status, detail })
  // Trimmed, for settings server/config.ts trims as well.
  const get = (name) => (blank(env[name]) ? undefined : env[name].trim())
  // The server compares NODE_ENV, ALLOW_SIMULATED_CHECKINS, SERVE_STATIC and TRUST_PROXY exactly, so
  // "production " (a stray space or quote in the .env file) is not production there: no trimming here.
  const exact = (name, want, why) => {
    const value = blank(env[name]) ? undefined : env[name]
    if (value === want) add(name, 'PASS', why ? `ok (${why})` : 'ok')
    else if (value !== undefined && value.trim() === want) add(name, 'FAIL', `set, but has spaces around "${want}", so the server does not read it as "${want}"`)
    else add(name, 'FAIL', value !== undefined ? `set, but must be "${want}"${why ? ` (${why})` : ''}` : `missing (must be "${want}")`)
  }
  // Same rule as positiveInt in server/config.ts: only unset or "" fall back to the default, and a
  // value of spaces makes the server refuse to start.
  const positiveInt = (name, max, fallback) => {
    const value = env[name]
    if (value === undefined || value === '') {
      if (fallback !== undefined) add(name, 'PASS', `not set, uses ${fallback}`)
      return
    }
    const n = Number(value)
    if (value.trim() === '' || !Number.isInteger(n) || n <= 0 || n > max) add(name, 'FAIL', 'set, but not a positive whole number in range (the server refuses to start)')
    else add(name, 'PASS', 'set, ok')
  }

  exact('NODE_ENV', 'production')

  const secret = get('STELLAR_SECRET')
  if (!secret) add('STELLAR_SECRET', 'FAIL', 'missing (the attestor secret key, S...)')
  else if (!isValidStrKey(secret, 'S')) add('STELLAR_SECRET', 'FAIL', 'set, but not a valid Stellar secret key (S..., 56 characters, checksum)')
  else add('STELLAR_SECRET', 'PASS', 'set, format ok')

  const contract = get('VERAPASS_CONTRACT_ID')
  if (!contract) add('VERAPASS_CONTRACT_ID', 'FAIL', 'missing (the testnet contract id, C...)')
  else if (!isValidStrKey(contract, 'C')) add('VERAPASS_CONTRACT_ID', 'FAIL', 'set, but not a valid contract id (C..., 56 characters, checksum)')
  else if (contract !== PILOT_CONTRACT_ID) add('VERAPASS_CONTRACT_ID', 'WARN', 'set, format ok, but not the pilot contract in contracts/DEPLOYMENT.md')
  else add('VERAPASS_CONTRACT_ID', 'PASS', 'set, ok (the pilot contract)')

  const traveller = env.TRAVELLER_SECRET
  if (blank(traveller)) add('TRAVELLER_SECRET', 'FAIL', 'missing (fixed for the whole pilot)')
  else if (traveller.trim().length < 16) add('TRAVELLER_SECRET', 'FAIL', 'set, but shorter than 16 characters')
  else add('TRAVELLER_SECRET', 'PASS', 'set, ok')

  const receipt = env.RECEIPT_SIGNING_KEY
  if (blank(receipt)) add('RECEIPT_SIGNING_KEY', 'FAIL', 'missing (an Ed25519 PKCS#8 PEM, fixed for the whole pilot)')
  else if (!isEd25519Pem(receipt)) add('RECEIPT_SIGNING_KEY', 'FAIL', 'set, but not an Ed25519 PKCS#8 PEM key')
  else add('RECEIPT_SIGNING_KEY', 'PASS', 'set, Ed25519 key ok')

  exact('ALLOW_SIMULATED_CHECKINS', 'false', 'off for the pilot')

  // The server only uses PUBLIC_ORIGIN as the return address after card checkout, which is off in the
  // pilot, so a missing or odd value is a warning, not a failure.
  const origin = get('PUBLIC_ORIGIN')
  if (!origin) add('PUBLIC_ORIGIN', 'WARN', 'missing (only used after card checkout, which is off; set it to the pilot URL)')
  else if (!/^https:\/\/[^/\s]+\/?$/.test(origin)) add('PUBLIC_ORIGIN', 'WARN', 'set, but not an https origin with no path (only used after card checkout)')
  else add('PUBLIC_ORIGIN', 'PASS', 'set, https ok')

  if (env.SERVE_STATIC === 'true' && options.distBuilt === false) add('SERVE_STATIC', 'FAIL', 'ok, but dist/index.html is missing: run npm run build')
  else exact('SERVE_STATIC', 'true')

  exact('TRUST_PROXY', 'true', 'behind Caddy or the tunnel')

  if (get('STRIPE_SECRET_KEY')) add('STRIPE_SECRET_KEY', 'FAIL', 'set, but must be empty for the pilot (no payments)')
  else add('STRIPE_SECRET_KEY', 'PASS', 'not set, ok')

  const rpc = get('STELLAR_RPC_URL')
  if (!rpc) add('STELLAR_RPC_URL', 'PASS', 'not set, uses the public testnet RPC')
  else if (!/^https:\/\//.test(rpc) && !LOCAL_HTTP.test(rpc)) add('STELLAR_RPC_URL', 'FAIL', 'set, but must be an https URL (http only for localhost)')
  else add('STELLAR_RPC_URL', 'PASS', 'set, ok')

  positiveInt('PORT', 65535, 8787)
  for (const name of RATE_LIMITS) positiveInt(name, Number.MAX_SAFE_INTEGER)

  add(...checkStateStore(get))

  return results
}

/** The shared-store settings, judged the way server/config.ts reads them. */
function checkStateStore(get) {
  const memory = 'memory: run exactly one instance; a restart clears nonces and pending stamp status'
  const pair = REDIS_ENV_PAIRS.find(([urlName, tokenName]) => get(urlName) || get(tokenName))
  if (!pair) return ['state store', 'WARN', memory]
  const [urlName, tokenName] = pair
  const url = get(urlName)
  if (!url || !get(tokenName)) return ['state store', 'FAIL', `${url ? urlName : tokenName} is set but ${url ? tokenName : urlName} is not: the server falls back to ${memory}`]
  if (!url.startsWith('https://') && !LOCAL_HTTP.test(url)) return ['state store', 'FAIL', `${urlName} must be the https REST URL, not a redis:// connection string (the server refuses to start)`]
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return ['state store', 'FAIL', `${urlName} is not a valid URL (the server refuses to start)`]
  }
  if (parsed.username || parsed.password) return ['state store', 'FAIL', `${urlName} must not carry credentials; put the token in ${tokenName}`]
  const prefix = get('VERAPASS_REDIS_PREFIX')
  if (prefix !== undefined && !/^[\w:.-]{1,64}$/.test(prefix)) return ['state store', 'FAIL', 'VERAPASS_REDIS_PREFIX has characters the server refuses']
  return ['state store', 'PASS', `Redis REST store set through ${urlName} (check /api/health says "redis")`]
}

/** The shared-store mode the server should report in /api/health for this environment. */
function expectedState(env) {
  const get = (name) => (blank(env[name]) ? undefined : env[name].trim())
  return checkStateStore(get)[1] === 'PASS' ? 'redis' : 'memory'
}

/**
 * Reads the running server's /api/health answer and checks it is the live pilot set-up.
 * `env` is the same environment the server was started with. Details never contain a value.
 */
export function checkServerHealth(body, env) {
  const results = []
  const add = (name, ok, good, bad) => results.push({ name: `server ${name}`, status: ok ? 'PASS' : 'FAIL', detail: ok ? good : bad })
  if (!body || typeof body !== 'object' || body.ok !== true) {
    return [{ name: 'server health', status: 'FAIL', detail: 'reachable, but /api/health did not answer {"ok": true}' }]
  }
  add('attestation', body.attestation === 'testnet', 'testnet (live stamping)', 'not testnet: the server is using the mock attestor (check STELLAR_SECRET and VERAPASS_CONTRACT_ID)')
  const contract = blank(env.VERAPASS_CONTRACT_ID) ? undefined : env.VERAPASS_CONTRACT_ID.trim()
  add('contract', typeof body.contractId === 'string' && body.contractId === contract, 'matches VERAPASS_CONTRACT_ID', 'does not match VERAPASS_CONTRACT_ID (is the server running with this environment?)')
  add('simulation', body.simulation === false, 'off', 'on: simulated check-ins are accepted')
  add('receipt key', body.receiptKeyPersistent === true, 'fixed key', 'throwaway key: receipts stop verifying after a restart')
  add('payments', body.payments === 'demo', 'off (demo)', 'Stripe is on')
  const state = expectedState(env)
  add('state', body.state === state, `${state}, as configured`, `does not report "${state}" as configured`)
  return results
}

/** GETs <baseUrl>/api/health. `fetchImpl` is injected in tests. */
export async function probeServer(baseUrl, env, fetchImpl = fetch, timeoutMs = 8000) {
  if (!/^https?:\/\/[^/\s]+\/?$/.test(baseUrl)) {
    return [{ name: 'server health', status: 'FAIL', detail: '--server must be an http(s) origin with no path' }]
  }
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return [{ name: 'server health', status: 'FAIL', detail: `HTTP ${res.status} from /api/health` }]
    const body = await res.json().catch(() => null)
    return checkServerHealth(body, env)
  } catch (err) {
    const reason = err && err.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : 'not reachable'
    return [{ name: 'server health', status: 'FAIL', detail: reason }]
  }
}

/** Reads `--server <url>` or `--server=<url>` from the command line. */
export function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--server') options.server = argv[++i] ?? ''
    else if (arg.startsWith('--server=')) options.server = arg.slice('--server='.length)
    else options.unknown = arg
  }
  return options
}


/** Reads a getHealth JSON-RPC answer. */
export function checkRpcHealth(body) {
  const status = body && typeof body === 'object' && body.result && typeof body.result === 'object' ? body.result.status : undefined
  if (status === 'healthy') return { name: 'Stellar RPC', status: 'PASS', detail: 'reachable, getHealth says healthy' }
  if (body && typeof body === 'object' && body.error) return { name: 'Stellar RPC', status: 'FAIL', detail: 'reachable, but getHealth returned an error' }
  return { name: 'Stellar RPC', status: 'FAIL', detail: `reachable, but getHealth status is ${typeof status === 'string' ? `"${status.slice(0, 32)}"` : 'missing'}` }
}

/** Calls getHealth on the RPC. `fetchImpl` is injected in tests. */
export async function probeRpc(url, fetchImpl = fetch, timeoutMs = 8000) {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { name: 'Stellar RPC', status: 'FAIL', detail: `HTTP ${res.status} from getHealth` }
    return checkRpcHealth(await res.json())
  } catch (err) {
    const reason = err && err.name === 'TimeoutError' ? `no answer within ${timeoutMs / 1000} s` : 'not reachable'
    return { name: 'Stellar RPC', status: 'FAIL', detail: reason }
  }
}

/** One line per result, and whether everything passed (WARN does not fail). */
export function formatReport(results) {
  const width = Math.max(...results.map((r) => r.name.length))
  const lines = results.map((r) => `${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`)
  const failed = results.filter((r) => r.status === 'FAIL').length
  const warned = results.filter((r) => r.status === 'WARN').length
  lines.push('', failed === 0 ? `Preflight passed (${warned} warning${warned === 1 ? '' : 's'}).` : `Preflight failed: ${failed} setting${failed === 1 ? '' : 's'} to fix.`)
  return { text: lines.join('\n'), ok: failed === 0 }
}

async function main() {
  const env = process.env
  const args = parseArgs(process.argv.slice(2))
  if (args.unknown !== undefined) {
    console.error('Usage: node --env-file=.env scripts/pilot-preflight.mjs [--server https://pilot.example.org]')
    process.exitCode = 2
    return
  }
  const results = checkEnv(env, { distBuilt: existsSync(resolve('dist', 'index.html')) })
  const rpcSetting = results.find((r) => r.name === 'STELLAR_RPC_URL')
  if (rpcSetting && rpcSetting.status === 'PASS') {
    results.push(await probeRpc(blank(env.STELLAR_RPC_URL) ? DEFAULT_RPC_URL : env.STELLAR_RPC_URL.trim()))
  } else {
    results.push({ name: 'Stellar RPC', status: 'FAIL', detail: 'not checked: fix STELLAR_RPC_URL first' })
  }
  const [major, minor] = process.versions.node.split('.').map(Number)
  const nodeOk = major > 22 || (major === 22 && minor >= 12)
  results.push({ name: 'Node.js', status: nodeOk ? 'PASS' : 'FAIL', detail: nodeOk ? 'ok (22.12 or newer)' : 'too old: needs 22.12 or newer' })
  if (args.server !== undefined) results.push(...(await probeServer(args.server, env)))
  const report = formatReport(results)
  console.log(report.text)
  process.exitCode = report.ok ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
