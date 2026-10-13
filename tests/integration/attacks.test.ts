import { describe, expect, it, vi } from 'vitest'
import type { Attestation, CheckinReceipt } from '../../shared/checkin'
import { MockAttestor, type Attestor } from '../../server/attestor'
import { allPlaces, getPlace } from '../../server/places'
import { BACKENDS } from '../support/backends'
import { checkin, deferred, newTraveller, nonceFor, setup, visit } from './helpers'

/**
 * The attack cases from grant milestone 2.3, with what the server answers today, once per
 * state backend (in memory and the Redis REST store).
 * A case that is not defended yet is written as `it.fails`, so the gap stays visible
 * in every test run until it is closed.
 */
const promthep = getPlace('promthep-cape')
const khaoSok = getPlace('khao-sok-lake')
const watChalong = getPlace('wat-chalong')
if (!promthep || !khaoSok || !watChalong) throw new Error('fixture places missing')

describe.each(BACKENDS)('attacks on check-in ($name state)', ({ make }) => {
  it('spoofed coordinates far from the place are refused', async () => {
    const ctx = setup({}, make)
    const traveller = await newTraveller(ctx)
    const r = await visit(ctx, traveller, watChalong, { lat: 13.7563, lng: 100.5018 })
    expect(r.status).toBe(422)
    expect(r.body.error).toBe('too-far')
  })

  it('a replayed check-in is refused', async () => {
    const ctx = setup({}, make)
    const traveller = await newTraveller(ctx)
    const { nonce } = await nonceFor(ctx, traveller, watChalong.id)
    const body = { traveller, placeId: watChalong.id, nonce, deviceTs: ctx.now(), lat: watChalong.lat, lng: watChalong.lng, accuracy: 10 }
    expect((await checkin(ctx, body)).status).toBe(200)
    expect((await checkin(ctx, body)).status).toBe(409)
  })

  it('made-up traveller ids are refused, so the velocity check cannot be dodged by inventing ids', async () => {
    const ctx = setup({}, make)
    const r = await ctx.post('/api/nonce', { traveller: 'trav_x2', placeId: khaoSok.id })
    expect(r.status).toBe(401)
  })

  it('rotating traveller ids is rate limited', async () => {
    const ctx = setup({ limits: { travellerPerHour: 5 } }, make)
    for (let i = 0; i < 5; i++) await newTraveller(ctx)
    const blocked = await ctx.post('/api/traveller', {})
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/)
    // Another connection is not affected.
    expect((await ctx.post('/api/traveller', {}, {}, '198.51.100.7')).status).toBe(200)
  })

  it('a made-up first X-Forwarded-For entry does not buy a fresh per-IP budget', async () => {
    const ctx = setup({ limits: { travellerPerHour: 2 } }, make)
    // Behind a proxy that appends (a Cloudflare tunnel) the client controls everything before the
    // last entry; the last one is the address the proxy saw.
    const forged = (i: number) => ({ 'x-forwarded-for': `10.0.0.${i}, 203.0.113.50` })
    expect((await ctx.post('/api/traveller', {}, forged(1))).status).toBe(200)
    expect((await ctx.post('/api/traveller', {}, forged(2))).status).toBe(200)
    expect((await ctx.post('/api/traveller', {}, forged(3))).status).toBe(429)
  })

  it('check-ins from one connection are rate limited, whatever traveller ids it uses', async () => {
    const ctx = setup({ limits: { apiPerMinute: 4 } }, make)
    const travellers = await Promise.all(Array.from({ length: 3 }, () => newTraveller(ctx)))
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const res = await ctx.post('/api/nonce', { traveller: travellers[i % 3], placeId: watChalong.id })
      statuses.push(res.status)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 429, 429])
    ctx.advance(2 * 60_000)
    expect((await ctx.post('/api/nonce', { traveller: travellers[0], placeId: watChalong.id })).status).toBe(200)
  })

  it('a burst of real check-ins at one place is capped across all travellers', async () => {
    const ctx = setup({ limits: { placePerMinute: 2 } }, make)
    const results: number[] = []
    for (let i = 0; i < 3; i++) {
      const ip = `198.51.100.${i + 1}`
      results.push((await visit(ctx, await newTraveller(ctx, ip), watChalong, {}, ip)).status)
    }
    expect(results).toEqual([200, 200, 429])
  })

  it('two check-ins sent at the same moment cannot both pass the speed check', async () => {
    const gate = deferred<undefined>()
    const slow: Attestor = {
      mode: 'testnet',
      attest: async (receipt: CheckinReceipt): Promise<Attestation> => {
        await gate.promise
        return new MockAttestor().attest(receipt)
      },
    }
    const ctx = setup({ attestor: slow, attestationWaitMs: 50 }, make)
    const traveller = await newTraveller(ctx)
    const a = await nonceFor(ctx, traveller, promthep.id)
    const b = await nonceFor(ctx, traveller, khaoSok.id)
    const [ra, rb] = await Promise.all([
      checkin(ctx, { traveller, placeId: promthep.id, nonce: a.nonce, deviceTs: ctx.now(), lat: promthep.lat, lng: promthep.lng, accuracy: 10 }),
      checkin(ctx, { traveller, placeId: khaoSok.id, nonce: b.nonce, deviceTs: ctx.now(), lat: khaoSok.lat, lng: khaoSok.lng, accuracy: 10 }),
    ])
    gate.resolve(undefined)
    expect([ra.status, rb.status].sort()).toEqual([202, 422])
    expect([ra.body.error, rb.body.error]).toContain('too-fast')
  })

  it('hidden places cannot be collected without a paid pass', async () => {
    const ctx = setup({ allowSimulated: false }, make)
    const traveller = await newTraveller(ctx)
    for (const place of allPlaces().filter((p) => p.hidden)) {
      const res = await ctx.post('/api/nonce', { traveller, placeId: place.id })
      expect(res.status, place.id).toBe(403)
    }
  })

  it('simulated check-ins never reach the real attestor', async () => {
    const attest = vi.fn<Attestor['attest']>()
    const ctx = setup({ attestor: { mode: 'testnet', attest } }, make)
    const r = await visit(ctx, await newTraveller(ctx), watChalong, { simulated: true })
    expect(r.status).toBe(200)
    expect(r.body.receipt.simulated).toBe(true)
    if (r.body.attestation.status !== 'confirmed') throw new Error('expected a confirmed mock record')
    expect(r.body.attestation.record.mode).toBe('mock')
    expect(attest).not.toHaveBeenCalled()
  })

  it('a shared stamp link does not hand over the traveller\'s session or paid pass', async () => {
    const ctx = setup({}, make)
    const traveller = await newTraveller(ctx)
    expect((await ctx.post('/api/checkout', { traveller })).status).toBe(200)
    const hidden = allPlaces().find((p) => p.hidden)
    if (!hidden) throw new Error('fixture: no hidden place')
    const r = await visit(ctx, traveller, hidden)
    expect(r.status).toBe(200)
    // Everything a stamp link carries: receipt, signature, key, preimage and on-chain record.
    const shared = JSON.stringify({ receipt: r.body.receipt, signature: r.body.signature, publicKey: r.body.publicKey, proof: r.body.proof, attestation: r.body.attestation })
    expect(shared).not.toContain(traveller)
    expect(shared).not.toContain(traveller.split('.')[0])
    // The pseudonym in the receipt is refused wherever a traveller id is expected.
    const pseudonym = r.body.receipt.traveller
    expect(pseudonym).toMatch(/^anon_[0-9a-f]{32}$/)
    expect((await ctx.get(`/api/places/hidden?traveller=${encodeURIComponent(pseudonym)}`)).status).toBe(401)
    expect((await ctx.post('/api/nonce', { traveller: pseudonym, placeId: hidden.id })).status).toBe(401)
    // The real id still works for its owner.
    expect((await ctx.get(`/api/places/hidden?traveller=${encodeURIComponent(traveller)}`)).status).toBe(200)
  })

  // Not defended yet: browser GPS is asserted by the client. A script that sends the place's own
  // coordinates collects it, one place per allowed travel time. Rotating on-site QR codes and
  // wallet-signed check-ins (milestone 2.3) are the planned defence.
  it.fails('a script that sends each place its own coordinates is refused (needs on-site QR codes)', async () => {
    const ctx = setup({ allowSimulated: false }, make)
    const traveller = await newTraveller(ctx)
    const r = await visit(ctx, traveller, watChalong, { lat: watChalong.lat, lng: watChalong.lng, accuracy: 5 })
    expect(r.status).not.toBe(200)
  })

  // Not defended yet: anyone can ask for a new traveller id (within the per-IP limit) and a
  // fresh id has no previous fix, so many connections (a botnet) can still spread the work.
  it.fails('a fresh traveller id per place, from different connections, is refused (needs wallet-signed check-ins)', async () => {
    const ctx = setup({ allowSimulated: false }, make)
    const first = await visit(ctx, await newTraveller(ctx, '198.51.100.1'), promthep, {}, '198.51.100.1')
    const second = await visit(ctx, await newTraveller(ctx, '198.51.100.2'), khaoSok, {}, '198.51.100.2')
    expect(first.status).toBe(200)
    expect(second.status).not.toBe(200)
  })
})
