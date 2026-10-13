import { useEffect, useRef, useState } from 'react'
import { gsap, MQ } from '../motion/gsap'
import { lockScroll, scrollToSection } from '../motion/SmoothScroll'
import { Logo } from './Logo'

const LINKS = [
  { href: '#problem', label: 'The problem' },
  { href: '#how', label: 'How it works' },
  { href: '#map', label: 'Try a check-in' },
  { href: '#passport', label: 'Passport' },
  { href: '#guides', label: 'For guides' },
  { href: '#market', label: 'Market' },
]

/** Everything outside the open menu: made inert, so Tab cannot reach content hidden behind it. */
const BEHIND_MENU = ['#main', 'footer', '#passport-dock-region', '.skip-link']

export function Nav() {
  const [open, setOpen] = useState(false)
  const [solid, setSolid] = useState(false)
  const bar = useRef<HTMLElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = bar.current
    if (!el) return
    let lastY = window.scrollY
    const show = () => gsap.to(el, { yPercent: 0, duration: 0.45, ease: 'power3.out', overwrite: 'auto' })
    const onScroll = () => {
      const y = window.scrollY
      setSolid(y > window.innerHeight * 0.75)
      // Hides on the way down, unless keyboard focus is inside the bar.
      if (window.matchMedia(MQ.full).matches && !el.contains(document.activeElement)) {
        const hide = y > lastY && y > 400
        gsap.to(el, { yPercent: hide ? -110 : 0, duration: 0.45, ease: 'power3.out', overwrite: 'auto' })
      }
      lastY = y
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('focusin', show)
    return () => {
      window.removeEventListener('scroll', onScroll)
      el.removeEventListener('focusin', show)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const items = menu.current?.querySelectorAll('a')
    // Opacity, not visibility: a link hidden with visibility cannot take focus.
    if (items && window.matchMedia(MQ.full).matches) {
      gsap.from(items, { yPercent: 120, opacity: 0, duration: 0.7, ease: 'expo.out', stagger: 0.05 })
    }
    items?.[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggle.current?.focus()
        return
      }
      // Tab cycles through the bar and the menu only.
      if (e.key !== 'Tab' || !bar.current) return
      const stops = Array.from(bar.current.querySelectorAll<HTMLElement>('a[href], button')).filter((n) => n.offsetParent !== null)
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    const behind = BEHIND_MENU.flatMap((sel) => Array.from(document.querySelectorAll<HTMLElement>(sel)))
    behind.forEach((node) => (node.inert = true))
    const unlock = lockScroll()
    document.addEventListener('keydown', onKey)
    document.documentElement.classList.add('menu-open')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('menu-open')
      behind.forEach((node) => (node.inert = false))
      unlock()
    }
  }, [open])

  return (
    <header ref={bar} className={`nav ${solid ? 'is-solid' : ''} ${open ? 'is-open' : ''}`}>
      <div className="wrap nav-row">
        <a href="#top" className="nav-logo" aria-label="Verapass, back to top">
          <Logo />
        </a>
        <nav aria-label="Main">
          <ul className="nav-links">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <a href="#pricing" className="btn btn-small btn-sand nav-cta">
          Get the pass
        </a>
        <button
          ref={toggle}
          type="button"
          className="nav-toggle"
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          <span aria-hidden="true" className="burger" />
        </button>
      </div>
      <div id="mobile-menu" ref={menu} className="mobile-menu" hidden={!open}>
        <ul>
          {[...LINKS, { href: '#pricing', label: 'Get the Phuket pass' }].map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                onClick={(e) => {
                  // Close first (which unlocks scrolling), then scroll to the section.
                  e.preventDefault()
                  setOpen(false)
                  const target = document.getElementById(l.href.slice(1))
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                      if (!target) return
                      history.replaceState(null, '', l.href)
                      scrollToSection(target)
                    }),
                  )
                }}
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </header>
  )
}
