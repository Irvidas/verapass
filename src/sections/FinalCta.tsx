import { useRef } from 'react'
import { gsap } from '../motion/gsap'
import { Magnetic } from '../motion/Magnetic'
import { useSectionMotion } from '../motion/useSectionMotion'

const WORDS = ['Real people', 'Real places', 'Proven']

export function FinalCta() {
  const root = useRef<HTMLElement>(null)
  useSectionMotion(root, (full, el) => {
    if (!full) return
    el.querySelectorAll<HTMLElement>('.marquee-row').forEach((row, i) => {
      gsap.fromTo(
        row,
        { xPercent: i % 2 ? -25 : 0 },
        { xPercent: i % 2 ? 0 : -25, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.5 } },
      )
    })
  })
  const line = Array.from({ length: 4 }, () => WORDS).flat()
  return (
    <section ref={root} className="final night" aria-labelledby="final-title">
      <div className="marquee" aria-hidden="true">
        {[0, 1].map((r) => (
          <div key={r} className="marquee-row">
            {line.map((w, i) => (
              // The words are drawn by CSS (::before), so this decoration holds no text for readers or checkers.
              <span key={i} data-text={w}>
                <i />
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="wrap final-inner">
        <h2 id="final-title" className="display" data-split>
          Your Phuket, without the fakes.
        </h2>
        <p data-reveal>Arrive like you already have a local friend on the island, and come home with a passport that proves it.</p>
        <div className="ctas center" data-reveal>
          <Magnetic>
            <a href="#pricing" className="btn btn-sand btn-big" data-cursor="Go">
              Get the Phuket pass
            </a>
          </Magnetic>
          <a href="#map" className="btn btn-ghost-light">
            Try a check-in first
          </a>
        </div>
      </div>
    </section>
  )
}
