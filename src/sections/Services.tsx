import { useRef } from 'react'
import { Icon, type IconName } from '../components/icons'
import { useSectionMotion } from '../motion/useSectionMotion'

const SERVICES: { ic: IconName; t: string; p: string }[] = [
  { ic: 'compass', t: 'Private guiding', p: 'A day planned around what you love: food, temples, nature or all three.' },
  { ic: 'boat', t: 'Private boat and islands', p: 'Island hopping on your own boat at a fair local price, timed to skip the crowds.' },
  { ic: 'plane', t: 'Airport pickup', p: 'A friendly face and a fixed price when you land. No taxi haggling at midnight.' },
  { ic: 'scooter', t: 'Car and scooter rental', p: 'Trusted local rentals with honest deposits, and what to check first.' },
  { ic: 'document', t: 'Visa extension help', p: 'The paperwork explained step by step, with company if you need it.' },
  { ic: 'route', t: 'Custom itinerary', p: 'Send your dates and style, get your whole trip planned day by day.' },
]

export function Services() {
  const root = useRef<HTMLElement>(null)
  useSectionMotion(root)
  return (
    <section ref={root} id="services" className="services sand" aria-labelledby="services-title">
      <div className="wrap">
        <div className="head">
          <div>
            <p className="eyebrow" data-reveal>
              In person, with Sukanya
            </p>
            <h2 id="services-title" className="display" data-split>
              Want her there with you?
            </h2>
          </div>
          <p data-reveal>The pass is enough for most travellers. For everyone else, Sukanya also works on the island in person.</p>
        </div>
        <ul className="svc">
          {SERVICES.map((s, i) => (
            <li key={s.t} data-reveal={(i % 3) * 0.08} data-draw>
              <span className="svc-ic">
                <Icon name={s.ic} size={30} />
              </span>
              <h3>{s.t}</h3>
              <p>{s.p}</p>
            </li>
          ))}
        </ul>
        <p className="svc-contact">
          Ask Sukanya: <a href="mailto:sukanyathaiguide@gmail.com">sukanyathaiguide@gmail.com</a>
        </p>
      </div>
    </section>
  )
}
