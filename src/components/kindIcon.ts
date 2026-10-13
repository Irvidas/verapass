import type { PlaceKind } from '../../shared/places'
import type { IconName } from './icons'

/** The line icon for each kind of place (map, chips, stamps). */
export const KIND_ICON: Record<PlaceKind, IconName> = {
  beach: 'beach',
  culture: 'temple',
  viewpoint: 'mountain',
  food: 'bowl',
  nature: 'fish',
  'day-trip': 'boat',
}
