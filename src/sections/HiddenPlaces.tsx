import { useRef } from 'react'
import { Icon } from '../components/icons'
import { Picture } from '../components/Picture'
import { placeName, useHiddenUnlocked, usePlaces } from '../lib/places'
import { useSectionMotion } from '../motion/useSectionMotion'

const LAYOUT: Record<string, { cls: string; tag?: string; note: string; sizes: string }> = {
  'khao-sok-lake': { cls: 'c1', tag: 'Day trip', note: 'How to do it without the tour-bus crowds', sizes: '(min-width: 860px) 42vw, 92vw' },
  'secret-reef': { cls: 'c2', note: 'Low tide only', sizes: '(min-width: 860px) 33vw, 46vw' },
  'wat-chalong': { cls: 'c3', tag: 'Culture', note: 'Go at 7am', sizes: '(min-width: 860px) 25vw, 46vw' },
  'quiet-snorkel-bay': { cls: 'c4', note: 'No rental stands, no crowds', sizes: '(min-width: 860px) 25vw, 46vw' },
  'old-town': { cls: 'c5', tag: 'Food and walks', note: 'The Sunday-market route', sizes: '(min-width: 860px) 33vw, 46vw' },
  'empty-beach': { cls: 'c6', note: 'A short walk keeps the vans away', sizes: '(min-width: 860px) 42vw, 92vw' },
}

export function HiddenPlaces() {
  const root = useRef<HTMLElement>(null)
  const unlocked = useHiddenUnlocked()
  const places = usePlaces()
  useSectionMotion(root)
  const cards = places.filter((p) => p.image && LAYOUT[p.id])

  return (
    <section ref={root} id="places" className="places paper" aria-labelledby="places-title">
      <div className="wrap">
        <div className="head">
          <div>
            <p className="eyebrow" data-reveal>
              A small taste
            </p>
            <h2 id="places-title" className="display" data-split>
              Some places you know. Some you will not find without a local.
            </h2>
          </div>
          <p data-reveal>
            {unlocked
              ? 'Your pass is active: the hidden places are open, with directions on the map.'
              : 'The blurred ones are hidden places. The Phuket pass reveals where they are, and you can collect them on the map.'}
          </p>
        </div>
        <div className="grid-places">
          {cards.map((p) => {
            const layout = LAYOUT[p.id]
            const locked = !p.detail
            if (!layout || !p.image) return null
            return (
              <article key={p.id} className={`card ${layout.cls} ${locked ? 'locked' : ''}`} data-mask data-testid={`place-card-${p.id}`}>
                <Picture src={p.image} alt={locked ? '' : (p.imageAlt ?? '')} sizes={locked ? '240px' : layout.sizes} />
                {layout.tag && !locked && <span className="tag">{layout.tag}</span>}
                {locked ? (
                  <div className="lock">
                    <div>
                      <b>
                        <Icon name="lock" size={16} /> {p.teaser}
                      </b>
                      <small>Unlocks with the Phuket pass</small>
                    </div>
                  </div>
                ) : (
                  <div className="cap">
                    <h3>{placeName(p)}</h3>
                    <small>{layout.note}</small>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
