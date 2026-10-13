import { randomBytes } from 'node:crypto'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'
import Stripe from 'stripe'
import type {
  AttestationStatus,
  CheckinError,
  CheckinReceipt,
  CheckinRejection,
  CheckinRequest,
  CheckinResponse,
  NonceRequest,
  ProofPreimage,
  TravellerResponse,
} from '../shared/checkin.js'
import { canonicalJson } from '../shared/checkin.js'
import { checkGeofence } from '../shared/geo.js'
import { getPlaceSummary } from '../shared/places.js'
import { PHUKET_PASS } from '../shared/pricing.js'
import { ATTESTATION_STATUS_TTL_MS, AttestationQueue } from './attestations.js'
import { MockAttestor, type Attestor } from './attestor.js'
import { DEFAULT_LIMITS, type RateLimits } from './config.js'
import { createTravellerIdentity } from './identity.js'
import { isWithinClockSkew, NonceStore } from './nonce.js'
import { getPlace, hiddenDetails } from './places.js'
import { RateLimiter } from './rateLimit.js'
import { sha256Hex, type ReceiptSigner } from './receipts.js'
import { memoryBackend, StoreError, type StateBackend } from './store.js'
import { isPlausibleTravel, type Fix } from './velocity.js'

export interface PassRecord {
  sessionId: string
  paid: boolean
  demo: boolean
  /** The traveller who bought it. A pass only unlocks for this traveller. */
  traveller: string | null
  paidAt: number
}

export interface AppDeps {
  stripeSecretKey?: string
  stripeWebhookSecret?: string
  publicOrigin: string
  /** Writes real check-ins on chain. Simulated check-ins never reach it: they always use a mock. */
  attestor: Attestor
  signer: ReceiptSigner
  /** Lets the "simulate being here" demo through. The receipt is always marked simulated. */
  allowSimulated: boolean
  /** HMAC key for traveller ids. A random one is made when it is missing (ids then die with the process). */
  travellerSecret?: string
  limits?: Partial<RateLimits>
  /** Read the client IP from X-Forwarded-For. Only behind a proxy you control. */
  trustProxy?: boolean
  /** How long /api/checkin waits for the on-chain record before answering 202 with a pending status. */
  attestationWaitMs?: number
  attestationRetries?: number
  attestationRetryDelayMs?: number
  now?: () => number
  /**
   * Where server state lives (nonces, passes, last fixes, rate-limit counts, attestation status).
   * In memory by default; a shared backend (Redis REST) lets several instances serve one demo.
   */
  state?: StateBackend
  /** Injected in tests to avoid network calls to Stripe. */
  stripe?: Pick<Stripe, 'checkout'>
}

const MAX_ID_LENGTH = 128
const JSON_BODY_LIMIT = 8 * 1024
const WEBHOOK_BODY_LIMIT = 64 * 1024
const DAY_MS = 24 * 3_600_000
/** A real check-in holds a per-traveller lock while it reads and writes the last fix. */
const CHECKIN_LOCK_TTL_MS = 10_000
const CHECKIN_LOCK_WAIT_MS = 2_000
const CHECKIN_LOCK_POLL_MS = 25
const CHECKIN_LOCK_MAX_POLL_MS = 200
const LOCK_BUSY = Symbol('lock-busy')
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && /^[\w:.-]+$/.test(value)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The client address from X-Forwarded-For, for a server behind exactly one proxy it trusts: the
 * rightmost entry. Caddy and Vercel replace the header (one entry); a Cloudflare tunnel appends the
 * client address to whatever the client sent, so only the last entry cannot be forged.
 */
export function clientIpFromForwarded(header: string | undefined): string | undefined {
  const entries = (header ?? '').split(',').map((e) => e.trim()).filter(Boolean)
  return entries.at(-1)
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/

/** Stripe redirects back to the page that started checkout, but only to known origins. */
export function redirectOrigin(requestOrigin: string | undefined, publicOrigin: string): string {
  const configured = publicOrigin.replace(/\/$/, '')
  if (requestOrigin && (requestOrigin === configured || LOCAL_ORIGIN.test(requestOrigin))) return requestOrigin
  return configured
}

const REJECTION_MESSAGES: Record<CheckinRejection, string> = {
  'bad-request': 'The check-in request is missing fields.',
  'unknown-place': 'This place is not on the Verapass map.',
  'nonce-unknown': 'This check-in was not started by the server. Try again.',
  'nonce-used': 'This check-in code was already used.',
  'nonce-expired': 'The check-in window (2 minutes) closed. Try again.',
  'nonce-mismatch': 'This check-in code belongs to another place or traveller.',
  'clock-skew': 'Your device clock is too far from the server clock.',
  'invalid-coordinates': 'The location fix is not valid.',
  'too-far': 'You are not at this place yet.',
  'low-accuracy': 'Your GPS fix is too rough to prove you are here. Step outside and try again.',
  'too-fast': 'This is too far from your last check-in for the time that passed.',
  'simulation-disabled': 'Simulated check-ins are turned off on this server.',
  'traveller-invalid': 'This passport id was not issued by this server. Reload the page to get a new one.',
  'pass-required': 'This is a hidden place. It opens with the Phuket pass.',
  'rate-limited': 'Too many requests from your connection. Wait a minute and try again.',
  'place-busy': 'This place is getting more check-ins than people can make. Try again in a minute.',
}

type Status = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502

function reject(c: Context, error: CheckinRejection, status: Status, distanceM?: number) {
  const body: CheckinError = { error, message: REJECTION_MESSAGES[error] }
  if (distanceM !== undefined && Number.isFinite(distanceM)) body.distanceM = Math.round(distanceM)
  return c.json(body, status)
}

const jsonLimit = bodyLimit({
  maxSize: JSON_BODY_LIMIT,
  onError: (c) => c.json({ error: 'too-large', message: 'The request body is too large.' }, 413),
})

export function createApp(deps: AppDeps) {
  const now = deps.now ?? Date.now
  const limits: RateLimits = { ...DEFAULT_LIMITS, ...deps.limits }
  const identity = createTravellerIdentity(deps.travellerSecret ?? randomBytes(32).toString('hex'))
  const state = deps.state ?? memoryBackend(now)
  const nonces = new NonceStore({ now, backend: state })
  // Only fixes from the last day matter for the speed check.
  const lastFix = state.store<Fix>('fix', { ttlMs: DAY_MS, maxEntries: 200_000 })
  const checkinLocks = state.store<string>('checkin-lock', { ttlMs: CHECKIN_LOCK_TTL_MS, maxEntries: 200_000 })
  const passes = state.store<PassRecord>('pass', { ttlMs: 30 * DAY_MS, maxEntries: 100_000 })
  const passByTraveller = state.store<string>('pass-by-traveller', { ttlMs: 30 * DAY_MS, maxEntries: 100_000 })
  const statusStore = (name: string) => state.store<AttestationStatus>(name, { ttlMs: ATTESTATION_STATUS_TTL_MS, maxEntries: 50_000 })
  const queueOptions = { now, retries: deps.attestationRetries, retryDelayMs: deps.attestationRetryDelayMs }
  const chainQueue = new AttestationQueue(deps.attestor, deps.signer, { ...queueOptions, store: statusStore('attestation') })
  // Demo visits never touch the chain, even when a Stellar key is set: on chain they would look real.
  const demoQueue =
    deps.attestor instanceof MockAttestor
      ? chainQueue
      : new AttestationQueue(new MockAttestor(), deps.signer, { now, retries: 0, store: statusStore('attestation-demo') })
  const waitMs = deps.attestationWaitMs ?? 4000

  const limiter = (name: string, limit: number, windowMs: number) => new RateLimiter(limit, windowMs, { now, backend: state, name })
  const limiters = {
    traveller: limiter('traveller', limits.travellerPerHour, 3_600_000),
    nonce: limiter('nonce', limits.apiPerMinute, 60_000),
    checkin: limiter('checkin', limits.apiPerMinute, 60_000),
    checkout: limiter('checkout', limits.apiPerMinute, 60_000),
    pass: limiter('pass', limits.apiPerMinute, 60_000),
    read: limiter('read', limits.apiPerMinute, 60_000),
    place: limiter('place', limits.placePerMinute, 60_000),
  }

  if (deps.stripeSecretKey?.startsWith('sk_live_')) {
    throw new Error('Verapass runs Stripe in test mode only. Use an sk_test_ key.')
  }
  const stripe: Pick<Stripe, 'checkout'> | null =
    deps.stripe ?? (deps.stripeSecretKey ? new Stripe(deps.stripeSecretKey) : null)

  const clientIp = (c: Context): string => {
    if (deps.trustProxy) {
      // The last entry is the one our proxy wrote. Earlier entries come from the client: a proxy
      // that appends (a Cloudflare tunnel) keeps whatever the client sent in front of it.
      const forwarded = clientIpFromForwarded(c.req.header('x-forwarded-for'))
      if (forwarded) return forwarded
    }
    try {
      return getConnInfo(c).remote.address ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

  const perIp =
    (limiter: RateLimiter): MiddlewareHandler =>
    async (c, next) => {
      const result = await limiter.hit(clientIp(c))
      if (!result.ok) {
        c.header('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)))
        return reject(c, 'rate-limited', 429)
      }
      await next()
    }

  const recordPass = async (record: PassRecord) => {
    await passes.set(record.sessionId, record)
    if (record.paid && record.traveller) await passByTraveller.set(record.traveller, record.sessionId)
  }

  /** The Checkout Session of the traveller's paid pass, if there is one. */
  const paidPassSession = async (traveller: string): Promise<string | undefined> => {
    const sessionId = await passByTraveller.get(traveller)
    const pass = sessionId ? await passes.get(sessionId) : undefined
    return pass?.paid && pass.traveller === traveller ? sessionId : undefined
  }

  const hasPaidPass = async (traveller: string): Promise<boolean> => (await paidPassSession(traveller)) !== undefined

  /**
   * Runs fn while holding the traveller's check-in lock, so two check-ins sent at the same moment
   * (to one instance or to two) cannot both pass the speed check against the same old fix.
   * Waits up to CHECKIN_LOCK_WAIT_MS of real time for the lock, backing off between tries so a
   * waiting check-in does not hammer a shared store. The lock holds a random owner id and is
   * released only while it still holds that id: if fn outlives CHECKIN_LOCK_TTL_MS (a slow store)
   * and another check-in takes the lock over, this one must not delete the newer lock.
   */
  const withCheckinLock = async <T>(traveller: string, fn: () => Promise<T>): Promise<T | typeof LOCK_BUSY> => {
    const owner = randomBytes(12).toString('hex')
    const deadline = Date.now() + CHECKIN_LOCK_WAIT_MS
    let pause = CHECKIN_LOCK_POLL_MS
    while (!(await checkinLocks.add(traveller, owner))) {
      if (Date.now() >= deadline) return LOCK_BUSY
      await realSleep(pause)
      pause = Math.min(pause * 2, CHECKIN_LOCK_MAX_POLL_MS)
    }
    try {
      return await fn()
    } finally {
      // If the release fails, the lock still expires after CHECKIN_LOCK_TTL_MS.
      await checkinLocks.deleteIf(traveller, owner).catch((err: unknown) => {
        console.error('[verapass] could not release a check-in lock:', err instanceof Error ? err.message : err)
      })
    }
  }

  /** Webhook missed or server restarted: ask Stripe directly. */
  const lookupStripeSession = async (sessionId: string): Promise<PassRecord | undefined> => {
    if (!stripe || !sessionId.startsWith('cs_')) return undefined
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId)
      if (session.payment_status !== 'paid') return undefined
      const traveller = identity.verify(session.client_reference_id) ? session.client_reference_id : null
      const record: PassRecord = { sessionId, paid: true, demo: false, traveller, paidAt: now() }
      await recordPass(record)
      return record
    } catch (err) {
      console.error('[verapass] Checkout Session lookup failed:', err instanceof Error ? err.message : err)
      return undefined
    }
  }

  const app = new Hono()
  app.use('*', secureHeaders())
  app.onError((err, c) => {
    if (err instanceof StoreError) {
      console.error('[verapass] state store unavailable:', err.message)
      return c.json({ error: 'state-unavailable', message: 'The server could not reach its data store. Try again in a moment.' }, 503)
    }
    console.error('[verapass] unhandled error:', err)
    return c.text('Internal Server Error', 500)
  })

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      state: state.kind,
      payments: stripe ? 'stripe-test' : 'demo',
      attestation: deps.attestor.mode,
      contractId: deps.attestor.contractId ?? null,
      simulation: deps.allowSimulated,
      receiptPublicKey: deps.signer.publicKey,
      receiptKeyPersistent: deps.signer.persistent,
    }),
  )

  app.post('/api/traveller', perIp(limiters.traveller), (c) => {
    const body: TravellerResponse = { traveller: identity.issue() }
    return c.json(body)
  })

  app.post('/api/nonce', jsonLimit, perIp(limiters.nonce), async (c) => {
    const body = (await readJson(c)) as Partial<NonceRequest> | null
    if (!body || !isId(body.placeId) || typeof body.traveller !== 'string') return reject(c, 'bad-request', 400)
    if (!identity.verify(body.traveller)) return reject(c, 'traveller-invalid', 401)
    const summary = getPlaceSummary(body.placeId)
    if (!summary) return reject(c, 'unknown-place', 422)
    if (summary.hidden && !(await hasPaidPass(body.traveller))) return reject(c, 'pass-required', 403)
    return c.json(await nonces.issue(body.traveller, body.placeId))
  })

  app.post('/api/checkin', jsonLimit, perIp(limiters.checkin), async (c) => {
    const body = (await readJson(c)) as Partial<CheckinRequest> | null
    if (
      !body ||
      typeof body.traveller !== 'string' ||
      !isId(body.placeId) ||
      !isId(body.nonce) ||
      !isNumber(body.lat) ||
      !isNumber(body.lng) ||
      !isNumber(body.accuracy) ||
      !isNumber(body.deviceTs)
    ) {
      return reject(c, 'bad-request', 400)
    }
    const traveller = body.traveller
    if (!identity.verify(traveller)) return reject(c, 'traveller-invalid', 401)
    const simulated = body.simulated === true
    if (simulated && !deps.allowSimulated) return reject(c, 'simulation-disabled', 403)

    const place = getPlace(body.placeId)
    if (!place) return reject(c, 'unknown-place', 422)
    if (place.hidden && !(await hasPaidPass(traveller))) return reject(c, 'pass-required', 403)

    const serverNow = now()
    if (!isWithinClockSkew(body.deviceTs, serverNow)) return reject(c, 'clock-skew', 422)

    const geofence = checkGeofence(place, body.lat, body.lng, body.accuracy)
    if (geofence.ok === false) return reject(c, geofence.reason, 422, geofence.distanceM)

    const fix: Fix = { lat: body.lat, lng: body.lng, at: serverNow }
    const nonceId = body.nonce
    // Burn the nonce last, so a rejected fix (for example low accuracy) can be retried within the window.
    const burnNonce = async () => {
      const nonce = await nonces.consume(nonceId, traveller, place.id)
      return nonce.ok === false ? reject(c, nonce.reason, nonce.reason === 'nonce-used' ? 409 : 422) : null
    }
    // Read before the nonce is burnt: a store failure here then leaves the nonce usable for a retry.
    const paymentSessionId = simulated ? undefined : await paidPassSession(traveller)
    if (simulated) {
      // A simulated visit is a demo: it skips the travel-speed check and never counts as a real fix.
      const refused = await burnNonce()
      if (refused) return refused
    } else {
      // Read the last fix, burn the nonce and record the new fix under the traveller's lock.
      const refused = await withCheckinLock(traveller, async () => {
        if (!isPlausibleTravel(await lastFix.get(traveller), fix)) return reject(c, 'too-fast', 422)
        if (!(await limiters.place.hit(place.id)).ok) return reject(c, 'place-busy', 429)
        const nonceRefused = await burnNonce()
        if (nonceRefused) return nonceRefused
        await lastFix.set(traveller, fix)
        return null
      })
      if (refused === LOCK_BUSY) return reject(c, 'rate-limited', 429)
      if (refused) return refused
    }

    // Receipts and preimages end up in shared stamp links, so they never carry the traveller id
    // (a bearer credential for this browser's pass), only a pseudonym of it.
    const pseudonym = identity.pseudonym(traveller)
    const proof: ProofPreimage = {
      traveller: pseudonym,
      placeId: place.id,
      nonce: body.nonce,
      lat: body.lat,
      lng: body.lng,
      accuracy: body.accuracy,
      deviceTs: body.deviceTs,
      serverTs: serverNow,
      simulated,
    }
    const receipt: CheckinReceipt = {
      traveller: pseudonym,
      placeId: place.id,
      distanceM: Math.round(geofence.distanceM),
      accuracy: Math.round(body.accuracy),
      checkedInAt: serverNow,
      simulated,
      proofHash: sha256Hex(canonicalJson(proof)),
    }

    const settled = simulated
      ? demoQueue.submit(receipt)
      : chainQueue.submit(receipt, { paymentSessionId, traveller })
    let timer: ReturnType<typeof setTimeout> | undefined
    const pending = new Promise<AttestationStatus>((resolve) => {
      timer = setTimeout(() => resolve({ status: 'pending' }), waitMs)
    })
    const attestation = await Promise.race([settled, pending])
    clearTimeout(timer)

    const response: CheckinResponse = {
      receipt,
      signature: deps.signer.sign(receipt),
      publicKey: deps.signer.publicKey,
      proof,
      attestation,
    }
    return c.json(response, attestation.status === 'pending' ? 202 : 200)
  })

  app.get('/api/attestation/:proofHash', perIp(limiters.read), async (c) => {
    const proofHash = c.req.param('proofHash')
    if (!/^[0-9a-f]{64}$/.test(proofHash)) return c.json({ error: 'bad-request' }, 400)
    const status = (await chainQueue.get(proofHash)) ?? (await demoQueue.get(proofHash))
    if (!status) return c.json({ error: 'not-found', message: 'No check-in with this proof hash on this server.' }, 404)
    return c.json(status)
  })

  app.post('/api/checkout', jsonLimit, perIp(limiters.checkout), async (c) => {
    const body = await readJson(c)
    const traveller = body?.traveller
    if (!identity.verify(traveller)) return reject(c, 'traveller-invalid', 401)
    const origin = redirectOrigin(c.req.header('origin'), deps.publicOrigin)

    if (!stripe) {
      const sessionId = `demo_${randomBytes(8).toString('hex')}`
      await recordPass({ sessionId, paid: true, demo: true, traveller, paidAt: now() })
      return c.json({ mode: 'demo' as const, sessionId, url: `${origin}/success?session_id=${sessionId}` })
    }

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: PHUKET_PASS.currency,
              unit_amount: PHUKET_PASS.amount,
              product_data: { name: PHUKET_PASS.name, description: PHUKET_PASS.description },
            },
          },
        ],
        client_reference_id: traveller,
        metadata: { product: PHUKET_PASS.id, creator: 'sukanya' },
        success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/cancel`,
      })
      if (!session.url) return c.json({ error: 'checkout-failed', message: 'Stripe returned no Checkout URL.' }, 502)
      return c.json({ mode: 'stripe' as const, sessionId: session.id, url: session.url })
    } catch (err) {
      console.error('[verapass] Stripe Checkout failed:', err instanceof Error ? err.message : err)
      return c.json({ error: 'checkout-failed', message: 'Could not start Stripe Checkout.' }, 502)
    }
  })

  app.post(
    '/api/webhook',
    bodyLimit({ maxSize: WEBHOOK_BODY_LIMIT, onError: (c) => c.json({ error: 'too-large' }, 413) }),
    async (c) => {
      if (!deps.stripeWebhookSecret) {
        return c.json({ error: 'webhook-not-configured', message: 'STRIPE_WEBHOOK_SECRET is not set.' }, 400)
      }
      const signature = c.req.header('stripe-signature')
      if (!signature) return c.json({ error: 'missing-signature' }, 400)
      const rawBody = await c.req.text()

      let event: Stripe.Event
      try {
        event = await Stripe.webhooks.constructEventAsync(rawBody, signature, deps.stripeWebhookSecret)
      } catch {
        return c.json({ error: 'invalid-signature' }, 400)
      }

      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const session = event.data.object
        // Idempotent per Checkout Session ID: Stripe may deliver the same event more than once.
        if (session.payment_status === 'paid' && !(await passes.get(session.id))?.paid) {
          await recordPass({
            sessionId: session.id,
            paid: true,
            demo: false,
            traveller: identity.verify(session.client_reference_id) ? session.client_reference_id : null,
            paidAt: now(),
          })
        }
      }
      return c.json({ received: true })
    },
  )

  /** Is this session paid, and does it belong to the asking traveller? The success page polls this. */
  app.get('/api/pass/:sessionId', perIp(limiters.pass), async (c) => {
    const sessionId = c.req.param('sessionId')
    const traveller = c.req.query('traveller')
    if (!isId(sessionId)) return c.json({ error: 'bad-request' }, 400)
    if (!identity.verify(traveller)) return reject(c, 'traveller-invalid', 401)
    const pass = (await passes.get(sessionId)) ?? (await lookupStripeSession(sessionId))
    if (!pass?.paid) return c.json({ sessionId, paid: false, demo: false })
    if (pass.traveller === null) {
      // Paid without a (valid) traveller id: the first traveller to open the success page claims it.
      await recordPass({ ...pass, traveller })
    } else if (pass.traveller !== traveller) {
      return c.json({ error: 'pass-not-yours', message: 'This pass was bought with another passport.' }, 403)
    }
    return c.json({ sessionId, paid: true, demo: pass.demo })
  })

  /** Names, locations and tips of the hidden places, for pass holders only. */
  app.get('/api/places/hidden', perIp(limiters.read), async (c) => {
    const traveller = c.req.query('traveller')
    if (!identity.verify(traveller)) return reject(c, 'traveller-invalid', 401)
    if (!(await hasPaidPass(traveller))) return reject(c, 'pass-required', 403)
    return c.json({ places: hiddenDetails() })
  })

  return app
}
