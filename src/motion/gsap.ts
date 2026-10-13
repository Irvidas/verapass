import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, ScrambleTextPlugin, DrawSVGPlugin, MotionPathPlugin)

export { gsap, ScrollTrigger, SplitText, useGSAP }

/**
 * Play a scroll animation the first time its trigger is reached, then leave it alone.
 * Not `once: true`: a trigger with `once` kills itself during ScrollTrigger's creation-time
 * refresh when the page is already scrolled past it (reload with restored scroll, or a lazy
 * section mounting below the fold), which crashes ScrollTrigger 3.15 ("reading 'end'").
 */
export const PLAY_ONCE = { toggleActions: 'play none none none' } as const

/** Media queries used with gsap.matchMedia(). Reduced motion always wins. */
export const MQ = {
  full: '(prefers-reduced-motion: no-preference)',
  reduced: '(prefers-reduced-motion: reduce)',
  desktopFull: '(prefers-reduced-motion: no-preference) and (min-width: 900px)',
  finePointer: '(prefers-reduced-motion: no-preference) and (pointer: fine) and (hover: hover)',
} as const

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MQ.reduced).matches
}

/**
 * The fade every animated block falls back to under prefers-reduced-motion.
 * fromTo with an explicit end, so the block always ends fully visible.
 */
export function simpleFade(targets: gsap.TweenTarget, trigger?: Element | null) {
  return gsap.fromTo(
    targets,
    { opacity: 0 },
    {
      opacity: 1,
      duration: 0.6,
      ease: 'none',
      stagger: 0.05,
      scrollTrigger: trigger ? { trigger, start: 'top 85%', ...PLAY_ONCE } : undefined,
    },
  )
}
