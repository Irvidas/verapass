import { useEffect } from 'react'
import { gsap } from './gsap'

/**
 * Scroll reveals wait for an element to scroll well into view. Keyboard focus can land on a
 * link or button before that (the browser scrolls it just inside the edge), and it would be
 * focused while still invisible. When focus arrives, finish any pending reveal on the way up.
 */
export function useRevealOnFocus(): void {
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      for (let node = e.target instanceof Element ? e.target : null; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (Number(style.opacity) >= 0.99 && style.visibility !== 'hidden') continue
        gsap.getTweensOf(node).forEach((tween) => {
          // Scrubbed tweens follow the scroll position; finishing them would only jump back.
          if (!tween.scrollTrigger?.vars.scrub) tween.progress(1)
        })
      }
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])
}
