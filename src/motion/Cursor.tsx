import { useEffect, useRef } from 'react'
import { gsap, MQ } from './gsap'

const INTERACTIVE = 'a, button, summary, [data-cursor]'

/** Desktop-only cursor: a dot plus a lagging ring that grows over anything clickable. */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const mq = window.matchMedia(MQ.finePointer)
    if (!mq.matches || !dot.current || !ring.current) return
    const root = document.documentElement
    root.classList.add('has-cursor')
    const dx = gsap.quickTo(dot.current, 'x', { duration: 0.08, ease: 'power3' })
    const dy = gsap.quickTo(dot.current, 'y', { duration: 0.08, ease: 'power3' })
    const rx = gsap.quickTo(ring.current, 'x', { duration: 0.45, ease: 'power3' })
    const ry = gsap.quickTo(ring.current, 'y', { duration: 0.45, ease: 'power3' })
    gsap.set([dot.current, ring.current], { xPercent: -50, yPercent: -50, autoAlpha: 0 })

    const move = (e: PointerEvent) => {
      gsap.to([dot.current, ring.current], { autoAlpha: 1, duration: 0.2, overwrite: 'auto' })
      dx(e.clientX)
      dy(e.clientY)
      rx(e.clientX)
      ry(e.clientY)
    }
    const over = (e: PointerEvent) => {
      const target = (e.target as Element | null)?.closest?.(INTERACTIVE)
      const text = target?.getAttribute('data-cursor') ?? ''
      if (label.current) label.current.textContent = text
      gsap.to(ring.current, { scale: target ? (text ? 2.6 : 1.8) : 1, duration: 0.35, ease: 'power3.out' })
      ring.current?.classList.toggle('is-label', Boolean(text))
    }
    const leave = () => gsap.to([dot.current, ring.current], { autoAlpha: 0, duration: 0.2 })
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerover', over, { passive: true })
    document.addEventListener('pointerleave', leave)
    return () => {
      root.classList.remove('has-cursor')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerover', over)
      document.removeEventListener('pointerleave', leave)
    }
  }, [])

  return (
    <div aria-hidden="true">
      <div ref={dot} className="cursor-dot" />
      <div ref={ring} className="cursor-ring">
        <span ref={label} className="cursor-label" />
      </div>
    </div>
  )
}
