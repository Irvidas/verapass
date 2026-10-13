import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attestationEnvelope, canonicalJson } from '../../shared/checkin'
import { PLACE_SUMMARIES } from '../../shared/places'
import { verifyStamp } from '../../shared/verify'
import { MockAttestor } from '../../server/attestor'
import { createReceiptSigner, sha256Hex } from '../../server/receipts'
import { IMAGES } from '../../src/data/images'
import { ApiError } from '../../src/lib/api'
import { pollPendingAttestations, stampFromResponse } from '../../src/lib/checkin'
import { createPassportStore } from '../../src/lib/passport'
import { hiddenStore, placeName, resolvePlaces, syncPass } from '../../src/lib/places'
import { memoryStorage } from '../../src/lib/storage'
import { createTravellerSession } from '../../src/lib/traveller'
import { counts, toVerifiable, verdictOf } from '../../src/lib/verification'
import { carriesTravellerId, decodeStamp, encodeStamp, verifyLink } from '../../src/lib/verifyLink'
import { confirmed, stamp } from './fixtures'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  hiddenStore.set(null)
})

describe('traveller session', () => {
  it('asks the server for an id once, even when several calls need it at the same time', async () => {
    const store = createPassportStore(memoryStorage())
    const issue = vi.fn().mockResolvedValue('trav_1.sig')
    const session = createTravellerSession(store, issue)
    expect(await Promise.all([session.ensure(), session.ensure()])).toEqual(['trav_1.sig', 'trav_1.sig'])
    expect(issue).toHaveBeenCalledTimes(1)
    expect(store.getState().traveller).toBe('trav_1.sig')
  })

  it('renews a refused id and retries the call once', async () => {
    const store = createPassportStore(memoryStorage())
    store.setTraveller('trav_old.sig')
    const session = createTravellerSession(store, vi.fn().mockResolvedValue('trav_new.sig'))
    const call = vi.fn().mockRejectedValueOnce(new ApiError('no', 'traveller-invalid', 401)).mockResolvedValue('ok')
    expect(await session.withTraveller(call)).toBe('ok')
    expect(call.mock.calls.map((c) => c[0])).toEqual(['trav_old.sig', 'trav_new.sig'])
  })

  it('does not retry other errors', async () => {
    const store = createPassportStore(memoryStorage())
    store.setTraveller('trav_1.sig')
    const session = createTravellerSession(store, vi.fn())
    await expect(session.withTraveller(() => Promise.reject(new ApiError('far', 'too-far', 422)))).rejects.toThrow('far')
  })
})

describe('places in the browser', () => {
  it('knows public places and keeps hidden ones as teasers until the server sends them', () => {
    const locked = resolvePlaces(null)
    expect(locked.find((p) => p.id === 'wat-chalong')?.detail?.name).toBe('Wat Chalong')
    const reef = locked.find((p) => p.id === 'secret-reef')
    expect(reef?.detail).toBeNull()
    expect(reef && placeName(reef)).toBe('Hidden reef')
    const open = resolvePlaces({ 'secret-reef': { name: 'Secret reef', area: 'x', lat: 8, lng: 98, tip: 't' } })
    expect(open.find((p) => p.id === 'secret-reef')?.detail?.name).toBe('Secret reef')
  })

  it('a pass flag edited in storage unlocks nothing: the server is asked, and says no', async () => {
    const store = createPassportStore(memoryStorage())
    store.setTraveller('trav_1.sig')
    store.unlockPass('demo_forged', true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ sessionId: 'demo_forged', paid: false, demo: false })))
    const session = createTravellerSession(store, vi.fn())
    expect(await syncPass(store, session.withTraveller)).toBe(false)
    expect(store.getState().pass.unlocked).toBe(false)
    expect(hiddenStore.isUnlocked()).toBe(false)
  })

  it('loads the hidden places when the server confirms the pass', async () => {
    const store = createPassportStore(memoryStorage())
    store.setTraveller('trav_1.sig')
    store.unlockPass('demo_1', true)
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ sessionId: 'demo_1', paid: true, demo: true }))
      .mockResolvedValueOnce(jsonResponse({ places: { 'secret-reef': { name: 'Secret reef', area: 'x', lat: 8, lng: 98, tip: 't' } } }))
    vi.stubGlobal('fetch', fetch)
    const session = createTravellerSession(store, vi.fn())
    expect(await syncPass(store, session.withTraveller)).toBe(true)
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/pass/demo_1?traveller=trav_1.sig')
    expect(hiddenStore.isUnlocked()).toBe(true)
    expect(hiddenStore.getPlaces().find((p) => p.id === 'secret-reef')?.detail?.name).toBe('Secret reef')
  })

  it('locks again when the pass belongs to another passport', async () => {
    const store = createPassportStore(memoryStorage())
    store.setTraveller('trav_1.sig')
    store.unlockPass('demo_1', true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'pass-not-yours', message: 'no' }, 403)))
    expect(await syncPass(store, createTravellerSession(store, vi.fn()).withTraveller)).toBe(false)
    expect(store.getState().pass.sessionId).toBeNull()
  })
})

describe('stamps from the server', () => {
  it('keep the receipt, signature, key and proof preimage, so they verify later', async () => {
    const signer = createReceiptSigner()
    const proof = { traveller: 't', placeId: 'wat-chalong', nonce: 'n', lat: 7.85, lng: 98.34, accuracy: 9, deviceTs: 1, serverTs: 2, simulated: false }
    const receipt = { traveller: 't', placeId: 'wat-chalong', distanceM: 4, accuracy: 9, checkedInAt: 2, simulated: false, proofHash: sha256Hex(canonicalJson(proof)) }
    const record = await new MockAttestor().attest(receipt)
    const s = stampFromResponse({
      receipt,
      signature: signer.sign(receipt),
      publicKey: signer.publicKey,
      proof,
      attestation: { status: 'confirmed', record, signature: signer.sign(attestationEnvelope(receipt.proofHash, record)) },
    })
    const report = await verifyStamp(toVerifiable(s), signer.publicKey)
    expect(report.ok).toBe(true)
    expect(verdictOf(report)).toBe('verified')
    // A hand-edited copy in localStorage does not.
    const forged = await verifyStamp(toVerifiable({ ...s, receipt: { ...s.receipt, placeId: 'old-town' } }), signer.publicKey)
    expect(verdictOf(forged)).toBe('invalid')
  })

  it('count towards the passport unless they failed a check', () => {
    expect(counts('verified')).toBe(true)
    expect(counts('checking')).toBe(true)
    expect(counts('unsupported')).toBe(true)
    expect(counts('invalid')).toBe(false)
    expect(counts('other-key')).toBe(false)
  })

  it('travel in a link fragment and come back unchanged', () => {
    const v = toVerifiable(stamp('wat-chalong'))
    const encoded = encodeStamp(v)
    expect(encoded).toMatch(/^[\w-]+$/)
    expect(decodeStamp(encoded)).toEqual(v)
  })

  it('get a share link only when they carry the pseudonym, never an older raw traveller id', () => {
    const pseudonymous = stamp('wat-chalong')
    const anon = `anon_${'0f'.repeat(16)}`
    const current = { ...pseudonymous, receipt: { ...pseudonymous.receipt, traveller: anon }, proof: { ...pseudonymous.proof, traveller: anon } }
    const link = verifyLink(current)
    expect(link).toMatch(/^\/verify#stamp=[\w-]+$/)
    expect(carriesTravellerId(current)).toBe(false)

    // A stamp from before 2026-10-10: the signed receipt holds the id, a bearer credential for the pass.
    const id = `trav_${'1a'.repeat(8)}.${'A'.repeat(22)}`
    const legacy = { ...current, receipt: { ...current.receipt, traveller: id }, proof: { ...current.proof, traveller: id } }
    expect(carriesTravellerId(legacy)).toBe(true)
    expect(verifyLink(legacy)).toBeNull()
    // Even when only the preimage still holds it.
    expect(verifyLink({ ...current, proof: { ...current.proof, traveller: id } })).toBeNull()
  })
})

describe('pollPendingAttestations', () => {
  it('asks for pending records until they settle, then stops', async () => {
    const store = createPassportStore(memoryStorage())
    const s = stamp('wat-chalong', 1, { status: 'pending' })
    store.collect(s)
    const fetchStatus = vi.fn().mockResolvedValueOnce({ status: 'pending' }).mockResolvedValueOnce(confirmed)
    const stop = pollPendingAttestations(store, { intervalMs: 1, fetchStatus })
    await vi.waitFor(() => expect(store.getState().stamps[0]?.attestation).toEqual(confirmed))
    expect(fetchStatus).toHaveBeenCalledTimes(2)
    expect(fetchStatus).toHaveBeenCalledWith(s.proofHash)
    stop()
  })

  it('starts again when a new pending stamp arrives', async () => {
    const store = createPassportStore(memoryStorage())
    const fetchStatus = vi.fn().mockResolvedValue(confirmed)
    const stop = pollPendingAttestations(store, { intervalMs: 1, fetchStatus })
    store.collect(stamp('old-town', 1, { status: 'pending' }))
    await vi.waitFor(() => expect(store.getState().stamps[0]?.attestation.status).toBe('confirmed'))
    stop()
  })
})

describe('optimised images', () => {
  it('has AVIF and WebP files for every width in the manifest, and every place photo is in it', () => {
    for (const [name, info] of Object.entries(IMAGES)) {
      for (const w of info.widths) {
        for (const ext of ['avif', 'webp']) expect(existsSync(`public/images/r/${name}-${w}.${ext}`), `${name}-${w}.${ext}`).toBe(true)
      }
    }
    for (const p of PLACE_SUMMARIES.filter((x) => x.image)) {
      expect(IMAGES[p.image?.replace('/images/', '').replace('.jpg', '') ?? ''], p.id).toBeDefined()
    }
  })
})
