import { useRef } from 'react'
import { PROBLEM_STATS, PROBLEM_STORIES, type ProblemStat } from '../data/stats'
import { gsap, MQ, PLAY_ONCE, useGSAP } from '../motion/gsap'
import { scrollToY } from '../motion/SmoothScroll'
import { useSectionMotion } from '../motion/useSectionMotion'

function formatStat(s: ProblemStat, v: number): string {
  return `${s.prefix ?? ''}${v.toFixed(s.decimals ?? 0)}${s.suffix ?? ''}`
}

export function Problem() {
  const root = useRef<HTMLElement>(null)
  const track = useRef<HTMLDivElement>(null)

  useSectionMotion(root, (full) => {
    if (full) {
      gsap.to('.problem-word', {
        duration: 1.6,
        scrambleText: { text: 'generated.', chars: '01#%&@AI', revealDelay: 0.4, speed: 0.6 },
        scrollTrigger: { trigger: '.problem-word', start: 'top 85%', ...PLAY_ONCE },
      })
    }
  })

  // Counters and card entrances. On desktop the whole block pins at the top of the screen and the
  // cards scroll sideways, so each card reacts when it enters horizontally (containerAnimation).
  useGSAP(
    () => {
      const el = root.current
      const t = track.current
      const pinned = el?.querySelector<HTMLElement>('.problem-pin')
      if (!el || !t || !pinned) return
      const countUp = (node: HTMLElement, scrollTrigger: ScrollTrigger.Vars) => {
        const stat = PROBLEM_STATS[Number(node.dataset.count)]
        if (!stat) return
        const o = { v: 0 }
        gsap.to(o, {
          v: stat.value,
          duration: 1.6,
          ease: 'power3.out',
          scrollTrigger,
          onUpdate: () => {
            node.textContent = formatStat(stat, o.v)
          },
        })
      }
      const cards = Array.from(t.querySelectorAll<HTMLElement>('.evidence'))
      const mm = gsap.matchMedia()

      mm.add(MQ.desktopFull, () => {
        const inner = t.querySelector<HTMLElement>('.track-inner')
        const distance = () => Math.max(0, t.scrollWidth - t.clientWidth)
        const slide = gsap.to(inner, {
          x: () => -distance(),
          ease: 'none',
          scrollTrigger: {
            trigger: pinned,
            start: 'top top',
            end: () => `+=${distance()}`,
            pin: true,
            scrub: 0.6,
            invalidateOnRefresh: true,
          },
        })
        gsap.fromTo(
          t.querySelector('.track-progress i'),
          { scaleX: 0 },
          { scaleX: 1, ease: 'none', scrollTrigger: { trigger: pinned, start: 'top top', end: () => `+=${distance()}`, scrub: true } },
        )
        cards.forEach((card, i) => {
          // Cards already on screen when the pin starts enter with the row; the rest as they slide in.
          const inView = card.offsetLeft + card.offsetWidth * 0.5 < t.clientWidth
          const enter = inView
            ? { trigger: t, start: 'top 85%', ...PLAY_ONCE }
            : { trigger: card, containerAnimation: slide, start: 'left 92%', ...PLAY_ONCE }
          // Opacity and a sideways drift only: rotating serif text blurs it mid-move.
          gsap.from(card, {
            y: inView ? 60 : 0,
            xPercent: inView ? 0 : 18,
            opacity: 0,
            duration: 0.9,
            delay: inView ? i * 0.09 : 0,
            ease: 'expo.out',
            scrollTrigger: enter,
          })
          const num = card.querySelector<HTMLElement>('[data-count]')
          if (num) countUp(num, enter)
        })

        // Keyboard: the row is moved with a transform, so a focused link in a card that has not
        // slid in yet would be invisible, and the browser would scroll the clipped row natively.
        // Instead, show the card and move the page to where the pin has that card on screen.
        const onFocus = (e: FocusEvent) => {
          const card = (e.target as Element | null)?.closest<HTMLElement>('.evidence')
          t.scrollLeft = 0
          if (!card) return
          gsap.getTweensOf(card).forEach((tween) => tween.progress(1))
          const st = slide.scrollTrigger
          const d = distance()
          if (!st || d === 0) return
          const pad = inner ? parseFloat(getComputedStyle(inner).paddingLeft) : 0
          const ratio = gsap.utils.clamp(0, 1, (card.offsetLeft - pad) / d)
          scrollToY(st.start + ratio * (st.end - st.start))
        }
        const onScroll = () => {
          if (t.scrollLeft !== 0) t.scrollLeft = 0
        }
        t.addEventListener('focusin', onFocus)
        t.addEventListener('scroll', onScroll)
        return () => {
          t.removeEventListener('focusin', onFocus)
          t.removeEventListener('scroll', onScroll)
        }
      })

      mm.add('(prefers-reduced-motion: no-preference) and (max-width: 899.98px)', () => {
        cards.forEach((card) => {
          const enter = { trigger: card, start: 'top 88%', ...PLAY_ONCE }
          gsap.from(card, { y: 50, opacity: 0, duration: 0.9, ease: 'expo.out', scrollTrigger: enter })
          const num = card.querySelector<HTMLElement>('[data-count]')
          if (num) countUp(num, enter)
        })
      })
    },
    { scope: root },
  )

  return (
    <section ref={root} id="problem" className="problem night-deep" aria-labelledby="problem-title">
      <div className="problem-pin">
        <div className="wrap problem-head">
          <p className="eyebrow eyebrow-light" data-reveal>
            The problem
          </p>
          <h2 id="problem-title" className="display" data-split>
            The feed is full of places nobody visited, sold by people who were never there.
          </h2>
          <p className="problem-kicker" data-reveal>
            Travel tips used to come from people who had been there. Now a lot of them are{' '}
            <span className="problem-word">generated.</span>
          </p>
        </div>
        <div ref={track} className="track" role="region" aria-label="Evidence: sourced numbers">
          <div className="track-inner">
            {PROBLEM_STATS.map((s, i) => (
              <article key={s.headline} className="evidence">
                <p className="evidence-num" data-count={i}>
                  {formatStat(s, s.value)}
                </p>
                <h3>{s.headline}</h3>
                <p>{s.detail}</p>
                <a className="source" href={s.source.url} target="_blank" rel="noreferrer">
                  Source: {s.source.label}
                </a>
              </article>
            ))}
            {PROBLEM_STORIES.map((s) => (
              <article key={s.kicker} className="evidence evidence-story">
                <p className="evidence-kicker">{s.kicker}</p>
                <p className="evidence-text">{s.text}</p>
                <a className="source" href={s.source.url} target="_blank" rel="noreferrer">
                  Source: {s.source.label}
                </a>
              </article>
            ))}
          </div>
          <div className="track-progress" aria-hidden="true">
            <i />
          </div>
        </div>
        <div className="wrap">
          <p className="problem-outro" data-reveal>
            Removing fakes after the fact does not scale. Verapass starts from the other end: only verified humans publish,
            and only people who physically arrive can collect.
          </p>
        </div>
      </div>
    </section>
  )
}
