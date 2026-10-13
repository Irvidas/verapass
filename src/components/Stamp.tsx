import type { PlaceKind } from '../../shared/places'
import { KindGlyph } from './icons'

const INK: Record<PlaceKind, string> = {
  beach: 'var(--sea-deep)',
  culture: 'var(--coral-deep)',
  viewpoint: 'var(--palm)',
  food: 'var(--coral-deep)',
  nature: 'var(--sea-deep)',
  'day-trip': 'var(--palm-deep)',
}

/** A small, stable tilt per place, so a page of stamps looks pressed by hand. */
function hashAngle(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0
  return (Math.abs(h) % 24) - 12
}

interface StampProps {
  place: { id: string; kind: PlaceKind }
  /** Name on the ring. */
  name: string
  date?: number
  size?: number
  className?: string
  /** A faint dashed outline of the stamp still to collect. Decorative. */
  ghost?: boolean
}

/** A passport stamp: ring text with the place name, the place-kind icon in the middle, date underneath. */
export function Stamp({ place, name, date, size = 132, className, ghost = false }: StampProps) {
  const pathId = `stamp-arc-${place.id}${ghost ? '-ghost' : ''}`
  const label = `${name.toUpperCase()}  -  PHUKET  -  VERAPASS  -  `
  const when = date
    ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
    : 'NOT YET'
  const a11y = ghost ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': `Stamp: ${name}${date ? `, collected ${when}` : ''}` }
  return (
    <svg
      className={`stamp ${ghost ? 'stamp-ghost' : ''} ${className ?? ''}`}
      viewBox="0 0 140 140"
      width={size}
      height={size}
      style={{ color: INK[place.kind], transform: `rotate(${hashAngle(place.id)}deg)` }}
      {...a11y}
    >
      <defs>
        <path id={pathId} d="M70 70 m-50 0 a50 50 0 1 1 100 0 a50 50 0 1 1 -100 0" />
      </defs>
      <circle cx="70" cy="70" r="66" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={ghost ? '3 3' : undefined} />
      <circle cx="70" cy="70" r="60" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
      <circle cx="70" cy="70" r="38" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={ghost ? '3 3' : undefined} />
      <text fontSize="9.5" fontWeight="700" letterSpacing="2.2" fill="currentColor" fontFamily="DM Sans, sans-serif">
        <textPath href={`#${pathId}`} textLength="308" lengthAdjust="spacing">
          {label}
        </textPath>
      </text>
      <g
        transform="translate(55 50) scale(1.25)"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stamp-glyph"
      >
        <KindGlyph kind={place.kind} />
      </g>
      {!ghost && (
        <>
          <rect x="34" y="92" width="72" height="15" rx="2" fill="currentColor" />
          <text x="70" y="103" textAnchor="middle" fontSize="8" fontWeight="700" letterSpacing="1" fill="var(--paper)" fontFamily="DM Sans, sans-serif">
            {when}
          </text>
        </>
      )}
    </svg>
  )
}
