import { useEffect, useRef, useState } from 'react'
import { PHUKET_PASS, formatPrice } from '../../shared/pricing'
import { Icon, type IconName } from '../components/icons'
import { Picture } from '../components/Picture'
import { api } from '../lib/api'
import { travellerSession, usePassport } from '../lib/usePassport'
import { gsap, MQ } from '../motion/gsap'
import { Magnetic } from '../motion/Magnetic'
import { useSectionMotion } from '../motion/useSectionMotion'

const INSIDE: { ic: IconName; b: string; s: string }[] = [
  { ic: 'pin', b: 'Hidden places', s: 'Beaches, viewpoints and cafes most tourists miss, on the map' },
  { ic: 'coins', b: 'Fair prices', s: 'What locals pay for taxis, boats, massages and food' },
  { ic: 'noEntry', b: 'Tourist traps and scams', s: 'Which ones to avoid, and how to say no politely' },
  { ic: 'bowl', b: 'Where locals eat', s: "Sukanya's favourite stalls and markets" },
  { ic: 'calendar', b: 'Ready-made itineraries', s: '3, 5 and 7 day plans' },
  { ic: 'passport', b: 'Your passport', s: 'Collect every place you really visit' },
]

export function Pricing() {
  const root = useRef<HTMLElement>(null)
  const book = useRef<HTMLDivElement>(null)
  const { pass } = usePassport()
  const [mode, setMode] = useState<'demo' | 'stripe-test' | null>(null)
  const [state, setState] = useState<{ kind: 'idle' | 'working' | 'error'; message?: string }>({ kind: 'idle' })

  useEffect(() => {
    let alive = true
    void api.health().then((h) => alive && setMode(h?.payments ?? null))
    return () => {
      alive = false
    }
  }, [])

  useSectionMotion(root)

  useEffect(() => {
    const el = book.current
    if (!el || !window.matchMedia(MQ.finePointer).matches) return
    const rx = gsap.quickTo(el, 'rotationY', { duration: 0.8, ease: 'power3' })
    const ry = gsap.quickTo(el, 'rotationX', { duration: 0.8, ease: 'power3' })
    const stage = el.parentElement
    const move = (e: PointerEvent) => {
      const r = stage?.getBoundingClientRect()
      if (!r) return
      rx(((e.clientX - r.left) / r.width - 0.5) * 30 - 14)
      ry(-((e.clientY - r.top) / r.height - 0.5) * 20 + 3)
    }
    const leave = () => {
      rx(-14)
      ry(3)
    }
    stage?.addEventListener('pointermove', move)
    stage?.addEventListener('pointerleave', leave)
    return () => {
      stage?.removeEventListener('pointermove', move)
      stage?.removeEventListener('pointerleave', leave)
    }
  }, [])

  async function buy() {
    setState({ kind: 'working' })
    try {
      const res = await travellerSession.withTraveller((t) => api.checkout(t))
      window.location.assign(res.url)
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not start checkout.' })
    }
  }

  const price = formatPrice(PHUKET_PASS.amount, PHUKET_PASS.currency)

  return (
    <section ref={root} id="pricing" className="pricing sea" aria-labelledby="pricing-title">
      <div className="wrap pricing-grid">
        <div className="book-stage" data-reveal>
          <div ref={book} className="book">
            <Picture src="/images/ebook-cover.jpg" alt="" sizes="290px" />
            <div className="cover-text">
              <small>A local guide's handbook</small>
              <h3>Phuket Without the Tourist Traps</h3>
              <span className="hand">by Sukanya</span>
            </div>
          </div>
        </div>
        <div>
          <p className="eyebrow" data-reveal>
            The Phuket pass
          </p>
          <h2 id="pricing-title" className="display" data-split>
            Everything Sukanya would tell her best friend before they visit.
          </h2>
          <p className="intro" data-reveal>
            Her eBook, every hidden place on the map, and your proof-of-presence passport. One payment, by card, through Stripe.
          </p>
          <ul className="inside" data-reveal data-draw>
            {INSIDE.map((i) => (
              <li key={i.b}>
                <span className="ic">
                  <Icon name={i.ic} size={20} />
                </span>
                <span>
                  <b>{i.b}</b>
                  <small>{i.s}</small>
                </span>
              </li>
            ))}
          </ul>
          <div className="buy" data-reveal>
            <p className="price">
              {price}
              <small>one-time - launch price</small>
            </p>
            {pass.unlocked ? (
              <p className="badge-ok badge-big">Your pass is active{pass.demo ? ' (demo)' : ''}</p>
            ) : (
              <Magnetic>
                <button type="button" className="btn btn-palm btn-big" onClick={() => void buy()} disabled={state.kind === 'working'} data-cursor="Pay">
                  {state.kind === 'working' ? 'Opening checkout...' : `Get the Phuket pass, ${price}`}
                </button>
              </Magnetic>
            )}
          </div>
          {state.kind === 'error' && (
            <p className="status status-error" role="alert">
              {state.message}
            </p>
          )}
          <p className="fineprint dark">
            {mode === 'stripe-test'
              ? 'Stripe test mode: no real money moves. Use card 4242 4242 4242 4242, any future date, any CVC.'
              : mode === 'demo'
                ? 'Demo mode: no Stripe key is set on this server, so checkout skips payment and shows the success flow.'
                : 'Payments by Stripe Checkout, test mode only during the pilot.'}
          </p>
        </div>
      </div>
    </section>
  )
}
