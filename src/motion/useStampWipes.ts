import { gsap, MQ, useGSAP } from './gsap'

/**
 * The stamp is the site's transition. At a few key handoffs (wrapped in <div class="wipe">),
 * the next section is pressed onto the page as a growing circle from its top edge, scrubbed by
 * scroll. The wrapper carries the previous section's colour, so outside the circle the old
 * section seems to continue. Once the handoff is done the clip is removed entirely.
 * Full motion only: with reduced motion the sections simply follow each other.
 */
export function useStampWipes(): void {
  useGSAP(() => {
    const mm = gsap.matchMedia()
    mm.add(MQ.full, () => {
      const sections = gsap.utils.toArray<HTMLElement>('.wipe > section')
      sections.forEach((section) => {
        const proxy = { p: 0 }
        const apply = () => {
          const r = proxy.p * Math.hypot(window.innerWidth, window.innerHeight)
          section.style.clipPath = proxy.p >= 1 ? '' : `circle(${r.toFixed(1)}px at 50% 0%)`
        }
        gsap.to(proxy, {
          p: 1,
          ease: 'none',
          onUpdate: apply,
          scrollTrigger: { trigger: section.parentElement, start: 'top bottom', end: 'top top', scrub: 0.6 },
        })
      })
      return () => sections.forEach((s) => (s.style.clipPath = ''))
    })
  })
}
