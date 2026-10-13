import type { ReactNode } from 'react'
import type { PlaceKind } from '../../shared/places'
import { KIND_ICON } from './kindIcon'

/**
 * One line-icon set for the whole site: 24px grid, 1.75 stroke, round caps, the same
 * hand as the How it works icons and the stamp. Mark a wrapper with data-draw and
 * useSectionMotion draws the strokes on when it scrolls into view.
 */
const PATHS = {
  // places
  beach: (
    <>
      <circle cx="17" cy="6" r="2.5" />
      <path d="M2 15c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5" />
      <path d="M2 19.5c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5" />
    </>
  ),
  temple: (
    <>
      <path d="M12 2.5v3" />
      <path d="M8.5 9 12 5.5 15.5 9" />
      <path d="M6 13 12 8.5 18 13" />
      <path d="M4 17.5 12 12l8 5.5" />
      <path d="M6 17.5V21h12v-3.5M10.5 21v-3h3v3" />
    </>
  ),
  mountain: (
    <>
      <path d="M2.5 20 9 9l4 6.5 2.5-3.5 6 8z" />
      <path d="M7.4 11.7 9 13l1.4-1.2" />
      <circle cx="17.5" cy="5.5" r="1.8" />
    </>
  ),
  bowl: (
    <>
      <path d="M3 12h18a9 9 0 0 1-18 0z" />
      <path d="M8 21h8" />
      <path d="M14 3 9.5 10.5M18 4l-5.5 6.5" />
    </>
  ),
  fish: (
    <>
      <path d="M2.5 12c3-4.5 8.5-6 13-2.5L21 6v12l-5.5-3.5C11 18 5.5 16.5 2.5 12z" />
      <circle cx="7.5" cy="11" r=".9" />
    </>
  ),
  boat: (
    <>
      <path d="M3 15.5h18l-2.5 4h-13z" />
      <path d="M12 3.5v12M12 4.5l6 9H12" />
      <path d="M2 21.5c1.7 0 1.7-1 3.3-1s1.7 1 3.4 1 1.6-1 3.3-1 1.7 1 3.3 1 1.7-1 3.4-1 1.6 1 3.3 1" />
    </>
  ),
  // values, services, pass
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  palm: (
    <>
      <path d="M12.5 21c.5-4.5.2-8.5-1-12" />
      <path d="M11.5 9C9 6 5.5 5.5 3 7c3 0 5 .8 6.5 2.5" />
      <path d="M11.5 9c.5-3.5 3-5.5 6-5.5-2 1-3.5 2.5-4 5" />
      <path d="M11.5 9c3-1 6.5 0 8.5 2.5-2.5-.8-5-.8-7 0" />
      <path d="M7 21h11" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  backpack: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20z" />
      <path d="M9.5 3.5V3a2.5 2.5 0 0 1 5 0v.5" />
      <path d="M9 13h6v4H9z" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  map: (
    <>
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21.5s-7-6-7-11.5a7 7 0 0 1 14 0c0 5.5-7 11.5-7 11.5z" />
      <path d="m9 10 2 2 4-4.5" />
    </>
  ),
  plane: (
    <>
      <path d="M2.5 13.5 21 6.5l-3.5 12-5-3.5-3 3.5V15" />
      <path d="M2.5 13.5 9.5 15l8-6.5" />
    </>
  ),
  scooter: (
    <>
      <circle cx="5.5" cy="17.5" r="2.5" />
      <circle cx="18.5" cy="17.5" r="2.5" />
      <path d="M8 17.5h7.5L18 9.5h-3M15 4.5h2.5l.5 5" />
      <path d="M5.5 15V12h6" />
    </>
  ),
  document: (
    <>
      <path d="M6 2.5h8l4.5 4.5v14.5H6z" />
      <path d="M14 2.5V7h4.5M9 12h6.5M9 15.5h6.5M9 19h4" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.5 18H16a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h7.5" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="9" cy="7" rx="6" ry="2.5" />
      <path d="M3 7v4.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7" />
      <path d="M9 16.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V12c0-1.4-2.7-2.5-6-2.5" />
    </>
  ),
  noEntry: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 2.5v5M16 2.5v5M7.5 14h2M11 14h2M14.5 14h2M7.5 17.5h2M11 17.5h2" />
    </>
  ),
  passport: (
    <>
      <rect x="5" y="2.5" width="14" height="19" rx="2" />
      <circle cx="12" cy="10" r="3.5" />
      <path d="M8.5 10h7M12 6.5c-1 1-1.5 2.2-1.5 3.5s.5 2.5 1.5 3.5M12 6.5c1 1 1.5 2.2 1.5 3.5s-.5 2.5-1.5 3.5M9 17.5h6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3M12 14.5v2.5" />
    </>
  ),
  badge: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <circle cx="8" cy="12" r="2.5" />
      <path d="M13 10h6M13 14h4" />
    </>
  ),
  speech: (
    <>
      <path d="M3 5.5h12v8H8l-3.5 3v-3H3z" />
      <path d="M15 9.5h6v8h-1.5v3l-3.5-3H11v-4" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS


export function Icon({ name, size = 24, className, strokeWidth = 1.75 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}

/** The icon for a place kind as bare SVG children, for drawing inside another SVG (the stamp). */
export function KindGlyph({ kind }: { kind: PlaceKind }) {
  return <>{PATHS[KIND_ICON[kind]]}</>
}
