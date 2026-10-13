import type { AttestationStatus, CheckinResponse } from '../../shared/checkin'
import type { Place } from '../../shared/places'
import { api } from './api'
import type { PassportStore, Stamp } from './passport'

export interface Fix {
  lat: number
  lng: number
  accuracy: number
}

export function getBrowserFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This browser has no location access. Use the demo button instead.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. Allow it, or try the demo button.'
              : 'Could not get a GPS fix. Step outside and try again.',
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
  })
}

/** A plausible fix a few metres from the place, for the clearly labelled demo button. */
export function simulatedFix(place: Pick<Place, 'lat' | 'lng'>, random: () => number = Math.random): Fix {
  const metres = 5 + random() * 20
  const angle = random() * Math.PI * 2
  const dLat = (metres * Math.cos(angle)) / 111_320
  const dLng = (metres * Math.sin(angle)) / (111_320 * Math.cos((place.lat * Math.PI) / 180))
  return { lat: place.lat + dLat, lng: place.lng + dLng, accuracy: 12 }
}

/** Everything the passport keeps from the server's answer: receipt, signature, preimage and chain status. */
export function stampFromResponse(res: CheckinResponse): Stamp {
  return {
    placeId: res.receipt.placeId,
    collectedAt: res.receipt.checkedInAt,
    simulated: res.receipt.simulated,
    distanceM: res.receipt.distanceM,
    proofHash: res.receipt.proofHash,
    receipt: res.receipt,
    signature: res.signature,
    publicKey: res.publicKey,
    proof: res.proof,
    attestation: res.attestation,
  }
}

type WithTraveller = <T>(call: (traveller: string) => Promise<T>) => Promise<T>

/** Full check-in: server nonce, then the fix. Returns the stamp to put in the passport. */
export async function checkIn(withTraveller: WithTraveller, place: Place, fix: Fix, simulated: boolean): Promise<Stamp> {
  return withTraveller(async (traveller) => {
    const { nonce } = await api.nonce(traveller, place.id)
    const res = await api.checkin({
      traveller,
      placeId: place.id,
      nonce,
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      deviceTs: Date.now(),
      simulated,
    })
    return stampFromResponse(res)
  })
}

/**
 * Polls the server for stamps whose on-chain record is still pending, and stores the answer.
 * Returns a stop function. Gives up quietly after `maxTries` (the stamp stays "pending").
 */
export function pollPendingAttestations(
  store: PassportStore,
  options: { intervalMs?: number; maxTries?: number; fetchStatus?: (proofHash: string) => Promise<AttestationStatus> } = {},
): () => void {
  const fetchStatus = options.fetchStatus ?? api.attestation
  const maxTries = options.maxTries ?? 40
  const pendingStamps = () => store.getState().stamps.filter((s) => s.attestation.status === 'pending')
  let running = false
  let stopped = false
  let wake: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve
      timer = setTimeout(resolve, ms)
    })

  const loop = async () => {
    running = true
    for (let tries = 0; !stopped && tries < maxTries; tries++) {
      const pending = pendingStamps()
      if (pending.length === 0) break
      await Promise.all(
        pending.map(async (s) => {
          try {
            const status = await fetchStatus(s.proofHash)
            if (status.status !== 'pending') store.updateAttestation(s.proofHash, status)
          } catch {
            // Unknown to this server (it restarted) or offline: try again next round.
          }
        }),
      )
      if (pendingStamps().length > 0 && !stopped) await pause(options.intervalMs ?? 2500)
    }
    running = false
  }

  const off = store.subscribe(() => {
    if (!running && !stopped && pendingStamps().length > 0) void loop()
  })
  void loop()
  return () => {
    stopped = true
    clearTimeout(timer)
    wake?.()
    off()
  }
}
