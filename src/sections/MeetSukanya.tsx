import { useRef } from 'react'
import { Icon, type IconName } from '../components/icons'
import { Picture } from '../components/Picture'
import { gsap, PLAY_ONCE } from '../motion/gsap'
import { useSectionMotion } from '../motion/useSectionMotion'

const DAYS = [
  { src: '/images/elephant-day.jpg', caption: 'elephant day', alt: 'Sukanya standing between two elephants at a sanctuary' },
  { src: '/images/bamboo-raft.jpg', caption: 'bamboo raft', alt: 'Sukanya taking a selfie with guests on a bamboo raft on a lake' },
  { src: '/images/jungle-atv.jpg', caption: 'jungle ATV', alt: 'Sukanya taking a selfie with a group of guests on jungle ATVs' },
]

const CHIPS: { icon: IconName; text: string }[] = [
  { icon: 'pin', text: 'Phuket local' },
  { icon: 'badge', text: 'TAT licensed guide' },
  { icon: 'compass', text: '5+ years guiding' },
  { icon: 'speech', text: 'Thai and English' },
]

const CHECKS = [
  { title: 'Tourism Authority of Thailand licence', note: 'Checked by Verapass against the licence card. Only a hash goes on chain.', state: 'Pilot' },
  { title: 'Identity behind the payouts', note: 'Guides who earn will onboard through Stripe Connect, which includes identity checks. Paying out to a bank in Thailand needs a platform setup we are still choosing.', state: 'Planned' },
  { title: 'Creator attestation on Stellar', note: 'A signed record that this creator is a verified human, readable by anyone.', state: 'Building' },
]

/** Nested, slightly wobbly rings, like a fingerprint or the contour lines of a hill. Deterministic. */
function contourPaths(cx: number, cy: number, rings: number): string[] {
  return Array.from({ length: rings }, (_, r) => {
    const base = 14 + r * 11
    const points = Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2
      const wobble = 1 + 0.06 * Math.sin(a * 3 + r * 0.9) + 0.035 * Math.sin(a * 5 - r * 1.7)
      const x = cx + Math.cos(a) * base * wobble * 0.82
      const y = cy + Math.sin(a) * base * wobble
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    return `${points.join(' ')} Z`
  })
}

const CONTOURS = contourPaths(128, 96, 9)

export function MeetSukanya() {
  const root = useRef<HTMLElement>(null)

  // The "verified human" moment: contour lines trace over her face like a fingerprint read,
  // a stamp presses, then her signature writes itself.
  useSectionMotion(root, (full, el) => {
    if (!full) return
    const portrait = el.querySelector('.meet-portrait')
    const tl = gsap.timeline({ scrollTrigger: { trigger: portrait, start: 'top 70%', ...PLAY_ONCE } })
    tl.from(el.querySelectorAll('.contours path'), { drawSVG: '50% 50%', duration: 1.1, ease: 'power2.inOut', stagger: 0.07 }, 0.5)
      .to(el.querySelector('.contours'), { opacity: 0, duration: 0.8, ease: 'power1.in' }, '+=0.15')
      .fromTo(el.querySelector('.meet-verified'), { scale: 2.6, rotate: -40, autoAlpha: 0 }, { scale: 1, rotate: -12, autoAlpha: 1, duration: 0.3, ease: 'power4.in' }, '<')
      .fromTo(portrait, { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.3)', immediateRender: false })
    gsap.from(el.querySelector('.meet-polaroid'), {
      rotate: 18,
      x: -60,
      y: 40,
      opacity: 0,
      duration: 1.2,
      ease: 'expo.out',
      scrollTrigger: { trigger: el.querySelector('.meet-photos'), start: 'top 60%', ...PLAY_ONCE },
    })
    gsap.from(el.querySelectorAll('.check-row'), {
      x: -30,
      opacity: 0,
      duration: 0.8,
      stagger: 0.12,
      ease: 'power3.out',
      scrollTrigger: { trigger: el.querySelector('.checks'), start: 'top 85%', ...PLAY_ONCE },
    })
    const sig = el.querySelector('.sig text')
    if (sig) {
      gsap
        .timeline({ scrollTrigger: { trigger: sig, start: 'top 92%', ...PLAY_ONCE } })
        .fromTo(sig, { strokeDashoffset: 420 }, { strokeDashoffset: 0, duration: 1.6, ease: 'power1.inOut' })
        .fromTo(sig, { fillOpacity: 0 }, { fillOpacity: 1, duration: 0.5 }, '-=0.4')
    }
  })

  return (
    <section ref={root} id="sukanya" className="meet paper" aria-labelledby="meet-title">
      <div className="wrap meet-grid">
        <div className="meet-photos">
          <div className="meet-portrait" data-mask>
            <Picture
              src="/images/khao-sok-lake.jpg"
              sizes="(min-width: 900px) 34vw, 70vw"
              alt="Sukanya, smiling, sitting on a bamboo raft on the green water of Khao Sok lake"
            />
            <svg className="contours" viewBox="0 0 224 280" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
              {CONTOURS.map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
            <span className="meet-verified" aria-hidden="true">
              VERIFIED
              <br />
              HUMAN
            </span>
          </div>
          <figure className="meet-polaroid">
            <span className="tape" aria-hidden="true" />
            <Picture src="/images/wat-chalong.jpg" sizes="(min-width: 900px) 18vw, 40vw" alt="Sukanya with a guest in front of the Wat Chalong pagoda" />
            <figcaption className="hand">at work, Wat Chalong</figcaption>
          </figure>
          <p className="hand meet-note" aria-hidden="true">
            a real person,
            <br />
            not AI!
          </p>
        </div>

        <div className="meet-copy">
          <p className="eyebrow" data-reveal>
            Meet the verified human
          </p>
          <h2 id="meet-title" className="display" data-split>
            Sawasdee ka! I am the real person behind every pin.
          </h2>
          <p data-reveal>
            I am Sukanya, a licensed Tourism Authority of Thailand guide. For more than five years I have shown travellers
            around Phuket, and I see them pay too much for the wrong things every day.
          </p>
          <p data-reveal>
            Every place in Verapass is one I have stood at myself, with my own notes on when to go, what to pay and what to
            skip. No generated photos. No places that are not there.
          </p>
          <ul className="chips" data-reveal>
            {CHIPS.map((c) => (
              <li key={c.text}>
                <Icon name={c.icon} size={18} />
                {c.text}
              </li>
            ))}
          </ul>
          <div className="checks" role="group" aria-label="How Sukanya is verified">
            {CHECKS.map((c) => (
              <div key={c.title} className="check-row">
                <span className="check-tick" aria-hidden="true">
                  <Icon name="check" size={18} strokeWidth={2.5} />
                </span>
                <span>
                  <b>{c.title}</b>
                  <small>{c.note}</small>
                </span>
                <em className={`state state-${c.state.toLowerCase()}`}>{c.state}</em>
              </div>
            ))}
          </div>
          <svg className="sig" viewBox="0 0 220 70" aria-hidden="true">
            <text x="4" y="52">
              Sukanya
            </text>
          </svg>
        </div>
      </div>

      <div className="wrap days" role="group" aria-label="Real days with Sukanya's guests">
        {DAYS.map((d) => (
          <figure key={d.src} className="day" data-mask>
            <Picture src={d.src} alt={d.alt} sizes="(min-width: 1240px) 400px, 31vw" />
            <figcaption className="hand">{d.caption}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
