import { describe, expect, it } from 'vitest'
import { checkGeofence, isValidCoordinate } from '../../shared/geo'
import { getPlaceSummary, getPublicPlace, PLACE_SUMMARIES, PUBLIC_PLACE_DETAILS } from '../../shared/places'
import { allPlaces, getPlace, HIDDEN_PLACE_DETAILS } from '../../server/places'
import { simulatedFix } from '../../src/lib/checkin'

describe('place list', () => {
  it('has unique ids', () => {
    const ids = PLACE_SUMMARIES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has full details for every place on the server', () => {
    expect(allPlaces().map((p) => p.id)).toEqual(PLACE_SUMMARIES.map((p) => p.id))
  })

  it('has valid coordinates and a positive geofence for every place', () => {
    for (const p of allPlaces()) {
      expect(isValidCoordinate(p.lat, p.lng), p.id).toBe(true)
      expect(p.radiusM, p.id).toBeGreaterThan(0)
    }
  })

  it('keeps every map pin inside the island SVG viewBox (40 0 240 410)', () => {
    for (const p of PLACE_SUMMARIES) {
      expect(p.map.x, p.id).toBeGreaterThanOrEqual(40)
      expect(p.map.x, p.id).toBeLessThanOrEqual(280)
      expect(p.map.y, p.id).toBeGreaterThanOrEqual(0)
      expect(p.map.y, p.id).toBeLessThanOrEqual(410)
    }
  })

  it('gives every image an alt text', () => {
    for (const p of PLACE_SUMMARIES.filter((x) => x.image)) expect(p.imageAlt, p.id).toBeTruthy()
  })

  it('keeps hidden place details out of the shared (public) module', () => {
    const hidden = PLACE_SUMMARIES.filter((p) => p.hidden)
    expect(hidden.length).toBeGreaterThan(0)
    for (const p of hidden) {
      expect(PUBLIC_PLACE_DETAILS[p.id], p.id).toBeUndefined()
      expect(getPublicPlace(p.id), p.id).toBeUndefined()
      expect(HIDDEN_PLACE_DETAILS[p.id], p.id).toBeDefined()
      expect(p.teaser).not.toBe(HIDDEN_PLACE_DETAILS[p.id]?.name)
    }
    const publicJson = JSON.stringify({ PLACE_SUMMARIES, PUBLIC_PLACE_DETAILS })
    for (const d of Object.values(HIDDEN_PLACE_DETAILS)) {
      expect(publicJson).not.toContain(String(d.lat))
      expect(publicJson).not.toContain(d.tip)
    }
  })

  it('finds places by id and returns undefined for unknown ids', () => {
    expect(getPublicPlace('wat-chalong')?.name).toBe('Wat Chalong')
    expect(getPlace('secret-reef')?.name).toBe('Secret reef')
    expect(getPlaceSummary('secret-reef')?.teaser).toBe('Hidden reef')
    expect(getPlace('nope')).toBeUndefined()
  })
})

describe('simulatedFix', () => {
  it('always lands inside the geofence of the place with good accuracy', () => {
    let seed = 1
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (const p of allPlaces()) {
      for (let i = 0; i < 20; i++) {
        const fix = simulatedFix(p, random)
        expect(checkGeofence(p, fix.lat, fix.lng, fix.accuracy).ok, p.id).toBe(true)
      }
    }
  })
})
