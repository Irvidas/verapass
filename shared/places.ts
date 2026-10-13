/**
 * The single list of Verapass places, used by the web app (map, passport, grid)
 * and by the API (geofence checks). Do not copy this list anywhere else.
 *
 * Every place has a public summary (shown to everyone). Public places also have public
 * details here. The details of hidden places (name, exact location, tip) are not in this
 * file: they live in server/hiddenPlaces.ts, so they never ship in the web bundle, and the
 * API hands them out only to a traveller with a paid Phuket pass.
 *
 * Coordinates are approximate public locations for the Phuket pilot. Sukanya
 * still has to confirm the exact check-in point and radius for each place.
 * `map` is the pin position inside the stylised island SVG (viewBox 40 0 240 410),
 * not a projection of lat/lng.
 */
export type PlaceKind = 'beach' | 'culture' | 'viewpoint' | 'food' | 'nature' | 'day-trip'

/** What anyone can see about a place, locked or not. */
export interface PlaceSummary {
  id: string
  kind: PlaceKind
  /** Hidden places are revealed (name, location, directions) only to Phuket pass holders. */
  hidden: boolean
  /** Name shown before the place is unlocked. */
  teaser: string
  area: string
  /** Geofence radius in metres. Wider for beaches, tighter for viewpoints. */
  radiusM: number
  map: { x: number; y: number }
  image?: string
  imageAlt?: string
}

/** What a traveller needs to find and collect the place. Secret for hidden places. */
export interface PlaceDetail {
  name: string
  area: string
  lat: number
  lng: number
  tip: string
}

export type Place = PlaceSummary & PlaceDetail

export const PLACE_SUMMARIES: readonly PlaceSummary[] = [
  { id: 'patong-beach', kind: 'beach', hidden: false, teaser: 'Patong Beach', area: 'West coast', radiusM: 600, map: { x: 104, y: 214 } },
  {
    id: 'old-town',
    kind: 'food',
    hidden: false,
    teaser: 'Phuket Old Town',
    area: 'Phuket Town',
    radiusM: 400,
    map: { x: 192, y: 262 },
    image: '/images/old-town.jpg',
    imageAlt: 'Sukanya leading a bicycle tour through the streets of Phuket Old Town',
  },
  {
    id: 'wat-chalong',
    kind: 'culture',
    hidden: false,
    teaser: 'Wat Chalong',
    area: 'Chalong',
    radiusM: 250,
    map: { x: 168, y: 318 },
    image: '/images/wat-chalong.jpg',
    imageAlt: 'Sukanya and a guest in front of the Wat Chalong pagoda',
  },
  { id: 'big-buddha', kind: 'viewpoint', hidden: false, teaser: 'Big Buddha', area: 'Nakkerd Hill', radiusM: 200, map: { x: 146, y: 300 } },
  { id: 'kata-viewpoint', kind: 'viewpoint', hidden: false, teaser: 'Karon Viewpoint', area: 'Kata - Karon', radiusM: 150, map: { x: 104, y: 292 } },
  { id: 'promthep-cape', kind: 'viewpoint', hidden: false, teaser: 'Promthep Cape', area: 'South tip', radiusM: 250, map: { x: 112, y: 378 } },
  {
    id: 'khao-sok-lake',
    kind: 'day-trip',
    hidden: false,
    teaser: 'Khao Sok lake',
    area: 'Day trip, Surat Thani',
    radiusM: 3000,
    map: { x: 236, y: 40 },
    image: '/images/khao-sok-lake.jpg',
    imageAlt: 'Sukanya resting on a bamboo raft on the green water of Khao Sok lake',
  },
  {
    id: 'secret-reef',
    kind: 'nature',
    hidden: true,
    teaser: 'Hidden reef',
    area: 'Revealed with the pass',
    radiusM: 300,
    map: { x: 122, y: 120 },
    image: '/images/secret-reef.jpg',
    imageAlt: 'A snorkeller in fins diving down over a coral reef',
  },
  {
    id: 'quiet-snorkel-bay',
    kind: 'nature',
    hidden: true,
    teaser: 'Hidden bay',
    area: 'Revealed with the pass',
    radiusM: 300,
    map: { x: 186, y: 150 },
    image: '/images/snorkel-bay.jpg',
    imageAlt: 'Sukanya and a guest snorkelling in clear water, making peace signs',
  },
  {
    id: 'empty-beach',
    kind: 'beach',
    hidden: true,
    teaser: 'Hidden beach',
    area: 'Revealed with the pass',
    radiusM: 400,
    map: { x: 190, y: 396 },
    image: '/images/quiet-beach.jpg',
    imageAlt: 'Sukanya with a group of smiling guests on a white-sand beach',
  },
]

/** Details of the public places. Hidden places are deliberately missing here. */
export const PUBLIC_PLACE_DETAILS: Readonly<Record<string, PlaceDetail>> = {
  'patong-beach': {
    name: 'Patong Beach',
    area: 'West coast',
    lat: 7.8961,
    lng: 98.296,
    tip: 'Walk to the quiet north end before 9am. Agree on jet ski prices in writing, or skip them.',
  },
  'old-town': {
    name: 'Phuket Old Town',
    area: 'Phuket Town',
    lat: 7.8847,
    lng: 98.388,
    tip: 'Sunday walking street on Thalang Road. Eat where the taxi drivers eat.',
  },
  'wat-chalong': {
    name: 'Wat Chalong',
    area: 'Chalong',
    lat: 7.8467,
    lng: 98.3369,
    tip: 'Go at 7am, before the tour buses. Shoulders and knees covered.',
  },
  'big-buddha': {
    name: 'Big Buddha',
    area: 'Nakkerd Hill',
    lat: 7.8278,
    lng: 98.3125,
    tip: 'Drive up yourself or take a metered taxi. Bring a sarong.',
  },
  'kata-viewpoint': {
    name: 'Karon Viewpoint',
    area: 'Kata - Karon',
    lat: 7.798,
    lng: 98.301,
    tip: 'Three bays in one view. Late afternoon light is the best.',
  },
  'promthep-cape': {
    name: 'Promthep Cape',
    area: 'South tip',
    lat: 7.7621,
    lng: 98.3053,
    tip: 'Everyone comes for sunset. Come for sunrise and you get it to yourself.',
  },
  'khao-sok-lake': {
    name: 'Khao Sok lake',
    area: 'Day trip, Surat Thani',
    lat: 8.9483,
    lng: 98.819,
    tip: 'Stay one night on the lake. The day-trip crowds leave by 3pm.',
  },
}

export const PLACE_COUNT = PLACE_SUMMARIES.length

export function getPlaceSummary(id: string): PlaceSummary | undefined {
  return PLACE_SUMMARIES.find((p) => p.id === id)
}

/** A public place with its details, or undefined for unknown and hidden places. */
export function getPublicPlace(id: string): Place | undefined {
  const summary = getPlaceSummary(id)
  const detail = PUBLIC_PLACE_DETAILS[id]
  return summary && detail && !summary.hidden ? { ...summary, ...detail } : undefined
}

export function isPlaceId(id: string): boolean {
  return PLACE_SUMMARIES.some((p) => p.id === id)
}
