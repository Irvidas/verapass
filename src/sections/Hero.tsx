import { useRef, useState } from 'react'
import { PHUKET_PASS, formatPrice } from '../../shared/pricing'
import { Picture } from '../components/Picture'
import { srcSetFor } from '../lib/images'
import { Magnetic } from '../motion/Magnetic'
import { gsap, MQ, ScrollTrigger, SplitText, useGSAP } from '../motion/gsap'

const SLICES = 7
const IMG = '/images/hero-boat.jpg'
const IMG_SIZES = '(min-width: 900px) 440px, 92vw'
/** What the scan checks: the mechanism, not an AI detector. */
const CHECKS = ['Licensed guide', 'On location, GPS', 'Signed record']
/** When the scan starts, counted from the moment the fake post appears. Until then the cursor (or a finger) can look under the fake. */
const SCAN_AT = 1.1

/** The same photo as a CSS background, best format first. */
const SLICE_BG = (() => {
  const pick = (format: 'avif' | 'webp') => srcSetFor(IMG, format)?.split(', ').pop()?.split(' ')[0]
  const avif = pick('avif')
  const webp = pick('webp')
  return avif && webp ? `image-set(url(${avif}) type("image/avif"), url(${webp}) type("image/webp"), url(${IMG}) type("image/jpeg"))` : `url(${IMG})`
})()

/**
 * Hero, and the intro of the whole site: frame one is an over-processed "AI feed post".
 * On a pointer device the cursor is a loupe that shows the real photo under the glitch.
 * Then a scan line passes, the three checks Verapass relies on tick one by one, and the
 * VERIFIED HUMAN stamp lands on the real person.
 */
export function Hero({ ready }: { ready: boolean }) {
  const root = useRef<HTMLElement>(null)
  const [verdict, setVerdict] = useState<'scanning' | 'real'>('scanning')
  const replay = useRef<(() => void) | null>(null)
  const [canReplay, setCanReplay] = useState(false)

  useGSAP(
    () => {
      const el = root.current
      if (!el || !ready) return
      document.documentElement.classList.remove('intro')
      const mm = gsap.matchMedia()
      mm.add({ full: MQ.full, reduced: MQ.reduced, fine: MQ.finePointer, desktop: '(min-width: 900px)' }, (ctx) => {
        const { full, fine, desktop } = ctx.conditions ?? {}
        const card = el.querySelector<HTMLElement>('.verify-card')
        const slices = el.querySelectorAll('.glitch-slice')
        const base = el.querySelector('.verify-base')
        const clean = el.querySelector<HTMLElement>('.verify-clean')
        const scan = el.querySelector('.verify-scan')
        const noise = el.querySelector('.verify-noise')
        const fake = el.querySelector('.verify-fake')
        const stamp = el.querySelector('.verify-stamp')
        const title = el.querySelector('.hero-title')
        const orbit = el.querySelector('.hero-orbit')
        if (!card || !clean) return

        if (!full) {
          setVerdict('real')
          gsap.set([slices, noise, fake, scan, clean, '.verify-sheen', '.verify-ink'], { autoAlpha: 0 })
          replay.current = null
          setCanReplay(false)
          return
        }

        const checks = el.querySelectorAll('.verify-check')
        const ticks = el.querySelectorAll('.verify-check i')
        const sheen = el.querySelector('.verify-sheen')
        const ink = el.querySelector('.verify-ink')
        let scanning = false

        // Short glitch tears while the fake is up: two or three bands jump sideways for a frame,
        // then the post looks "perfect" again. Killed as soon as the scan starts.
        const flicker = gsap.timeline({ repeat: -1, repeatDelay: 0.55, repeatRefresh: true, paused: true })
        flicker
          .to(slices, {
            x: () => gsap.utils.random(-26, 26),
            autoAlpha: () => (gsap.utils.random(0, 1) > 0.62 ? 0.9 : 0),
            duration: 0.04,
            ease: 'steps(1)',
          })
          .to(slices, { x: () => gsap.utils.random(-8, 8), duration: 0.04, ease: 'steps(1)' }, '+=0.06')
          .to(slices, { x: 0, autoAlpha: 0, duration: 0.04, ease: 'steps(1)' }, '+=0.05')

        // Frame one is the fake: a too-perfect, over-processed feed post with an AI handle.
        const showFake = () => {
          setVerdict('scanning')
          flicker.pause(0)
          gsap.set(slices, { autoAlpha: 0, x: 0 })
          gsap.set(noise, { autoAlpha: 0.5 })
          gsap.set(sheen, { autoAlpha: 1 })
          gsap.set(fake, { autoAlpha: 0, y: 12, scale: 0.96 })
          gsap.set(base, { filter: 'saturate(1.9) contrast(1.18) brightness(1.08) hue-rotate(-14deg) blur(0.6px)' })
          gsap.set(stamp, { autoAlpha: 0, scale: 2.4, rotate: -36 })
          gsap.set(ink, { autoAlpha: 0, scale: 0.6 })
          gsap.set(scan, { top: '-12%', autoAlpha: 0 })
          gsap.set(checks, { autoAlpha: 0, x: -14 })
          gsap.set(ticks, { scale: 0 })
          gsap.set(clean, { autoAlpha: 0, '--r': '0px', clipPath: 'inset(0% 0% 0% 0%)' })
          scanning = false
        }
        showFake()

        // The loupe: a circle of the real photo that follows the pointer while the fake is up.
        const lens = { x: 0, y: 0 }
        const setLens = () => clean.style.setProperty('--lp', `${lens.x}px ${lens.y}px`)
        const lx = gsap.quickTo(lens, 'x', { duration: 0.35, ease: 'power3', onUpdate: setLens })
        const ly = gsap.quickTo(lens, 'y', { duration: 0.35, ease: 'power3', onUpdate: setLens })
        const onMove = (e: PointerEvent) => {
          if (scanning) return
          const r = card.getBoundingClientRect()
          lx(e.clientX - r.left)
          ly(e.clientY - r.top)
          gsap.to(clean, { autoAlpha: 1, '--r': fine ? '110px' : '90px', duration: 0.35, ease: 'power3.out', overwrite: 'auto' })
        }
        const onLeave = () => {
          if (!scanning) gsap.to(clean, { '--r': '0px', duration: 0.3, ease: 'power2.in', overwrite: 'auto' })
        }
        card.addEventListener('pointermove', onMove)
        card.addEventListener('pointerdown', onMove)
        card.addEventListener('pointerleave', onLeave)

        const split = SplitText.create(title, { type: desktop ? 'lines,chars' : 'lines,words', mask: 'lines' })
        const intro = gsap.timeline()
        intro
          .from(desktop ? split.chars : split.words, { yPercent: 120, rotate: 8, duration: 1.1, ease: 'expo.out', stagger: desktop ? 0.016 : 0.05 })
          .from('.hero-copy > *:not(.hero-title)', { y: 30, opacity: 0, duration: 1, ease: 'power3.out', stagger: 0.07 }, 0.3)
          .from(card, { y: 56, scale: 0.92, autoAlpha: 0, duration: 1.3, ease: 'expo.out' }, 0.05)
          .from(base, { scale: 1.28, duration: 1.9, ease: 'expo.out' }, 0.05)
          .from(orbit, { autoAlpha: 0, rotate: -40, duration: 2.4, ease: 'power3.out' }, 0.2)

        // The scan. The fake post pops in and tears now and then; a scan line sweeps down and
        // wipes the real photo in behind it; each check ticks as the line passes; the stamp lands.
        const build = () => {
          showFake()
          const sweep = { p: 0 }
          const drawSweep = () => {
            gsap.set(scan, { top: `${sweep.p * 112 - 12}%` })
            gsap.set(clean, { clipPath: `inset(0% 0% ${100 - sweep.p * 100}% 0%)` })
          }
          const tl = gsap.timeline()
          tl.to(fake, { autoAlpha: 1, y: 0, scale: 1, duration: 0.55, ease: 'back.out(2.2)' }, 0)
            .add(() => flicker.play(0), 0.15)
            // The scan takes over: no more loupe, no more tears.
            .add(() => {
              scanning = true
              flicker.pause()
              gsap.set(slices, { autoAlpha: 0, x: 0 })
            }, SCAN_AT - 0.05)
            .set(clean, { autoAlpha: 1, '--r': '3000px', clipPath: 'inset(0% 0% 100% 0%)' }, SCAN_AT)
            .set(scan, { autoAlpha: 1 }, SCAN_AT)
            .to(sweep, { p: 1, duration: 1.15, ease: 'power2.inOut', onUpdate: drawSweep }, SCAN_AT)
            .to(fake, { autoAlpha: 0, y: -10, duration: 0.25, ease: 'power2.in' }, SCAN_AT + 0.2)
            .to([noise, sheen], { autoAlpha: 0, duration: 0.4 }, SCAN_AT + 0.75)
            .set(base, { filter: 'none' }, SCAN_AT + 1.15)
            .to(scan, { autoAlpha: 0, duration: 0.2 }, SCAN_AT + 1.1)
            // The checks sit low on the card, so they tick as the line reaches them.
            .to(checks, { autoAlpha: 1, x: 0, duration: 0.4, ease: 'expo.out', stagger: 0.09 }, SCAN_AT + 0.78)
            .to(ticks, { scale: 1, duration: 0.3, ease: 'back.out(3)', stagger: 0.09 }, SCAN_AT + 0.86)
            // The stamp: lifted, then slammed down with a ring of ink and a jolt of the card.
            .to(stamp, { autoAlpha: 1, scale: 1, rotate: -12, duration: 0.3, ease: 'power4.in' }, SCAN_AT + 1.15)
            .add(() => setVerdict('real'), SCAN_AT + 1.45)
            .to(ink, { keyframes: [{ autoAlpha: 0.9, scale: 1, duration: 0.01 }, { autoAlpha: 0, scale: 1.7, duration: 0.6, ease: 'power2.out' }] }, SCAN_AT + 1.45)
            .fromTo(card, { y: 5, rotate: -0.6 }, { y: 0, rotate: 0, duration: 0.6, ease: 'elastic.out(1.1, 0.35)', immediateRender: false }, SCAN_AT + 1.45)
          return tl
        }

        // The card is on screen from the first frame on every width (on phones it sits above the copy).
        intro.add(build(), 0.55)
        replay.current = () => build()
        setCanReplay(true)

        // Parallax on the figure, not the card: the card's own scale is used by the intro.
        gsap.to(el.querySelector('.verify'), {
          yPercent: 8,
          scale: 0.94,
          ease: 'none',
          scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: true },
        })
        gsap.to('.hero-copy', {
          yPercent: -12,
          opacity: 0.2,
          ease: 'none',
          scrollTrigger: { trigger: el, start: 'center center', end: 'bottom top', scrub: true },
        })

        // The orbit text turns slowly, faster while the page is scrolling, and stops off screen.
        const spin = gsap.to(orbit, { rotate: '+=360', duration: 90, repeat: -1, ease: 'none' })
        const speed = gsap.quickTo(spin, 'timeScale', { duration: 0.6, ease: 'power2.out' })
        ScrollTrigger.create({
          trigger: el,
          start: 'top top',
          end: 'bottom top',
          onUpdate: (self) => speed(1 + Math.min(12, Math.abs(self.getVelocity()) / 220)),
          onLeave: () => spin.pause(),
          onEnterBack: () => spin.resume(),
        })

        return () => {
          card.removeEventListener('pointermove', onMove)
          card.removeEventListener('pointerdown', onMove)
          card.removeEventListener('pointerleave', onLeave)
          flicker.kill()
          split.revert()
        }
      })
    },
    { scope: root, dependencies: [ready] },
  )

  return (
    <section ref={root} className="hero night" id="top" aria-labelledby="hero-title">
      <svg className="hero-orbit" viewBox="0 0 400 400" aria-hidden="true">
        <defs>
          <path id="orbit-path" d="M200 200 m-180 0 a180 180 0 1 1 360 0 a180 180 0 1 1 -360 0" />
        </defs>
        <text fontSize="13" letterSpacing="7" fill="currentColor">
          <textPath href="#orbit-path">REAL PEOPLE - REAL PLACES - PROVEN ON STELLAR - REAL PEOPLE - REAL PLACES - </textPath>
        </text>
      </svg>
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <p className="eyebrow eyebrow-light">Proof-of-presence travel passport - Phuket pilot</p>
          <h1 id="hero-title" className="hero-title">
            Real people. Real places. <em>Proven.</em>
          </h1>
          <p className="lead">
            AI can fake an influencer, a review and a beach that does not exist. It cannot stand on the sand. Verapass shows
            you places picked by verified local humans, and you can only collect a place when you are really there.
          </p>
          <div className="ctas">
            <Magnetic>
              <a href="#map" className="btn btn-coral" data-cursor="Try">
                Try a check-in <span aria-hidden="true">-&gt;</span>
              </a>
            </Magnetic>
            <a href="#pricing" className="btn btn-ghost-light">
              Get the Phuket pass, {formatPrice(PHUKET_PASS.amount, PHUKET_PASS.currency)}
            </a>
          </div>
          <div className="proof">
            <span className="mini-stamp" aria-hidden="true">
              TAT
              <br />
              LICENSED
            </span>
            <p>
              <b>Starting with Sukanya,</b> a licensed local guide in Phuket. A real person, not AI.
            </p>
          </div>
        </div>

        <figure className="verify">
          <div className="verify-card" data-cursor={verdict === 'real' ? 'Real' : 'Look'}>
            <Picture
              className="verify-base"
              src={IMG}
              sizes={IMG_SIZES}
              alt="Sukanya, a licensed Phuket guide, standing on the bow of a boat in the Andaman Sea with her arms open"
              loading="eager"
              fetchPriority="high"
            />
            {Array.from({ length: SLICES }, (_, i) => (
              <span
                key={i}
                className="glitch-slice"
                aria-hidden="true"
                style={{
                  backgroundImage: SLICE_BG,
                  clipPath: `inset(${(i * 100) / SLICES}% 0 ${100 - ((i + 1) * 100) / SLICES}% 0)`,
                }}
              />
            ))}
            <span className="verify-noise" aria-hidden="true" />
            <span className="verify-sheen" aria-hidden="true" />
            <span className="verify-clean" aria-hidden="true" style={{ backgroundImage: SLICE_BG }} />
            <span className="verify-scan" aria-hidden="true" />
            <span className="verify-fake" aria-hidden="true">
              <b>@paradise.ai.dreams</b>
              <small>Sponsored - generated image</small>
            </span>
            <ul className="verify-checks" aria-hidden="true">
              {CHECKS.map((c) => (
                <li key={c} className="verify-check">
                  <i>
                    <svg viewBox="0 0 16 16" width="10" height="10">
                      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </i>
                  {c}
                </li>
              ))}
            </ul>
            <span className="verify-ink" aria-hidden="true" />
            <span className="verify-stamp" aria-hidden="true">
              <svg viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="56" fill="none" stroke="currentColor" strokeWidth="4" />
                <circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
                <text x="60" y="52" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor" letterSpacing="1.5">
                  VERIFIED
                </text>
                <text x="60" y="72" textAnchor="middle" fontSize="18" fontWeight="800" fill="currentColor">
                  HUMAN
                </text>
                <text x="60" y="88" textAnchor="middle" fontSize="8" fill="currentColor" letterSpacing="1">
                  TAT LICENCE
                </text>
              </svg>
            </span>
          </div>
          <figcaption className="verify-caption">
            <span className={`verdict verdict-${verdict}`} aria-live="polite">
              <i aria-hidden="true" />
              {verdict === 'real' ? 'Real person, licensed guide, on location' : 'Scanning: AI-generated or real?'}
            </span>
            {canReplay && (
              <button type="button" className="link-btn" onClick={() => replay.current?.()}>
                Scan again
              </button>
            )}
          </figcaption>
          <p className="verify-note">
            Illustration: the handle above is made up to show what a generated feed post looks like.{' '}
            <span className="loupe-hint">Move over the photo to see what is under the filter.</span>
          </p>
        </figure>
      </div>
      <a href="#problem" className="scroll-cue" aria-label="Scroll to the problem">
        <span aria-hidden="true" />
      </a>
    </section>
  )
}
