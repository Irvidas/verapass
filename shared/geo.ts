import type { Place } from './places.js'

const EARTH_RADIUS_M = 6_371_008.8

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Great-circle distance in metres between two lat/lng points (haversine formula). */
export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** A browser fix worse than this (95% confidence radius, metres) cannot prove presence. */
export const MAX_ACCURACY_M = 100

export type GeofenceResult =
  | { ok: true; distanceM: number }
  | { ok: false; distanceM: number; reason: 'invalid-coordinates' | 'too-far' | 'low-accuracy' }

export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  )
}

/**
 * Checks a GPS fix against a place geofence. The fix passes only if the reported
 * position is inside the radius and the accuracy is good enough to mean something.
 */
export function checkGeofence(
  place: Pick<Place, 'lat' | 'lng' | 'radiusM'>,
  lat: number,
  lng: number,
  accuracyM: number,
  maxAccuracyM: number = MAX_ACCURACY_M,
): GeofenceResult {
  if (!isValidCoordinate(lat, lng) || !Number.isFinite(accuracyM) || accuracyM < 0) {
    return { ok: false, distanceM: Number.NaN, reason: 'invalid-coordinates' }
  }
  const distanceM = haversineMeters(place.lat, place.lng, lat, lng)
  if (accuracyM > maxAccuracyM) return { ok: false, distanceM, reason: 'low-accuracy' }
  if (distanceM > place.radiusM) return { ok: false, distanceM, reason: 'too-far' }
  return { ok: true, distanceM }
}

/** Nearest place to a point, with its distance. */
export function nearestPlace<T extends Pick<Place, 'lat' | 'lng'>>(
  places: readonly T[],
  lat: number,
  lng: number,
): { place: T; distanceM: number } | undefined {
  let best: { place: T; distanceM: number } | undefined
  for (const place of places) {
    const distanceM = haversineMeters(place.lat, place.lng, lat, lng)
    if (!best || distanceM < best.distanceM) best = { place, distanceM }
  }
  return best
}

export function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return 'unknown distance'
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`
}
