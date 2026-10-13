import Lenis from 'lenis'
import { useEffect } from 'react'
import { gsap, MQ, ScrollTrigger } from './gsap'

let active: Lenis | null = null

/**
 * Bring an element into view without fighting Lenis: through Lenis when it runs, natively otherwise.
 * Used to keep the map on screen during the check-in moment on phones, where the panel sits above it.
 */
export function revealElement(el: Element): void {
  const r = el.getBoundingClientRect()
  if (r.top >= 0 && r.bottom <= window.innerHeight) return
  // Centre it when it fits, else align below the nav. An absolute target from the real scroll
  // position: Lenis's own idea of it can lag right after a jump made outside Lenis.
  const offset = r.height < window.innerHeight ? -(window.innerHeight - r.height) / 2 : -72
  if (active) active.scrollTo(window.scrollY + r.top + offset, { duration: 0.8 })
  else el.scrollIntoView({ block: 'center', behavior: window.matchMedia(MQ.reduced).matches ? 'auto' : 'smooth' })
}

/**
 * Freeze page scrolling (open menu, dialogs). Lenis ignores overflow: hidden on <html>,
 * so it is stopped as well as the native scroll.
 */
export function lockScroll(): () => void {
  const root = document.documentElement
  root.classList.add('scroll-locked')
  active?.stop()
  return () => {
    root.classList.remove('scroll-locked')
    active?.start()
  }
}

/** Scroll a section into view under the fixed nav, the way the nav links do. */
export function scrollToSection(el: HTMLElement): void {
  if (active) active.scrollTo(window.scrollY + el.getBoundingClientRect().top - 72)
  else el.scrollIntoView({ block: 'start', behavior: window.matchMedia(MQ.reduced).matches ? 'auto' : 'smooth' })
}

/** Scroll to a y position through Lenis when it runs, natively otherwise. */
export function scrollToY(y: number): void {
  if (active) active.scrollTo(y, { immediate: true, force: true })
  else window.scrollTo(0, y)
}

/** Lenis smooth scroll, driven by the GSAP ticker so ScrollTrigger stays in sync. Off under reduced motion. */
export function useSmoothScroll(): void {
  useEffect(() => {
    if (!window.matchMedia(MQ.full).matches) return
    const lenis = new Lenis({ autoRaf: false, anchors: { offset: -72 }, lerp: 0.1 })
    lenis.on('scroll', ScrollTrigger.update)
    active = lenis
    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    document.documentElement.classList.add('lenis-on')
    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
      active = null
      document.documentElement.classList.remove('lenis-on')
    }
  }, [])
}

/** Lazy sections and late images change the page height; keep ScrollTrigger positions in step. */
export function useRefreshOnLayoutChange(): void {
  useEffect(() => {
    const main = document.getElementById('main')
    if (!main || typeof ResizeObserver === 'undefined') return
    let last = main.offsetHeight
    let timer = 0
    const ro = new ResizeObserver(() => {
      const h = main.offsetHeight
      if (Math.abs(h - last) < 2) return
      last = h
      window.clearTimeout(timer)
      timer = window.setTimeout(() => ScrollTrigger.refresh(), 150)
    })
    ro.observe(main)
    return () => {
      ro.disconnect()
      window.clearTimeout(timer)
    }
  }, [])
}
