import type { AttestationStatus, CheckinReceipt, ProofPreimage } from '../../shared/checkin'
import { isPlaceId, PLACE_COUNT } from '../../shared/places'
import type { KVStorage } from './storage'

export const PASSPORT_KEY = 'verapass:passport:v2'
/** Older formats. Their stamps had no signature or proof preimage, so they cannot be verified and are dropped. */
const LEGACY_KEYS = ['verapass:passport:v1']

/**
 * A collected place. It keeps everything needed to check it later without trusting
 * Verapass: the signed receipt, the proof preimage behind the on-chain hash, and the
 * signed on-chain record once Stellar confirms it.
 */
export interface Stamp {
  placeId: string
  collectedAt: number
  simulated: boolean
  distanceM: number
  proofHash: string
  receipt: CheckinReceipt
  signature: string
  publicKey: string
  proof: ProofPreimage
  attestation: AttestationStatus
}

export interface PassState {
  /** The server confirmed a paid pass for this traveller. */
  unlocked: boolean
  sessionId: string | null
  demo: boolean
}

export interface PassportState {
  version: 2
  /** Server-issued traveller id, or null until the first call to the server. */
  traveller: string | null
  stamps: Stamp[]
  pass: PassState
}

const LOCKED: PassState = { unlocked: false, sessionId: null, demo: false }

export function emptyPassport(traveller: string | null = null): PassportState {
  return { version: 2, traveller, stamps: [], pass: { ...LOCKED } }
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function isReceipt(v: unknown): v is CheckinReceipt {
  return (
    isObj(v) &&
    isStr(v.traveller) &&
    isStr(v.placeId) &&
    isNum(v.distanceM) &&
    isNum(v.accuracy) &&
    isNum(v.checkedInAt) &&
    typeof v.simulated === 'boolean' &&
    isStr(v.proofHash)
  )
}

function isProof(v: unknown): v is ProofPreimage {
  return (
    isObj(v) &&
    isStr(v.traveller) &&
    isStr(v.placeId) &&
    isStr(v.nonce) &&
    isNum(v.lat) &&
    isNum(v.lng) &&
    isNum(v.accuracy) &&
    isNum(v.deviceTs) &&
    isNum(v.serverTs) &&
    typeof v.simulated === 'boolean'
  )
}

function isAttestationStatus(v: unknown): v is AttestationStatus {
  if (!isObj(v)) return false
  if (v.status === 'pending') return true
  if (v.status === 'failed') return isStr(v.message)
  if (v.status !== 'confirmed' || !isStr(v.signature) || !isObj(v.record)) return false
  const r = v.record
  return (r.mode === 'mock' || r.mode === 'testnet') && isStr(r.id) && isStr(r.txHash) && isStr(r.explorerUrl) && isContractRef(r.contract)
}

function isContractRef(v: unknown): boolean {
  if (v === undefined) return true
  if (!isObj(v)) return false
  return (
    isStr(v.id) &&
    isStr(v.url) &&
    isStr(v.traveller) &&
    (v.tokenId === undefined || isNum(v.tokenId)) &&
    (v.alreadyStamped === undefined || typeof v.alreadyStamped === 'boolean')
  )
}

/** Shape check only. Whether the signatures hold is checked separately (src/lib/verification.ts). */
export function isStamp(value: unknown): value is Stamp {
  return (
    isObj(value) &&
    isStr(value.placeId) &&
    isNum(value.collectedAt) &&
    typeof value.simulated === 'boolean' &&
    isNum(value.distanceM) &&
    isStr(value.proofHash) &&
    isStr(value.signature) &&
    isStr(value.publicKey) &&
    isReceipt(value.receipt) &&
    isProof(value.proof) &&
    isAttestationStatus(value.attestation) &&
    value.receipt.proofHash === value.proofHash &&
    value.receipt.placeId === value.placeId
  )
}

/** Parses stored JSON, dropping anything malformed instead of crashing the page. */
export function parsePassport(raw: string | null): PassportState {
  if (!raw) return emptyPassport()
  try {
    const data = JSON.parse(raw) as Partial<PassportState>
    if (data.version !== 2) return emptyPassport()
    const traveller = isStr(data.traveller) ? data.traveller : null
    const stamps = Array.isArray(data.stamps) ? data.stamps.filter(isStamp).filter((s) => isPlaceId(s.placeId)) : []
    const pass = isObj(data.pass) ? data.pass : undefined
    return {
      version: 2,
      traveller,
      stamps,
      pass: {
        unlocked: pass?.unlocked === true,
        sessionId: isStr(pass?.sessionId) ? pass.sessionId : null,
        demo: pass?.demo === true,
      },
    }
  } catch {
    return emptyPassport()
  }
}

/** Adds a stamp unless that place is already collected. Returns the same object when nothing changed. */
export function addStamp(state: PassportState, stamp: Stamp): PassportState {
  if (state.stamps.some((s) => s.placeId === stamp.placeId)) return state
  return { ...state, stamps: [...state.stamps, stamp] }
}

export function progress(collected: number, total: number = PLACE_COUNT): { collected: number; total: number; ratio: number } {
  return { collected, total, ratio: total === 0 ? 0 : Math.min(1, collected / total) }
}

export interface PassportStore {
  getState(): PassportState
  subscribe(listener: () => void): () => void
  collect(stamp: Stamp): boolean
  updateAttestation(proofHash: string, attestation: AttestationStatus): void
  /** A new server-issued id. A pass bought with the old id does not carry over. */
  setTraveller(traveller: string): void
  unlockPass(sessionId: string, demo: boolean): void
  lockPass(): void
  reset(): void
}

export function createPassportStore(storage: KVStorage | null): PassportStore {
  let state = parsePassport(storage?.getItem(PASSPORT_KEY) ?? null)
  const listeners = new Set<() => void>()
  for (const key of LEGACY_KEYS) {
    try {
      storage?.removeItem(key)
    } catch {
      // Blocked storage: nothing to clean up.
    }
  }

  const commit = (next: PassportState) => {
    if (next === state) return
    state = next
    try {
      storage?.setItem(PASSPORT_KEY, JSON.stringify(state))
    } catch {
      // Storage full or blocked: the passport keeps working for this visit.
    }
    listeners.forEach((l) => l())
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    collect(stamp) {
      const next = addStamp(state, stamp)
      const added = next !== state
      commit(next)
      return added
    },
    updateAttestation(proofHash, attestation) {
      if (!state.stamps.some((s) => s.proofHash === proofHash)) return
      commit({ ...state, stamps: state.stamps.map((s) => (s.proofHash === proofHash ? { ...s, attestation } : s)) })
    },
    setTraveller(traveller) {
      if (traveller === state.traveller) return
      commit({ ...state, traveller, pass: { ...LOCKED } })
    },
    unlockPass(sessionId, demo) {
      commit({ ...state, pass: { unlocked: true, sessionId, demo } })
    },
    lockPass() {
      if (!state.pass.unlocked && state.pass.sessionId === null) return
      commit({ ...state, pass: { ...LOCKED } })
    },
    reset() {
      commit({ ...state, stamps: [] })
    },
  }
}
