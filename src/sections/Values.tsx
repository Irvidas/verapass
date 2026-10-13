import { useRef, useState } from 'react'
import { Icon, type IconName } from '../components/icons'
import { gsap, MQ, PLAY_ONCE, useGSAP } from '../motion/gsap'
import { useSectionMotion } from '../motion/useSectionMotion'

/** The founders' seven product values (source/brief.md), in their order. */
const VALUES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'compass', title: 'Find the hidden places', text: "Phuket's best beaches, nature corners and spots that are not yet flooded with tourists." },
  { icon: 'palm', title: 'See the real Phuket', text: 'The famous stops, and also how people on the island actually live.' },
  { icon: 'shield', title: 'Skip the scams', text: 'Practical tips so you do not overpay and do not end up in a bad situation.' },
  { icon: 'backpack', title: 'Prepare for your kind of trip', text: 'Recommendations by trip and activity type: rest, adventure, family, food, nature and more.' },
  { icon: 'eye', title: "A local guide's eyes", text: 'Based on more than five years of working with tourists and the real situations travellers hit in Phuket.' },
  { icon: 'map', title: 'An interactive map', text: 'See every recommended place on one map and mark the ones you have already visited.' },
  { icon: 'pin', title: 'Marked only when you are there', text: 'A place in your passport can only be stamped when you physically arrive. Your passport is a true record of your trip.' },
]

export function Values() {
  const root = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)

  useSectionMotion(root)

  useGSAP(
    () => {
      const el = root.current
      if (!el) return
      const mm = gsap.matchMedia()
      // Desktop: the section pins and the seven promises cross-fade in place, one per scroll step.
      mm.add(MQ.desktopFull, () => {
        const items = gsap.utils.toArray<HTMLElement>('.value', el)
        const icons = items.map((item) => item.querySelector('.value-icon svg'))
        gsap.set(items.slice(1), { autoAlpha: 0, yPercent: 30 })
        const tl = gsap.timeline({
          defaults: { ease: 'power2.inOut', duration: 1 },
          scrollTrigger: {
            trigger: el.querySelector('.values-grid'),
            start: 'center center',
            end: '+=250%',
            pin: true,
            scrub: 0.8,
            onUpdate: (self) => setActive(Math.min(items.length - 1, Math.round(self.progress * (items.length - 1)))),
          },
        })
        items.forEach((item, i) => {
          if (i === 0) return
          tl.to(items[i - 1] ?? [], { autoAlpha: 0, yPercent: -30 }, i - 1).to(item, { autoAlpha: 1, yPercent: 0 }, i - 1)
          const icon = icons[i]
          if (icon) tl.from(icon.querySelectorAll('path, circle, rect, ellipse'), { drawSVG: 0, duration: 0.8, stagger: 0.05 }, i - 0.7)
        })
        tl.fromTo(el.querySelector('.values-progress i'), { scaleY: 1 / items.length }, { scaleY: 1, ease: 'none', duration: items.length - 1 }, 0)
      })
      mm.add('(prefers-reduced-motion: no-preference) and (max-width: 899.98px)', () => {
        gsap.utils.toArray<HTMLElement>('.value', el).forEach((item) => {
          gsap.from(item, { y: 40, opacity: 0, duration: 0.9, ease: 'power3.out', scrollTrigger: { trigger: item, start: 'top 88%', ...PLAY_ONCE } })
        })
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} id="values" className="values sand" aria-labelledby="values-title">
      <div className="wrap values-grid">
        <div className="values-sticky">
          <p className="eyebrow" data-reveal>
            What travellers get
          </p>
          <h2 id="values-title" className="display" data-split>
            Seven promises, one island.
          </h2>
          <div className="values-counter" aria-hidden="true">
            <span className="values-num" key={active}>
              {String(active + 1).padStart(2, '0')}
            </span>
            <span className="values-total">/ 07</span>
          </div>
          <div className="values-progress" aria-hidden="true">
            <i />
          </div>
        </div>
        <ol className="values-list">
          {VALUES.map((v, i) => (
            <li key={v.title} className={`value ${i === active ? 'is-active' : ''}`}>
              <span className="value-icon">
                <Icon name={v.icon} size={32} />
              </span>
              <div className="value-body">
                <span className="value-index">{String(i + 1).padStart(2, '0')}</span>
                <h3>{v.title}</h3>
                <p>{v.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
