import { useRef } from 'react'
import { GLOBAL_CONTEXT, PHUKET_2025, PHUKET_SOURCE, TOP_MARKETS_2025, VISITOR_HISTORY } from '../data/stats'
import { gsap, PLAY_ONCE } from '../motion/gsap'
import { useSectionMotion } from '../motion/useSectionMotion'

const nf = new Intl.NumberFormat('en-US')

const COUNTERS = [
  { value: PHUKET_2025.visitors, label: 'visitors to Phuket in 2025', fmt: (v: number) => nf.format(Math.round(v)) },
  { value: PHUKET_2025.revenueUsdBillions, label: `tourism revenue (${nf.format(PHUKET_2025.revenueThbMillions)}M THB)`, fmt: (v: number) => `$${v.toFixed(1)}B` },
  { value: PHUKET_2025.dailySpendUsd, label: `average spend per visitor per day (${nf.format(PHUKET_2025.dailySpendThb)} THB)`, fmt: (v: number) => `~$${Math.round(v)}` },
  { value: PHUKET_2025.occupancyPct, label: 'hotel occupancy in 2025', fmt: (v: number) => `${v.toFixed(1)}%` },
]

export function Market() {
  const root = useRef<HTMLElement>(null)
  const maxMarket = Math.max(...TOP_MARKETS_2025.map((m) => m.visitors))
  const maxHistory = Math.max(...VISITOR_HISTORY.map((h) => h.visitors))

  useSectionMotion(root, (full, el) => {
    el.querySelectorAll<HTMLElement>('[data-counter]').forEach((node, i) => {
      const c = COUNTERS[i]
      if (!c || !full) return
      const o = { v: 0 }
      gsap.to(o, {
        v: c.value,
        duration: 2,
        ease: 'power3.out',
        scrollTrigger: { trigger: node, start: 'top 90%', ...PLAY_ONCE },
        onUpdate: () => {
          node.textContent = c.fmt(o.v)
        },
      })
    })
    if (!full) return
    gsap.from(el.querySelectorAll('.bar-fill'), {
      scaleX: 0,
      duration: 1.4,
      ease: 'expo.out',
      stagger: 0.08,
      scrollTrigger: { trigger: el.querySelector('.bars'), start: 'top 85%', ...PLAY_ONCE },
    })
    gsap.from(el.querySelectorAll('.col-fill'), {
      scaleY: 0,
      duration: 1.4,
      ease: 'expo.out',
      stagger: 0.1,
      scrollTrigger: { trigger: el.querySelector('.cols'), start: 'top 85%', ...PLAY_ONCE },
    })
  })

  return (
    <section ref={root} id="market" className="market paper" aria-labelledby="market-title">
      <div className="wrap">
        <div className="head">
          <div>
            <p className="eyebrow" data-reveal>
              Market in numbers
            </p>
            <h2 id="market-title" className="display" data-split>
              One island, fourteen million visitors a year.
            </h2>
          </div>
          <p data-reveal>
            Phuket is the pilot because the numbers are big and the trust problem is daily: scams, unlicensed guides and
            generated content all compete for the same visitors.
          </p>
        </div>

        <dl className="counters">
          {COUNTERS.map((c) => (
            <div key={c.label} className="counter" data-reveal>
              <dt>{c.label}</dt>
              <dd data-counter>{c.fmt(c.value)}</dd>
            </div>
          ))}
        </dl>

        <div className="charts">
          <figure className="chart" data-reveal>
            <figcaption>
              <b>Top foreign markets, 2025</b>
              <small>Visitors to Phuket, share of foreign arrivals</small>
            </figcaption>
            <ul className="bars">
              {TOP_MARKETS_2025.map((m) => (
                <li key={m.country}>
                  <span className="bar-label">{m.country}</span>
                  <span className="bar-track">
                    <span className="bar-fill" style={{ width: `${(m.visitors / maxMarket) * 100}%` }} />
                  </span>
                  <span className="bar-value">
                    {nf.format(m.visitors)} <small>({m.share}%)</small>
                  </span>
                </li>
              ))}
            </ul>
            <p className="chart-note">India grew from 225,535 visitors in 2019 to 1,029,588 in 2025. English-speaking markets (India, UK, Australia) are the first audience.</p>
          </figure>

          <figure className="chart" data-reveal>
            <figcaption>
              <b>Total visitors, selected years</b>
              <small>Back to the pre-pandemic peak</small>
            </figcaption>
            <ul className="cols">
              {VISITOR_HISTORY.map((h) => (
                <li key={h.year}>
                  <span className="col-value">{(h.visitors / 1_000_000).toFixed(1)}M</span>
                  <span className="col-track">
                    <span className="col-fill" style={{ height: `${(h.visitors / maxHistory) * 100}%` }} />
                  </span>
                  <span className="col-label">{h.year}</span>
                </li>
              ))}
            </ul>
            <p className="chart-note">
              Seasonality, 2023-2025 average: December is busiest (10.2% of annual arrivals), March is quietest (7.5%).
            </p>
          </figure>
        </div>

        <p className="source-line">
          Phuket figures:{' '}
          <a href={PHUKET_SOURCE.url} target="_blank" rel="noreferrer">
            {PHUKET_SOURCE.label}
          </a>
          , 2025 data. USD values as given by the source.
        </p>

        <ul className="global">
          {GLOBAL_CONTEXT.map((g) => (
            <li key={g.value} data-reveal>
              <b>{g.value}</b>
              <span>{g.label}</span>
              <a href={g.source.url} target="_blank" rel="noreferrer">
                {g.source.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
