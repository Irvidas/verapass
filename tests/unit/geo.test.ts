import { describe, expect, it } from 'vitest'
import { checkGeofence, formatDistance, haversineMeters, isValidCoordinate, MAX_ACCURACY_M, nearestPlace } from '../../shared/geo'
import { allPlaces, getPlace } from '../../server/places'

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(7.8961, 98.296, 7.8961, 98.296)).toBe(0)
  })

  it('matches one degree of latitude (about 111.2 km)', () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(111_195, -1)
  })

  it('is symmetric', () => {
    const a = haversineMeters(7.8961, 98.296, 7.8847, 98.388)
    const b = haversineMeters(7.8847, 98.388, 7.8961, 98.296)
    expect(a).toBeCloseTo(b, 6)
  })

  it('gives a plausible distance between Patong Beach and Phuket Old Town (about 10 km)', () => {
    const d = haversineMeters(7.8961, 98.296, 7.8847, 98.388)
    expect(d).toBeGreaterThan(9_500)
    expect(d).toBeLessThan(10_800)
  })

  it('handles antipodal points without NaN', () => {
    const d = haversineMeters(0, 0, 0, 180)
    expect(Number.isFinite(d)).toBe(true)
    expect(d).toBeCloseTo(Math.PI * 6_371_008.8, -1)
  })
})

describe('isValidCoordinate', () => {
  it.each([
    [0, 0, true],
    [90, 180, true],
    [-90, -180, true],
    [90.0001, 0, false],
    [0, -180.5, false],
    [Number.NaN, 0, false],
    [0, Number.POSITIVE_INFINITY, false],
  ])('(%s, %s) -> %s', (lat, lng, expected) => {
    expect(isValidCoordinate(lat, lng)).toBe(expected)
  })
})

describe('checkGeofence', () => {
  const place = { lat: 7.8467, lng: 98.3369, radiusM: 250 }

  it('accepts a fix inside the radius with good accuracy', () => {
    const r = checkGeofence(place, 7.8468, 98.337, 15)
    expect(r.ok).toBe(true)
    expect(r.distanceM).toBeLessThan(20)
  })

  it('rejects a fix outside the radius as too-far and reports the distance', () => {
    const r = checkGeofence(place, 7.8961, 98.296, 10)
    expect(r).toMatchObject({ ok: false, reason: 'too-far' })
    expect(r.distanceM).toBeGreaterThan(5_000)
  })

  it('accepts a fix exactly on the radius edge', () => {
    // ~0.002245 deg of latitude is ~249.6 m
    const r = checkGeofence(place, place.lat + 0.002245, place.lng, 10)
    expect(r.ok).toBe(true)
  })

  it('rejects a rough fix even when the point is inside the fence', () => {
    const r = checkGeofence(place, place.lat, place.lng, MAX_ACCURACY_M + 1)
    expect(r).toMatchObject({ ok: false, reason: 'low-accuracy' })
  })

  it('allows a custom accuracy cap', () => {
    expect(checkGeofence(place, place.lat, place.lng, 150, 200).ok).toBe(true)
  })

  it('rejects invalid coordinates and negative or non-finite accuracy', () => {
    expect(checkGeofence(place, 91, 0, 10)).toMatchObject({ ok: false, reason: 'invalid-coordinates' })
    expect(checkGeofence(place, place.lat, place.lng, -1)).toMatchObject({ ok: false, reason: 'invalid-coordinates' })
    expect(checkGeofence(place, place.lat, place.lng, Number.NaN)).toMatchObject({ ok: false, reason: 'invalid-coordinates' })
  })
})

describe('nearestPlace', () => {
  it('returns undefined for an empty list', () => {
    expect(nearestPlace([], 0, 0)).toBeUndefined()
  })

  it('finds the place a traveller is standing at', () => {
    const watChalong = getPlace('wat-chalong')
    if (!watChalong) throw new Error('fixture missing')
    const r = nearestPlace(allPlaces(), watChalong.lat + 0.0001, watChalong.lng)
    expect(r?.place.id).toBe('wat-chalong')
    expect(r?.distanceM).toBeLessThan(20)
  })
})

describe('formatDistance', () => {
  it.each([
    [0, '0 m'],
    [12.4, '12 m'],
    [999, '999 m'],
    [1000, '1.0 km'],
    [9_949, '9.9 km'],
    [12_345, '12 km'],
    [Number.NaN, 'unknown distance'],
  ])('%s -> %s', (m, expected) => {
    expect(formatDistance(m)).toBe(expected)
  })
})
