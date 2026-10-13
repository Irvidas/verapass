import { describe, expect, it, vi } from 'vitest'
import { PLACE_COUNT } from '../../shared/places'
import { addStamp, createPassportStore, emptyPassport, isStamp, parsePassport, PASSPORT_KEY, progress } from '../../src/lib/passport'
import { memoryStorage, type KVStorage } from '../../src/lib/storage'
import { confirmed, stamp } from './fixtures'

describe('isStamp', () => {
  it('accepts a full stamp and rejects one without its signature or proof', () => {
    expect(isStamp(stamp('wat-chalong'))).toBe(true)
    const noSig: Record<string, unknown> = { ...stamp('wat-chalong') }
    delete noSig.signature
    expect(isStamp(noSig)).toBe(false)
    expect(isStamp({ ...stamp('wat-chalong'), proof: { lat: 1 } })).toBe(false)
  })

  it('rejects a stamp whose receipt is for another place or proof hash', () => {
    const s = stamp('wat-chalong')
    expect(isStamp({ ...s, receipt: { ...s.receipt, placeId: 'old-town' } })).toBe(false)
    expect(isStamp({ ...s, proofHash: 'ff'.repeat(32) })).toBe(false)
  })

  it('accepts every attestation status, and rejects unknown ones', () => {
    expect(isStamp(stamp('wat-chalong', 1, { status: 'pending' }))).toBe(true)
    expect(isStamp(stamp('wat-chalong', 1, { status: 'failed', message: 'x' }))).toBe(true)
    expect(isStamp({ ...stamp('wat-chalong'), attestation: { status: 'confirmed' } })).toBe(false)
  })
})

describe('parsePassport', () => {
  it('returns an empty passport for missing, broken or older-version data', () => {
    expect(parsePassport(null)).toEqual(emptyPassport())
    expect(parsePassport('{not json')).toEqual(emptyPassport())
    // Version 1 stamps carried no signature or proof, so they cannot be verified: they are dropped.
    expect(parsePassport(JSON.stringify({ version: 1, traveller: 'trav_x', stamps: [stamp('wat-chalong')] }))).toEqual(emptyPassport())
  })

  it('drops malformed stamps and stamps for places that no longer exist', () => {
    const raw = JSON.stringify({
      version: 2,
      traveller: 'trav_b.sig',
      stamps: [stamp('wat-chalong'), stamp('gone-place'), { placeId: 'old-town' }, null],
      pass: { unlocked: true, sessionId: 'cs_test_1', demo: false },
    })
    const state = parsePassport(raw)
    expect(state.traveller).toBe('trav_b.sig')
    expect(state.stamps.map((s) => s.placeId)).toEqual(['wat-chalong'])
    expect(state.pass).toEqual({ unlocked: true, sessionId: 'cs_test_1', demo: false })
  })

  it('does not trust a pass with a non-boolean unlocked flag', () => {
    const raw = JSON.stringify({ version: 2, traveller: 'trav_b', stamps: [], pass: { unlocked: 'yes', sessionId: 5 } })
    expect(parsePassport(raw).pass).toEqual({ unlocked: false, sessionId: null, demo: false })
  })
})

describe('addStamp and progress', () => {
  it('adds a stamp once per place', () => {
    const s0 = emptyPassport('trav_a')
    const s1 = addStamp(s0, stamp('wat-chalong'))
    expect(s1.stamps).toHaveLength(1)
    expect(addStamp(s1, stamp('wat-chalong', 2))).toBe(s1)
  })

  it('reports progress against the total number of places', () => {
    expect(progress(2)).toEqual({ collected: 2, total: PLACE_COUNT, ratio: 2 / PLACE_COUNT })
    expect(progress(3, 0).ratio).toBe(0)
  })
})

describe('createPassportStore', () => {
  it('starts without a traveller id and removes the old storage key', () => {
    const storage = memoryStorage()
    storage.setItem('verapass:passport:v1', '{"version":1}')
    const store = createPassportStore(storage)
    expect(store.getState().traveller).toBeNull()
    expect(storage.getItem('verapass:passport:v1')).toBeNull()
  })

  it('collects stamps, notifies listeners and survives a reload', () => {
    const storage = memoryStorage()
    const store = createPassportStore(storage)
    store.setTraveller('trav_fixed.sig')
    const listener = vi.fn()
    const off = store.subscribe(listener)
    expect(store.collect(stamp('wat-chalong'))).toBe(true)
    expect(store.collect(stamp('wat-chalong'))).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    store.collect(stamp('old-town'))
    expect(listener).toHaveBeenCalledTimes(1)

    const reloaded = createPassportStore(storage)
    expect(reloaded.getState().traveller).toBe('trav_fixed.sig')
    expect(reloaded.getState().stamps.map((s) => s.placeId)).toEqual(['wat-chalong', 'old-town'])
    expect(JSON.parse(storage.getItem(PASSPORT_KEY) ?? '{}').version).toBe(2)
  })

  it('updates the on-chain status of a stamp by proof hash', () => {
    const store = createPassportStore(memoryStorage())
    const s = stamp('wat-chalong', 1, { status: 'pending' })
    store.collect(s)
    store.updateAttestation(s.proofHash, confirmed)
    expect(store.getState().stamps[0]?.attestation).toEqual(confirmed)
    const before = store.getState()
    store.updateAttestation('ff'.repeat(32), confirmed)
    expect(store.getState()).toBe(before)
  })

  it('unlocks and locks the pass; a new traveller id drops the pass; reset keeps id and pass', () => {
    const store = createPassportStore(memoryStorage())
    store.setTraveller('trav_1.sig')
    store.collect(stamp('wat-chalong'))
    store.unlockPass('demo_123', true)
    expect(store.getState().pass).toEqual({ unlocked: true, sessionId: 'demo_123', demo: true })
    store.reset()
    expect(store.getState()).toEqual({ version: 2, traveller: 'trav_1.sig', stamps: [], pass: { unlocked: true, sessionId: 'demo_123', demo: true } })
    store.setTraveller('trav_2.sig')
    expect(store.getState().pass.unlocked).toBe(false)
    store.unlockPass('demo_9', true)
    store.lockPass()
    expect(store.getState().pass).toEqual({ unlocked: false, sessionId: null, demo: false })
  })

  it('keeps working in memory when storage is missing or throws', () => {
    const noStorage = createPassportStore(null)
    expect(noStorage.collect(stamp('wat-chalong'))).toBe(true)

    const throwing: KVStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('SecurityError')
      },
    }
    const store = createPassportStore(throwing)
    expect(store.collect(stamp('old-town'))).toBe(true)
    expect(store.getState().stamps).toHaveLength(1)
  })
})
