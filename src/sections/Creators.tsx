import { useRef } from 'react'
import { gsap, PLAY_ONCE } from '../motion/gsap'
import { useSectionMotion } from '../motion/useSectionMotion'

const STEPS = [
  { n: '1', title: 'Get verified', text: 'Show your guide licence and go through Stripe Connect onboarding. A verified-human record is written for you on Stellar.' },
  { n: '2', title: 'Publish places', text: 'Pin the places you actually take guests to, with a check-in point, a radius and your own notes.' },
  { n: '3', title: 'Earn from real visits', text: 'When a traveller buys your pass, Stripe splits the payment: your share goes to your connected account, Verapass keeps a platform fee.' },
  { n: '4', title: 'Build a record AI cannot copy', text: 'Each check-in at one of your places is a real-visitor attestation. Your reputation is counted in visits, not followers.' },
]

export function Creators() {
  const root = useRef<HTMLElement>(null)
  useSectionMotion(root, (full, el) => {
    if (!full) return
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.6, scrollTrigger: { trigger: el.querySelector('.flow'), start: 'top 80%', toggleActions: 'play pause resume pause' } })
    tl.fromTo('.flow-coin', { left: '2%', autoAlpha: 0 }, { left: '96%', autoAlpha: 1, duration: 2.2, ease: 'power1.inOut', stagger: 0.5 })
    gsap.from(el.querySelectorAll('.creator-step'), {
      y: 50,
      opacity: 0,
      stagger: 0.12,
      duration: 0.9,
      ease: 'power3.out',
      scrollTrigger: { trigger: el.querySelector('.creator-steps'), start: 'top 85%', ...PLAY_ONCE },
    })
  })

  return (
    <section ref={root} id="guides" className="creators night-deep" aria-labelledby="guides-title">
      <div className="wrap">
        <div className="head">
          <div>
            <p className="eyebrow eyebrow-light" data-reveal>
              For local guides and creators
            </p>
            <h2 id="guides-title" className="display" data-split>
              Get verified. Publish places. Earn when real people arrive.
            </h2>
          </div>
          <p data-reveal>
            Sukanya is the first. Verapass is built so that any licensed guide or honest local creator can join, and be paid for
            the visits they cause, not for the attention they farm.
          </p>
        </div>

        <ol className="creator-steps">
          {STEPS.map((s) => (
            <li key={s.n} className="creator-step">
              <span className="creator-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>

        <div className="flow" aria-label="How a payment is split" role="img">
          <div className="flow-node">
            <b>Traveller</b>
            <small>pays by card</small>
          </div>
          <div className="flow-node flow-stripe">
            <b>Stripe Checkout</b>
            <small>destination charge</small>
          </div>
          <div className="flow-split">
            <div className="flow-node">
              <b>Guide</b>
              <small>connected account</small>
            </div>
            <div className="flow-node">
              <b>Verapass</b>
              <small>application fee</small>
            </div>
          </div>
          <svg className="flow-path" viewBox="0 0 600 60" preserveAspectRatio="none" aria-hidden="true">
            <path d="M10 30 H590" stroke="currentColor" strokeDasharray="4 6" fill="none" />
          </svg>
          <span className="flow-coin" aria-hidden="true" />
          <span className="flow-coin" aria-hidden="true" />
          <span className="flow-coin" aria-hidden="true" />
        </div>

        <p className="fineprint creators-note" data-reveal>
          Being straight about payouts: Stripe's self-serve cross-border payouts from an EU platform do not reach Thailand yet, so
          live payouts to Thai guides need a different Stripe setup that we are choosing during the pilot. Until then everything
          runs in Stripe test mode. Stablecoin payouts in USDC on Stellar exist at Stripe, but only for some regions today.
        </p>
      </div>
    </section>
  )
}
