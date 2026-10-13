import type { RefObject } from 'react'
import { gsap, MQ, PLAY_ONCE, simpleFade, SplitText, useGSAP } from './gsap'

/**
 * Shared scroll motion for a section. Mark elements with:
 * - data-split: headline lines rise out of a mask
 * - data-reveal: block fades up
 * - data-mask: image wipes open (clip-path) while its picture settles
 * - data-parallax="-12": drifts by that many yPercent while scrolling
 * - data-draw: line icons inside draw their strokes on
 * Under prefers-reduced-motion everything becomes a plain fade.
 * Reveals animate opacity, not visibility, so content stays in the accessibility tree before it scrolls in.
 * `extra` runs inside the same matchMedia context for section-specific timelines.
 */
export function useSectionMotion(
  scope: RefObject<HTMLElement | null>,
  extra?: (full: boolean, root: HTMLElement) => (() => void) | undefined,
  dependencies: unknown[] = [],
): void {
  useGSAP(
    () => {
      const root = scope.current
      if (!root) return
      const mm = gsap.matchMedia()
      mm.add({ full: MQ.full, reduced: MQ.reduced }, (ctx) => {
        const full = Boolean(ctx.conditions?.full)
        const all = <T extends Element = HTMLElement>(sel: string) => Array.from(root.querySelectorAll<T & Element>(sel))

        all('[data-split]').forEach((el) => {
          if (!full) return void simpleFade(el, el)
          SplitText.create(el, {
            type: 'lines,words',
            mask: 'lines',
            autoSplit: true,
            onSplit: (self) =>
              gsap.from(self.lines, {
                yPercent: 115,
                rotate: 2,
                duration: 1.15,
                ease: 'expo.out',
                stagger: 0.09,
                scrollTrigger: { trigger: el, start: 'top 88%', ...PLAY_ONCE },
              }),
          })
        })

        all('[data-reveal]').forEach((el) => {
          if (!full) return void simpleFade(el, el)
          gsap.from(el, {
            y: 48,
            opacity: 0,
            duration: 1.1,
            ease: 'power3.out',
            delay: Number(el.dataset.reveal) || 0,
            scrollTrigger: { trigger: el, start: 'top 90%', ...PLAY_ONCE },
          })
        })

        all('[data-mask]').forEach((el) => {
          if (!full) return void simpleFade(el, el)
          const img = el.querySelector('img')
          const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: 'top 88%', ...PLAY_ONCE } })
          tl.fromTo(el, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.4, ease: 'expo.inOut' })
          if (img) tl.from(img, { scale: 1.35, duration: 1.8, ease: 'expo.out' }, 0.1)
        })

        if (full) {
          all('[data-draw]').forEach((el) => {
            gsap.from(el.querySelectorAll('svg.icon path, svg.icon circle, svg.icon rect, svg.icon ellipse'), {
              drawSVG: 0,
              duration: 1.1,
              ease: 'power2.inOut',
              stagger: 0.04,
              scrollTrigger: { trigger: el, start: 'top 88%', ...PLAY_ONCE },
            })
          })
          all('[data-parallax]').forEach((el) => {
            gsap.to(el, {
              yPercent: Number(el.dataset.parallax) || -10,
              ease: 'none',
              scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
            })
          })
        }

        return extra?.(full, root)
      })
    },
    { scope, dependencies },
  )
}
