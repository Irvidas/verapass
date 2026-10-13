import { useSyncExternalStore } from 'react'
import { PLACE_SUMMARIES, PUBLIC_PLACE_DETAILS, type Place, type PlaceDetail, type PlaceSummary } from '../../shared/places'
import { api, ApiError } from './api'
import type { PassportStore } from './passport'

/** A place as the browser knows it. `detail` is null while a hidden place is locked. */
export interface ClientPlace extends PlaceSummary {
  detail: PlaceDetail | null
}

export function resolvePlaces(hidden: Readonly<Record<string, PlaceDetail>> | null): ClientPlace[] {
  return PLACE_SUMMARIES.map((p) => ({ ...p, detail: (p.hidden ? hidden?.[p.id] : PUBLIC_PLACE_DETAILS[p.id]) ?? null }))
}

/** Name to show: the real name once known, the teaser while locked. */
export function placeName(p: ClientPlace): string {
  return p.detail?.name ?? p.teaser
}

export function placeArea(p: ClientPlace): string {
  return p.detail?.area ?? p.area
}

/** The full place, when its details are known. */
export function fullPlace(p: ClientPlace): Place | null {
  return p.detail ? { ...p, ...p.detail } : null
}

/** Hidden place details fetched for this visit. Kept in memory only: the server is the source. */
function createHiddenStore() {
  let places: ClientPlace[] = resolvePlaces(null)
  let unlocked = false
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  return {
    getPlaces: () => places,
    isUnlocked: () => unlocked,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(hidden: Record<string, PlaceDetail> | null) {
      places = resolvePlaces(hidden)
      unlocked = hidden !== null
      emit()
    },
  }
}

export const hiddenStore = createHiddenStore()

export function usePlaces(): ClientPlace[] {
  return useSyncExternalStore(hiddenStore.subscribe, hiddenStore.getPlaces, hiddenStore.getPlaces)
}

/** True once the server has handed over the hidden places for this traveller. */
export function useHiddenUnlocked(): boolean {
  return useSyncExternalStore(hiddenStore.subscribe, hiddenStore.isUnlocked, hiddenStore.isUnlocked)
}

/**
 * Re-checks a stored pass with the server and loads the hidden places. A pass flag edited in
 * localStorage unlocks nothing: without the server's answer the hidden places stay teasers.
 */
export async function syncPass(store: PassportStore, withTraveller: <T>(call: (t: string) => Promise<T>) => Promise<T>): Promise<boolean> {
  const { pass } = store.getState()
  if (!pass.sessionId) {
    hiddenStore.set(null)
    return false
  }
  const sessionId = pass.sessionId
  try {
    const res = await withTraveller((t) => api.pass(sessionId, t))
    if (!res.paid) {
      store.lockPass()
      hiddenStore.set(null)
      return false
    }
    store.unlockPass(sessionId, res.demo)
    const { places } = await withTraveller((t) => api.hiddenPlaces(t))
    hiddenStore.set(places)
    return true
  } catch (err) {
    // A pass that is not ours (or a server that forgot it) locks again; a network blip leaves things as they are.
    if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
      store.lockPass()
      hiddenStore.set(null)
    }
    return false
  }
}
