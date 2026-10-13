import { useEffect, useRef, useState } from 'react'
import { PLACE_COUNT } from '../../shared/places'
import { isDockHeld, onDockHold } from '../lib/dockHold'
import { progress } from '../lib/passport'
import { passportStore, usePassport } from '../lib/usePassport'
import { counts, useStampVerdicts } from '../lib/verification'
import { gsap, MQ, ScrollTrigger, useGSAP } from '../motion/gsap'

/**
 * Floating passport counter. Flying stamps land here; while one is in the air the count waits for it.
 * It steps aside while the hero and the final call to action are on screen.
 */
export function PassportDock() {
  const state = usePassport()
  const verdicts = useStampVerdicts(state.stamps)
  const ref = useRef<HTMLElement>(null)
  const live = progress(state.stamps.filter((s) => counts(verdicts.get(s.proofHash))).length, PLACE_COUNT)
  // While held, show the count from the moment the hold started (taken before the new stamp is stored).
  const [frozen, setFrozen] = useState<ReturnType<typeof progress> | null>(() =>
    isDockHeld() ? progress(passportStore.getState().stamps.length, PLACE_COUNT) : null,
  )
  useEffect(() => onDockHold((held) => setFrozen(held ? progress(passportStore.getState().stamps.length, PLACE_COUNT) : null)), [])

  useGSAP(() => {
    const el = ref.current
    if (!el) return
    const mm = gsap.matchMedia()
    mm.add(MQ.full, () => {
      const zones = ['#top', '.final'].map((sel) => document.querySelector(sel)).filter((z): z is Element => Boolean(z))
      const inZone = new Set<Element>()
      const update = () => gsap.to(el, { autoAlpha: inZone.size > 0 ? 0 : 1, y: inZone.size > 0 ? 16 : 0, duration: 0.35, ease: 'power2.out', overwrite: 'auto' })
      zones.forEach((zone) =>
        ScrollTrigger.create({
          trigger: zone,
          start: 'top 85%',
          end: 'bottom 15%',
          onToggle: (self) => {
            if (self.isActive) inZone.add(zone)
            else inZone.delete(zone)
            update()
          },
        }),
      )
      // Keyboard users can always reach it.
      const show = () => gsap.to(el, { autoAlpha: 1, y: 0, duration: 0.2, overwrite: 'auto' })
      el.addEventListener('focusin', show)
      return () => el.removeEventListener('focusin', show)
    })
  })

  const { collected, total, ratio } = frozen ?? live
  const c = 2 * Math.PI * 16
  return (
    <aside ref={ref} id="passport-dock-region" className="dock-region" aria-label="Your passport">
      <a href="#passport" id="passport-dock" className="dock">
        <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
          <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
          <circle
            cx="20"
            cy="20"
            r="16"
            fill="none"
            stroke="var(--coral)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - ratio)}
            transform="rotate(-90 20 20)"
            className="dock-ring"
          />
        </svg>
        <span className="dock-count-mini" aria-hidden="true">
          {collected}
        </span>
        <span className="dock-text">
          <small>Passport</small>
          <b data-testid="dock-count">
            {collected}/{total}
          </b>
          <span className="sr-only"> places collected</span>
        </span>
      </a>
    </aside>
  )
}
