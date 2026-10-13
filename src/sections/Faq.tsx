import { useRef } from 'react'
import { useSectionMotion } from '../motion/useSectionMotion'

const FAQ = [
  {
    q: 'Is Sukanya a real person?',
    a: 'Yes. She is a licensed Tourism Authority of Thailand guide who lives in Phuket and has worked with tourists for more than five years. Her licence is checked by Verapass, and creators who earn go through Stripe identity checks.',
  },
  {
    q: 'How does Verapass know I was really there?',
    a: 'Your phone gets a one-time code from the server, then sends its GPS fix. The server only stamps your passport if you are inside the place geofence, your fix is accurate to 100 m or better, the code is less than 2 minutes old, and the trip from your last stamp was physically possible.',
  },
  {
    q: 'Can GPS be faked?',
    a: 'Yes. A web page cannot prove where a phone is: developer tools, mock-location apps or a script can send any coordinates. The server makes faking slow and visible (one-time codes, accuracy and travel-speed checks, limits per connection), not impossible. A rotating on-site code, shown by the guide or on a sign, and check-ins signed by your own wallet are next. We will not claim more than that.',
  },
  {
    q: 'Can I check a stamp myself?',
    a: 'Yes. Every stamp keeps its signed receipt and the proof behind its on-chain hash. The verify page recomputes the hash and checks the signatures in your browser, so you do not have to trust our database. Each stamp in your passport has a link to it.',
  },
  {
    q: 'What goes on the Stellar blockchain?',
    a: 'A hash of the check-in proof, the place id and the time. Your raw location and your payment details stay off chain. In this demo the records go to Stellar testnet, or to a clearly labelled mock if the server has no testnet key.',
  },
  {
    q: 'Do I need a crypto wallet or XLM?',
    a: 'No. The server pays the network fees. A passkey wallet, so you can hold your own stamps, is on the roadmap.',
  },
  {
    q: 'How do payments work?',
    a: 'You pay once by card in Stripe Checkout. Stripe tells our server the payment succeeded through a signed webhook, and then your pass unlocks. During the pilot everything runs in Stripe test mode.',
  },
]

export function Faq() {
  const root = useRef<HTMLElement>(null)
  useSectionMotion(root)
  return (
    <section ref={root} id="faq" className="faq paper" aria-labelledby="faq-title">
      <div className="wrap faq-wrap">
        <p className="eyebrow" data-reveal>
          Questions
        </p>
        <h2 id="faq-title" className="display" data-split>
          Good to know
        </h2>
        <div className="faq-list">
          {FAQ.map((f) => (
            <details key={f.q} data-reveal>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}
