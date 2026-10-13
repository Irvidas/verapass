import { haversineMeters } from '../shared/geo.js'

/** Faster than this between two check-ins means one of them was not real (cars, boats and ferries stay well below). */
export const MAX_TRAVEL_KMH = 250

export interface Fix {
  lat: number
  lng: number
  at: number
}

export function impliedSpeedKmh(prev: Fix, next: Fix): number {
  const meters = haversineMeters(prev.lat, prev.lng, next.lat, next.lng)
  const hours = Math.max(next.at - prev.at, 1) / 3_600_000
  return meters / 1000 / hours
}

export function isPlausibleTravel(prev: Fix | undefined, next: Fix, maxKmh: number = MAX_TRAVEL_KMH): boolean {
  if (!prev) return true
  // Two fixes within 50 m are the same spot, whatever the timing.
  if (haversineMeters(prev.lat, prev.lng, next.lat, next.lng) < 50) return true
  return impliedSpeedKmh(prev, next) <= maxKmh
}
