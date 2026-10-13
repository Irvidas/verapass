import type {
  AttestationStatus,
  CheckinError,
  CheckinRequest,
  CheckinResponse,
  NonceResponse,
  TravellerResponse,
} from '../../shared/checkin'
import type { PlaceDetail } from '../../shared/places'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly distanceM?: number,
  ) {
    super(message)
  }
}

export interface Health {
  payments: 'demo' | 'stripe-test'
  attestation: 'mock' | 'testnet'
  /** The verapass_stamps contract real check-ins are stamped on, or null in mock mode. */
  contractId: string | null
  simulation: boolean
  receiptPublicKey: string
  receiptKeyPersistent: boolean
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError('Could not reach the Verapass server. Is `npm run dev` running?', 'network', 0)
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<CheckinError>) | null
  if (!res.ok || !data) {
    throw new ApiError(data?.message ?? `Request failed (${res.status})`, data?.error ?? 'http', res.status, data?.distanceM)
  }
  return data
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

const q = encodeURIComponent

let healthCache: Promise<Health | null> | null = null

export const api = {
  traveller: () => post<TravellerResponse>('/api/traveller', {}),
  nonce: (traveller: string, placeId: string) => post<NonceResponse>('/api/nonce', { traveller, placeId }),
  checkin: (req: CheckinRequest) => post<CheckinResponse>('/api/checkin', req),
  attestation: (proofHash: string) => request<AttestationStatus>(`/api/attestation/${q(proofHash)}`),
  checkout: (traveller: string) => post<{ mode: 'demo' | 'stripe'; sessionId: string; url: string }>('/api/checkout', { traveller }),
  pass: (sessionId: string, traveller: string) =>
    request<{ paid: boolean; demo: boolean }>(`/api/pass/${q(sessionId)}?traveller=${q(traveller)}`),
  hiddenPlaces: (traveller: string) => request<{ places: Record<string, PlaceDetail> }>(`/api/places/hidden?traveller=${q(traveller)}`),
  /** Server mode and receipt key. Cached: every section asks for it. */
  health(): Promise<Health | null> {
    healthCache ??= request<Health>('/api/health').catch(() => {
      healthCache = null
      return null
    })
    return healthCache
  },
}
