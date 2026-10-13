import { useRef } from 'react'
import { gsap, PLAY_ONCE, ScrollTrigger } from '../motion/gsap'
import { useSectionMotion } from '../motion/useSectionMotion'

const STEPS = [
  {
    n: '01',
    title: 'Be there',
    text: "Pick a place from Sukanya's map and go. No shortcut: the place does not care how many followers you have.",
    icon: <path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z M12 7.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5" />,
  },
  {
    n: '02',
    title: 'Check in with GPS proof',
    text: 'Your phone asks the server for a one-time code, then sends its GPS fix. The server checks the geofence, the accuracy, the 2-minute window and how fast you travelled since your last stamp.',
    icon: <path d="M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 1 0 8a4 4 0 1 1 0-8" />,
  },
  {
    n: '03',
    title: 'Collect a stamp on Stellar',
    text: 'The server signs a receipt and records a hash of the proof on Stellar. Your raw location stays off chain, and you keep what is needed to check the stamp yourself.',
    icon: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z M8 12l3 3 5-6" />,
  },
  {
    n: '04',
    title: 'Real visits validate places and creators',
    text: 'Every check-in is a real-visitor record. Places and the guides who published them build a track record no AI persona can copy.',
    icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  },
]

/** A wavy route through the centre of every icon disc, in the coordinates of the steps box. */
function routeThrough(points: { x: number; y: number }[]): string {
  return points.reduce((d, p, i) => {
    if (i === 0) return `M${p.x} ${p.y}`
    const prev = points[i - 1] ?? p
    const dx = (p.x - prev.x) / 2
    const lift = i % 2 ? -26 : 26
    return `${d} C${prev.x + dx * 0.6} ${prev.y + lift}, ${p.x - dx * 0.6} ${p.y + lift}, ${p.x} ${p.y}`
  }, '')
}

export function HowItWorks() {
  const root = useRef<HTMLElement>(null)

  useSectionMotion(root, (full, el) => {
    if (!full) return
    const steps = el.querySelector<HTMLElement>('.how-steps')
    const svg = el.querySelector<SVGSVGElement>('.how-line')
    const path = el.querySelector<SVGPathElement>('.how-line path')
    const dot = el.querySelector<SVGCircleElement>('.how-dot')
    const discs = Array.from(el.querySelectorAll<HTMLElement>('.how-icon'))
    let layoutRef: (() => void) | null = null

    // One continuous route through the disc centres, drawn as you scroll, with a traveller on it.
    if (steps && svg && path && dot && window.matchMedia('(min-width: 1000px)').matches) {
      const layout = () => {
        // Offsets, not bounding boxes: the steps may be mid-entrance (moved by a transform).
        svg.setAttribute('viewBox', `0 0 ${steps.clientWidth} ${steps.clientHeight}`)
        const centres = discs.map((d) => {
          const step = d.offsetParent as HTMLElement | null
          return {
            x: (step?.offsetLeft ?? 0) + d.offsetLeft + d.offsetWidth / 2,
            y: (step?.offsetTop ?? 0) + d.offsetTop + d.offsetHeight / 2,
          }
        })
        path.setAttribute('d', routeThrough(centres))
      }
      layout()
      layoutRef = layout
      ScrollTrigger.addEventListener('refreshInit', layout)
      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: steps, start: 'top 70%', end: 'bottom 60%', scrub: true, invalidateOnRefresh: true },
      })
      tl.fromTo(path, { drawSVG: '0%' }, { drawSVG: '100%', duration: 1 }, 0)
        .fromTo(dot, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05 }, 0)
        .to(dot, { motionPath: { path, align: path, alignOrigin: [0.5, 0.5] }, duration: 1 }, 0)
      // The disc pulses as the traveller reaches it (the discs sit evenly along the route).
      discs.forEach((disc, i) => {
        const glyph = disc.querySelector('svg')
        tl.fromTo(glyph, { scale: 1 }, { scale: 1.25, duration: 0.05, yoyo: true, repeat: 1, ease: 'power2.out' }, Math.max(0, i / (discs.length - 1) - 0.05))
      })
    }
    el.querySelectorAll('.how-step').forEach((step) => {
      const tl = gsap.timeline({ scrollTrigger: { trigger: step, start: 'top 82%', ...PLAY_ONCE } })
      tl.from(step, { y: 60, opacity: 0, duration: 1, ease: 'power3.out' })
        .from(step.querySelector('.how-icon'), { scale: 0.2, rotate: -90, duration: 0.8, ease: 'back.out(2)' }, 0.2)
        .from(step.querySelector('.how-icon path'), { drawSVG: 0, duration: 1.2, ease: 'power2.inOut' }, 0.3)
    })
    return () => {
      if (layoutRef) ScrollTrigger.removeEventListener('refreshInit', layoutRef)
    }
  })

  return (
    <section ref={root} id="how" className="how paper" aria-labelledby="how-title">
      <div className="wrap">
        <div className="head">
          <div>
            <p className="eyebrow" data-reveal>
              How it works
            </p>
            <h2 id="how-title" className="display" data-split>
              No proof, no stamp.
            </h2>
          </div>
          <p data-reveal>
            Four steps from a pin on a map to a visit that anyone can check. The traveller never needs a crypto wallet or any
            XLM to take part.
          </p>
        </div>

        <div className="how-steps">
          <svg className="how-line" aria-hidden="true">
            <path fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            <circle className="how-dot" r="7" cx="0" cy="0" />
          </svg>
          <ol>
            {STEPS.map((s) => (
              <li key={s.n} className="how-step">
                <span className="how-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    {s.icon}
                  </svg>
                </span>
                <span className="how-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="honest" data-reveal>
          <article className="honest-card">
            <h3>
              <span className="pill pill-stripe">Stripe</span> Money moves through Stripe
            </h3>
            <ul>
              <li>Travellers pay by card in Stripe Checkout (a Checkout Session in payment mode). The pilot runs in test mode.</li>
              <li>The pass is activated by Stripe's signed webhook (or a direct lookup of the Checkout Session), never by the success page URL, and it only opens for the passport that paid.</li>
              <li>Guides are paid through Stripe Connect: Verapass keeps a platform fee, the rest goes to the creator.</li>
              <li>Stripe moves money. It does not write anything to Stellar, so our server records the stamp after the webhook.</li>
            </ul>
          </article>
          <article className="honest-card">
            <h3>
              <span className="pill pill-stellar">Stellar</span> Proof lives on Stellar
            </h3>
            <ul>
              <li>Each valid check-in becomes a signed receipt and an on-chain record of its proof hash.</li>
              <li>
                Anyone can check a stamp on the <a href="/verify">verify page</a>: it recomputes the hash and checks the signatures in the browser.
              </li>
              <li>Target design: a Soroban contract with non-transferable stamps that only the Verapass attestor can mint.</li>
              <li>Fees are paid by the server, so travellers do not need XLM. Demo (simulated) visits are never written on chain.</li>
            </ul>
          </article>
          <article className="honest-card honest-limits">
            <h3>What GPS cannot prove</h3>
            <p>
              A web page cannot prove a GPS fix is real: developer tools and mock-location apps can fake it, and a script can
              send any coordinates it likes. The server makes that slow and visible: one-time codes expire in 2 minutes, fixes
              rougher than 100 m are refused, trips faster than 250 km/h are refused, and each connection gets a limited
              number of passport ids and check-ins. The real fix is next on the list: a rotating code shown on site or by the
              guide, and check-ins signed by the traveller's own wallet.
            </p>
          </article>
        </div>
      </div>
    </section>
  )
}
