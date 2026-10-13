import Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attestationEnvelope, canonicalJson } from '../../shared/checkin'
import { PHUKET_PASS } from '../../shared/pricing'
import { redirectOrigin, type AppDeps } from '../../server/app'
import { type Attestor } from '../../server/attestor'
import { NONCE_TTL_MS } from '../../server/nonce'
import { getPlace } from '../../server/places'
import { sha256Hex } from '../../server/receipts'
import { at, checkin, deferred, newTraveller, nonceFor, setup, visit, WEBHOOK_SECRET, type Ctx } from './helpers'

const watChalong = getPlace('wat-chalong')
const khaoSok = getPlace('khao-sok-lake')
if (!watChalong || !khaoSok) throw new Error('fixture places missing')

function stripeWith(checkout: Record<string, unknown>): AppDeps['stripe'] {
  return { checkout: { sessions: checkout } } as unknown as AppDeps['stripe']
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/health', () => {
  it('reports demo payments and mock attestation when nothing is configured', async () => {
    const ctx = setup()
    const res = await ctx.get('/api/health')
    expect(await res.json()).toMatchObject({ ok: true, payments: 'demo', attestation: 'mock', simulation: true, receiptPublicKey: ctx.signer.publicKey })
  })

  it('sends security headers', async () => {
    const res = await setup().get('/api/health')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })
})

describe('POST /api/traveller', () => {
  it('issues signed traveller ids that the other routes accept', async () => {
    const ctx = setup()
    const a = await newTraveller(ctx)
    const b = await newTraveller(ctx)
    expect(a).toMatch(/^trav_[0-9a-f]{16}\.[\w-]{22}$/)
    expect(a).not.toBe(b)
    await nonceFor(ctx, a, watChalong.id)
  })

  it('refuses ids it did not issue, and ids signed with another secret', async () => {
    const ctx = setup()
    const other = setup({ travellerSecret: 'a-completely-different-secret' })
    const foreign = await newTraveller(other)
    for (const traveller of ['trav_a', 'trav_0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAA', foreign]) {
      const res = await ctx.post('/api/nonce', { traveller, placeId: watChalong.id })
      expect(res.status, traveller).toBe(401)
      expect(await res.json()).toMatchObject({ error: 'traveller-invalid' })
    }
  })
})

describe('POST /api/checkout', () => {
  it('returns a demo-mode session when no Stripe key is set, and the pass reads as paid for its buyer', async () => {
    const ctx = setup()
    const traveller = await newTraveller(ctx)
    const res = await ctx.post('/api/checkout', { traveller }, { origin: 'http://localhost:4173' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { mode: string; sessionId: string; url: string }
    expect(body.mode).toBe('demo')
    expect(body.sessionId).toMatch(/^demo_[0-9a-f]{16}$/)
    expect(body.url).toBe(`http://localhost:4173/success?session_id=${body.sessionId}`)

    const pass = await ctx.get(`/api/pass/${body.sessionId}?traveller=${traveller}`)
    expect(await pass.json()).toEqual({ sessionId: body.sessionId, paid: true, demo: true })
  })

  it('needs a valid traveller id, so a pass is always bound to someone', async () => {
    const ctx = setup()
    expect((await ctx.post('/api/checkout', {})).status).toBe(401)
    expect((await ctx.post('/api/checkout', { traveller: 'trav_made_up' })).status).toBe(401)
  })

  it('creates a Stripe Checkout Session in payment mode with inline price_data when Stripe is configured', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' })
    const ctx = setup({ stripeSecretKey: 'sk_test_x', stripe: stripeWith({ create }) })
    const traveller = await newTraveller(ctx)
    const res = await ctx.post('/api/checkout', { traveller }, { origin: 'http://localhost:5173' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mode: 'stripe', sessionId: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      mode: 'payment',
      client_reference_id: traveller,
      success_url: 'http://localhost:5173/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'http://localhost:5173/cancel',
      line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: PHUKET_PASS.amount, product_data: { name: PHUKET_PASS.name } } }],
    })
  })

  it('answers 502 and logs when Stripe fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const create = vi.fn().mockRejectedValue(new Error('boom'))
    const ctx = setup({ stripeSecretKey: 'sk_test_x', stripe: stripeWith({ create }) })
    const res = await ctx.post('/api/checkout', { traveller: await newTraveller(ctx) })
    expect(res.status).toBe(502)
    expect(error).toHaveBeenCalledWith('[verapass] Stripe Checkout failed:', 'boom')
  })

  it('refuses live Stripe keys', () => {
    expect(() => setup({ stripeSecretKey: 'sk_live_nope' })).toThrow(/test mode only/)
  })

  it('only redirects back to the configured origin or localhost', () => {
    expect(redirectOrigin('https://evil.example', 'https://verapass.app/')).toBe('https://verapass.app')
    expect(redirectOrigin('http://localhost:4173', 'https://verapass.app')).toBe('http://localhost:4173')
    expect(redirectOrigin(undefined, 'https://verapass.app')).toBe('https://verapass.app')
  })
})

describe('POST /api/nonce', () => {
  it('rejects bad input and unknown places', async () => {
    const ctx = setup()
    const traveller = await newTraveller(ctx)
    expect((await ctx.post('/api/nonce', { traveller: 'a b', placeId: 'wat-chalong' })).status).toBe(401)
    expect((await ctx.post('/api/nonce', 'not json')).status).toBe(400)
    expect((await ctx.post('/api/nonce', { traveller, placeId: 'atlantis' })).status).toBe(422)
  })

  it('refuses bodies over the size limit before parsing them', async () => {
    const ctx = setup()
    const res = await ctx.post('/api/nonce', { traveller: 'x'.repeat(20_000), placeId: 'wat-chalong' })
    expect(res.status).toBe(413)
  })
})

describe('POST /api/checkin', () => {
  it('accepts a real fix inside the geofence and returns a verifiable signed receipt with its proof preimage', async () => {
    const ctx = setup()
    const traveller = await newTraveller(ctx)
    const { status, body } = await visit(ctx, traveller, watChalong)
    expect(status).toBe(200)
    // Receipts carry a pseudonym of the traveller id, never the id (a bearer credential).
    expect(body.receipt.traveller).toMatch(/^anon_[0-9a-f]{32}$/)
    expect(body.receipt).toMatchObject({ placeId: 'wat-chalong', simulated: false, accuracy: 15, checkedInAt: ctx.now() })
    expect(body.receipt.distanceM).toBeLessThan(20)
    expect(body.receipt.proofHash).toBe(sha256Hex(canonicalJson(body.proof)))
    expect(body.proof).toMatchObject({ traveller: body.receipt.traveller, placeId: 'wat-chalong', serverTs: ctx.now(), simulated: false })
    expect(body.publicKey).toBe(ctx.signer.publicKey)
    expect(ctx.signer.verify(body.receipt, body.signature)).toBe(true)
    expect(body.attestation.status).toBe('confirmed')
    if (body.attestation.status !== 'confirmed') return
    expect(body.attestation.record.mode).toBe('mock')
    // The tx record is signed together with the proof hash, so the link cannot be swapped.
    expect(ctx.signer.verify(attestationEnvelope(body.receipt.proofHash, body.attestation.record), body.attestation.signature)).toBe(true)
    expect(ctx.signer.verify(attestationEnvelope(body.receipt.proofHash, { ...body.attestation.record, txHash: 'ff'.repeat(32) }), body.attestation.signature)).toBe(false)
  })

  it('accepts a simulated visit and marks the receipt as simulated', async () => {
    const ctx = setup()
    const { status, body } = await visit(ctx, await newTraveller(ctx), watChalong, { simulated: true })
    expect(status).toBe(200)
    expect(body.receipt.simulated).toBe(true)
  })

  it('rejects a fix far from the place with the distance, and the nonce can still be used', async () => {
    const ctx = setup()
    const traveller = await newTraveller(ctx)
    const { nonce } = await nonceFor(ctx, traveller, watChalong.id)
    const far = await checkin(ctx, { traveller, placeId: watChalong.id, nonce, deviceTs: ctx.now(), lat: 7.8961, lng: 98.296, accuracy: 10 })
    expect(far.status).toBe(422)
    expect(far.body.error).toBe('too-far')
    expect(far.body.distanceM).toBeGreaterThan(5000)

    const ok = await checkin(ctx, { traveller, placeId: watChalong.id, nonce, deviceTs: ctx.now(), ...at(watChalong) })
    expect(ok.status).toBe(200)
  })

  it('rejects a rough GPS fix', async () => {
    const ctx = setup()
    const r = await visit(ctx, await newTraveller(ctx), watChalong, { accuracy: 500 })
    expect(r.status).toBe(422)
    expect(r.body.error).toBe('low-accuracy')
  })

  it('rejects a replayed nonce', async () => {
    const ctx = setup()
    const traveller = await newTraveller(ctx)
    const { nonce } = await nonceFor(ctx, traveller, watChalong.id)
    const body = { traveller, placeId: watChalong.id, nonce, deviceTs: ctx.now(), ...at(watChalong) }
    expect((await checkin(ctx, body)).status).toBe(200)
    const replay = await checkin(ctx, body)
    expect(replay.status).toBe(409)
    expect(replay.body.error).toBe('nonce-used')
  })

  it('rejects an unknown, expired or mismatched nonce', async () => {
    const ctx = setup()
    const a = await newTraveller(ctx)
    const b = await newTraveller(ctx)
    const unknown = await checkin(ctx, { traveller: a, placeId: watChalong.id, nonce: 'feedface', deviceTs: ctx.now(), ...at(watChalong) })
    expect(unknown.body.error).toBe('nonce-unknown')

    const other = await nonceFor(ctx, b, watChalong.id)
    const mismatch = await checkin(ctx, { traveller: a, placeId: watChalong.id, nonce: other.nonce, deviceTs: ctx.now(), ...at(watChalong) })
    expect(mismatch.body.error).toBe('nonce-mismatch')

    const { nonce } = await nonceFor(ctx, a, watChalong.id)
    ctx.advance(NONCE_TTL_MS + 1)
    const expired = await checkin(ctx, { traveller: a, placeId: watChalong.id, nonce, deviceTs: ctx.now(), ...at(watChalong) })
    expect(expired.status).toBe(422)
    expect(expired.body.error).toBe('nonce-expired')
  })

  it('rejects a device clock far from the server clock', async () => {
    const ctx = setup()
    const r = await visit(ctx, await newTraveller(ctx), watChalong, { deviceTs: ctx.now() - 10 * 60_000 })
    expect(r.body.error).toBe('clock-skew')
  })

  it('rejects an impossible trip between two real check-ins', async () => {
    const ctx = setup()
    const traveller = await newTraveller(ctx)
    expect((await visit(ctx, traveller, watChalong)).status).toBe(200)
    ctx.advance(5 * 60_000)
    const r = await visit(ctx, traveller, khaoSok)
    expect(r.status).toBe(422)
    expect(r.body.error).toBe('too-fast')
  })

  it('does not count a simulated visit as a real fix for the speed check', async () => {
    const ctx = setup()
    const traveller = await newTraveller(ctx)
    expect((await visit(ctx, traveller, watChalong, { simulated: true })).status).toBe(200)
    ctx.advance(60_000)
    expect((await visit(ctx, traveller, khaoSok)).status).toBe(200)
  })

  it('rejects missing fields, unknown places and disabled simulation', async () => {
    const ctx = setup({ allowSimulated: false })
    const traveller = await newTraveller(ctx)
    expect((await checkin(ctx, { traveller, placeId: watChalong.id })).body.error).toBe('bad-request')
    expect((await checkin(ctx, { traveller, placeId: 'atlantis', nonce: 'aa', deviceTs: ctx.now(), lat: 0, lng: 0, accuracy: 5 })).body.error).toBe('unknown-place')
    const sim = await visit(ctx, traveller, watChalong, { simulated: true })
    expect(sim.status).toBe(403)
    expect(sim.body.error).toBe('simulation-disabled')
  })

  it('accepts the check-in when Stellar fails, reports the failed record, and the nonce stays burnt', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failing: Attestor = { mode: 'testnet', attest: () => Promise.reject(new Error('rpc down')) }
    const ctx = setup({ attestor: failing, attestationRetries: 1 })
    const traveller = await newTraveller(ctx)
    const { nonce } = await nonceFor(ctx, traveller, watChalong.id)
    const body = { traveller, placeId: watChalong.id, nonce, deviceTs: ctx.now(), ...at(watChalong) }
    const r = await checkin(ctx, body)
    expect(r.status).toBe(200)
    expect(r.body.attestation).toMatchObject({ status: 'failed' })
    expect(ctx.signer.verify(r.body.receipt, r.body.signature)).toBe(true)
    expect(error).toHaveBeenCalledWith('[verapass] attestation failed:', 'rpc down')
    const retry = await checkin(ctx, body)
    expect(retry.status).toBe(409)
    expect(retry.body.error).toBe('nonce-used')
  })

  it('answers 202 with a pending record when Stellar is slow, then the status endpoint reports it confirmed', async () => {
    const gate = deferred<undefined>()
    const slow: Attestor = {
      mode: 'testnet',
      attest: async (receipt) => {
        await gate.promise
        return { mode: 'testnet', network: 'stellar-testnet', id: 'abc', txHash: 'ab'.repeat(32), explorerUrl: `https://stellar.expert/explorer/testnet/tx/${receipt.proofHash}` }
      },
    }
    const ctx = setup({ attestor: slow, attestationWaitMs: 20 })
    const r = await visit(ctx, await newTraveller(ctx), watChalong)
    expect(r.status).toBe(202)
    expect(r.body.attestation).toEqual({ status: 'pending' })
    const hash = r.body.receipt.proofHash
    expect(await (await ctx.get(`/api/attestation/${hash}`)).json()).toEqual({ status: 'pending' })
    gate.resolve(undefined)
    await vi.waitFor(async () => {
      expect(await (await ctx.get(`/api/attestation/${hash}`)).json()).toMatchObject({ status: 'confirmed', record: { id: 'abc' } })
    })
    expect((await ctx.get(`/api/attestation/${'0'.repeat(64)}`)).status).toBe(404)
    expect((await ctx.get('/api/attestation/nope')).status).toBe(400)
  })
})

describe('POST /api/webhook', () => {
  function event(sessionId: string, opts: { paymentStatus?: string; type?: string; traveller?: string | null } = {}) {
    return JSON.stringify({
      id: 'evt_test_1',
      object: 'event',
      type: opts.type ?? 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          object: 'checkout.session',
          payment_status: opts.paymentStatus ?? 'paid',
          client_reference_id: opts.traveller === undefined ? null : opts.traveller,
        },
      },
    })
  }

  async function signedPost(ctx: Ctx, payload: string) {
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
    return ctx.post('/api/webhook', payload, { 'stripe-signature': header })
  }

  it('answers 400 when no webhook secret is configured', async () => {
    const ctx = setup()
    const res = await ctx.post('/api/webhook', event('cs_test_1'), { 'stripe-signature': 't=1,v1=abc' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'webhook-not-configured' })
  })

  it('rejects a request without a signature header', async () => {
    const ctx = setup({ stripeWebhookSecret: WEBHOOK_SECRET })
    const res = await ctx.post('/api/webhook', event('cs_test_1'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'missing-signature' })
  })

  it('rejects a forged signature and does not mark the pass as paid', async () => {
    const ctx = setup({ stripeWebhookSecret: WEBHOOK_SECRET })
    const traveller = await newTraveller(ctx)
    const payload = event('cs_test_forged', { traveller })
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_wrong_secret' })
    const res = await ctx.post('/api/webhook', payload, { 'stripe-signature': header })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid-signature' })
    expect(await (await ctx.get(`/api/pass/cs_test_forged?traveller=${traveller}`)).json()).toMatchObject({ paid: false })
  })

  it('rejects a body that was changed after signing', async () => {
    const ctx = setup({ stripeWebhookSecret: WEBHOOK_SECRET })
    const header = Stripe.webhooks.generateTestHeaderString({ payload: event('cs_test_a'), secret: WEBHOOK_SECRET })
    const res = await ctx.post('/api/webhook', event('cs_test_b'), { 'stripe-signature': header })
    expect(res.status).toBe(400)
  })

  it('marks the pass as paid on a validly signed checkout.session.completed, idempotently', async () => {
    const ctx = setup({ stripeWebhookSecret: WEBHOOK_SECRET })
    const traveller = await newTraveller(ctx)
    const payload = event('cs_test_ok', { traveller })
    for (let i = 0; i < 2; i++) {
      const res = await signedPost(ctx, payload)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ received: true })
    }
    expect(await (await ctx.get(`/api/pass/cs_test_ok?traveller=${traveller}`)).json()).toEqual({ sessionId: 'cs_test_ok', paid: true, demo: false })
  })

  it('marks the pass as paid on checkout.session.async_payment_succeeded', async () => {
    const ctx = setup({ stripeWebhookSecret: WEBHOOK_SECRET })
    const traveller = await newTraveller(ctx)
    expect((await signedPost(ctx, event('cs_test_async', { type: 'checkout.session.async_payment_succeeded', traveller }))).status).toBe(200)
    expect(await (await ctx.get(`/api/pass/cs_test_async?traveller=${traveller}`)).json()).toMatchObject({ paid: true })
  })

  it('does not mark the pass as paid while the payment is still pending', async () => {
    const ctx = setup({ stripeWebhookSecret: WEBHOOK_SECRET })
    const traveller = await newTraveller(ctx)
    expect((await signedPost(ctx, event('cs_test_pending', { paymentStatus: 'unpaid', traveller }))).status).toBe(200)
    expect(await (await ctx.get(`/api/pass/cs_test_pending?traveller=${traveller}`)).json()).toMatchObject({ paid: false })
  })

  it('refuses webhook bodies over 64 KB', async () => {
    const ctx = setup({ stripeWebhookSecret: WEBHOOK_SECRET })
    const res = await ctx.post('/api/webhook', 'x'.repeat(70_000), { 'stripe-signature': 't=1,v1=abc' })
    expect(res.status).toBe(413)
  })
})

describe('GET /api/pass/:sessionId', () => {
  it('rejects malformed ids, unknown travellers, and reports unknown sessions as unpaid', async () => {
    const ctx = setup()
    const traveller = await newTraveller(ctx)
    expect((await ctx.get(`/api/pass/bad%20id?traveller=${traveller}`)).status).toBe(400)
    expect((await ctx.get('/api/pass/cs_test_unknown')).status).toBe(401)
    expect(await (await ctx.get(`/api/pass/cs_test_unknown?traveller=${traveller}`)).json()).toEqual({ sessionId: 'cs_test_unknown', paid: false, demo: false })
  })

  it('does not unlock a pass for someone who only has the success link', async () => {
    const ctx = setup()
    const buyer = await newTraveller(ctx)
    const friend = await newTraveller(ctx)
    const { sessionId } = (await (await ctx.post('/api/checkout', { traveller: buyer })).json()) as { sessionId: string }
    const res = await ctx.get(`/api/pass/${sessionId}?traveller=${friend}`)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'pass-not-yours' })
  })

  it('falls back to Stripe when the webhook never arrived, and binds the pass to the buyer', async () => {
    const ctx0 = setup()
    const traveller = await newTraveller(ctx0)
    const retrieve = vi.fn().mockResolvedValue({ id: 'cs_test_missed', payment_status: 'paid', client_reference_id: traveller })
    const ctx = setup({ stripeSecretKey: 'sk_test_x', stripe: stripeWith({ retrieve }) })
    expect(await (await ctx.get(`/api/pass/cs_test_missed?traveller=${traveller}`)).json()).toEqual({ sessionId: 'cs_test_missed', paid: true, demo: false })
    expect(retrieve).toHaveBeenCalledWith('cs_test_missed')
    // Now cached: no second Stripe call, and hidden places open for this traveller.
    expect(await (await ctx.get(`/api/pass/cs_test_missed?traveller=${traveller}`)).json()).toMatchObject({ paid: true })
    expect(retrieve).toHaveBeenCalledTimes(1)
    expect((await ctx.get(`/api/places/hidden?traveller=${traveller}`)).status).toBe(200)
  })

  it('reports unpaid when Stripe says the session is not paid or the lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const retrieve = vi.fn().mockResolvedValueOnce({ payment_status: 'unpaid' }).mockRejectedValueOnce(new Error('stripe down'))
    const ctx = setup({ stripeSecretKey: 'sk_test_x', stripe: stripeWith({ retrieve }) })
    const traveller = await newTraveller(ctx)
    expect(await (await ctx.get(`/api/pass/cs_test_x?traveller=${traveller}`)).json()).toMatchObject({ paid: false })
    expect(await (await ctx.get(`/api/pass/cs_test_x?traveller=${traveller}`)).json()).toMatchObject({ paid: false })
    expect(error).toHaveBeenCalledWith('[verapass] Checkout Session lookup failed:', 'stripe down')
  })
})

describe('hidden places', () => {
  it('hands out hidden place details only to a traveller with a paid pass', async () => {
    const ctx = setup()
    const traveller = await newTraveller(ctx)
    const locked = await ctx.get(`/api/places/hidden?traveller=${traveller}`)
    expect(locked.status).toBe(403)
    expect(await locked.json()).toMatchObject({ error: 'pass-required' })

    await ctx.post('/api/checkout', { traveller })
    const open = await ctx.get(`/api/places/hidden?traveller=${traveller}`)
    expect(open.status).toBe(200)
    const { places } = (await open.json()) as { places: Record<string, { name: string; lat: number }> }
    expect(Object.keys(places).sort()).toEqual(['empty-beach', 'quiet-snorkel-bay', 'secret-reef'])
    expect(places['secret-reef']?.name).toBe('Secret reef')
  })

  it('refuses a nonce for a hidden place without a pass, and allows it with one', async () => {
    const ctx = setup()
    const traveller = await newTraveller(ctx)
    const res = await ctx.post('/api/nonce', { traveller, placeId: 'secret-reef' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'pass-required' })
    await ctx.post('/api/checkout', { traveller })
    const reef = getPlace('secret-reef')
    if (!reef) throw new Error('reef missing')
    expect((await visit(ctx, traveller, reef)).status).toBe(200)
  })
})
