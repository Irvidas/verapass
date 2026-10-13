import { getPlaceSummary, getPublicPlace, PLACE_SUMMARIES, type Place, type PlaceDetail } from '../shared/places.js'

/**
 * Details of the hidden places. Server only: this file must never be imported from src/,
 * so the names, coordinates and tips stay out of the public web bundle.
 * GET /api/places/hidden hands them out to travellers with a paid pass.
 */
export const HIDDEN_PLACE_DETAILS: Readonly<Record<string, PlaceDetail>> = {
  'secret-reef': {
    name: 'Secret reef',
    area: 'North-west coast',
    lat: 8.0905,
    lng: 98.2952,
    tip: 'Low tide only. Sukanya shares the tide window and the entry point.',
  },
  'quiet-snorkel-bay': {
    name: 'Quiet snorkel bay',
    area: 'North-east coast',
    lat: 8.0461,
    lng: 98.4052,
    tip: 'Bring your own mask. No rental stands means no crowds.',
  },
  'empty-beach': {
    name: 'Beach with no crowds',
    area: 'South-east coast',
    lat: 7.7905,
    lng: 98.3734,
    tip: 'A short walk through the trees keeps the tour vans away.',
  },
}

/** Any place, public or hidden, with its full details. For geofence checks on the server. */
export function getPlace(id: string): Place | undefined {
  const pub = getPublicPlace(id)
  if (pub) return pub
  const summary = getPlaceSummary(id)
  const detail = HIDDEN_PLACE_DETAILS[id]
  return summary && detail ? { ...summary, ...detail } : undefined
}

/** Every place with full details, in map order. */
export function allPlaces(): Place[] {
  return PLACE_SUMMARIES.map((p) => getPlace(p.id)).filter((p): p is Place => Boolean(p))
}

/** The hidden places' details, keyed by place id, for a traveller who has paid. */
export function hiddenDetails(): Record<string, PlaceDetail> {
  return { ...HIDDEN_PLACE_DETAILS }
}
