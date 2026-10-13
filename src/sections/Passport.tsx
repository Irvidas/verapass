import { useEffect, useRef } from 'react'
import { PLACE_COUNT } from '../../shared/places'
import { Icon } from '../components/icons'
import { Stamp } from '../components/Stamp'
import { progress, type Stamp as StampRecord } from '../lib/passport'
import { placeName, usePlaces, type ClientPlace } from '../lib/places'
import { passportStore, usePassport } from '../lib/usePassport'
import { explorerHref } from '../lib/explorer'
import { counts, useStampVerdicts, type Verdict } from '../lib/verification'
import { verifyLink } from '../lib/verifyLink'
import { gsap, MQ, PLAY_ONCE, prefersReducedMotion } from '../motion/gsap'
import { useSectionMotion } from '../motion/useSectionMotion'

function short(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}...${hash.slice(-6)}` : hash
}

const VERDICT_TEXT: Record<Verdict, string> = {
  checking: 'Checking the signature...',
  verified: 'Signature verified in your browser',
  'other-key': 'Signed by another server key',
  invalid: 'Does not verify: edited or forged',
  unsupported: 'This browser cannot check signatures',
}

function ChainStatus({ s }: { s: StampRecord }) {
  const a = s.attestation
  if (a.status === 'pending') return <span className="chain chain-pending">Writing to Stellar...</span>
  if (a.status === 'failed') return <span className="chain chain-failed">Not on chain yet: {a.message}</span>
  const record = a.record
  if (record.mode === 'testnet') {
    const contract = record.contract
    const token = contract?.tokenId !== undefined ? `Stamp #${contract.tokenId}` : 'Stamp'
    if (contract?.alreadyStamped) {
      const href = explorerHref(contract.url)
      const text = `${token} already on Stellar from an earlier visit`
      return href ? (
        <a className="chain" href={href} target="_blank" rel="noreferrer">
          {text}
        </a>
      ) : (
        <span className="chain">{text}</span>
      )
    }
    const href = explorerHref(record.explorerUrl)
    const text = contract ? `${token} on Stellar testnet: tx ${short(record.txHash)}` : `On Stellar testnet: tx ${short(record.txHash)}`
    return href ? (
      <a className="chain" href={href} target="_blank" rel="noreferrer">
        {text}
      </a>
    ) : (
      <span className="chain">{text}</span>
    )
  }
  return (
    <span className="chain mock-note" title={record.explorerUrl}>
      Mock tx {short(record.txHash)}, not on chain
    </span>
  )
}

function FilledSlot({ place, s, verdict }: { place: ClientPlace; s: StampRecord; verdict: Verdict }) {
  const link = verifyLink(s)
  return (
    <>
      <span className="slot-stamp" data-tilt>
        <Stamp place={place} name={placeName(place)} date={s.collectedAt} size={112} />
      </span>
      <div className="slot-meta">
        <b>{placeName(place)}</b>
        {s.simulated && <span className="tag-sim">Simulated visit</span>}
        <span className={`verdict-tag verdict-tag-${verdict}`}>
          <Icon name={verdict === 'invalid' ? 'noEntry' : 'shield'} size={14} />
          {VERDICT_TEXT[verdict]}
        </span>
        <span>
          Attestation <code>{s.attestation.status === 'confirmed' ? s.attestation.record.id : s.attestation.status}</code>
        </span>
        <span className="hash" data-hash={s.proofHash}>
          proof {short(s.proofHash)}
        </span>
        <ChainStatus s={s} />
        {link ? (
          <a className="verify-link" href={link}>
            Check this stamp
          </a>
        ) : (
          <span className="verify-link">An older stamp: it holds your passport id, so it has no link to share</span>
        )}
      </div>
    </>
  )
}

export function Passport() {
  const root = useRef<HTMLElement>(null)
  const state = usePassport()
  const places = usePlaces()
  const verdicts = useStampVerdicts(state.stamps)
  const valid = state.stamps.filter((s) => counts(verdicts.get(s.proofHash)))
  const { collected, total, ratio } = progress(valid.length, PLACE_COUNT)
  const seen = useRef(new Set(state.stamps.map((s) => s.placeId)))

  useSectionMotion(root, (full, el) => {
    if (!full) return
    gsap.from(el.querySelector('.booklet'), {
      rotateX: 35,
      y: 80,
      opacity: 0,
      transformPerspective: 1400,
      duration: 1.4,
      ease: 'expo.out',
      // The stage, not the moving booklet, is the trigger: its position does not change with the tween.
      scrollTrigger: { trigger: el.querySelector('.booklet-stage'), start: 'top 85%', ...PLAY_ONCE },
    })
    // Pages turn in as the booklet opens.
    gsap.from(el.querySelectorAll('.slot'), {
      rotateY: -70,
      transformOrigin: '0% 50%',
      transformPerspective: 900,
      opacity: 0,
      duration: 0.9,
      ease: 'power3.out',
      stagger: 0.05,
      scrollTrigger: { trigger: el.querySelector('.booklet-pages'), start: 'top 80%', ...PLAY_ONCE },
    })
  })

  // Hovering a stamp tilts it towards the pointer, with a sheen across the ink.
  useEffect(() => {
    const el = root.current
    if (!el || !window.matchMedia(MQ.finePointer).matches) return
    const move = (e: PointerEvent) => {
      const target = (e.target as Element | null)?.closest<HTMLElement>('[data-tilt]')
      if (!target) return
      const r = target.getBoundingClientRect()
      const px = (e.clientX - r.left) / r.width - 0.5
      const py = (e.clientY - r.top) / r.height - 0.5
      gsap.to(target, {
        rotationY: px * 16,
        rotationX: -py * 16,
        transformPerspective: 500,
        duration: 0.4,
        ease: 'power3.out',
        overwrite: 'auto',
      })
      target.style.setProperty('--sheen', `${(px + 0.5) * 100}%`)
    }
    const leave = (e: PointerEvent) => {
      const target = (e.target as Element | null)?.closest<HTMLElement>('[data-tilt]')
      if (target) gsap.to(target, { rotationX: 0, rotationY: 0, duration: 0.6, ease: 'power3.out', overwrite: 'auto' })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerout', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerout', leave)
    }
  }, [])

  // A newly collected stamp is pressed onto the page and its proof hash types out.
  useEffect(() => {
    const fresh = state.stamps.filter((s) => !seen.current.has(s.placeId))
    fresh.forEach((s) => {
      seen.current.add(s.placeId)
      const slot = root.current?.querySelector(`[data-slot="${s.placeId}"]`)
      const node = slot?.querySelector('.stamp')
      const hash = slot?.querySelector('.hash')
      if (!node) return
      if (prefersReducedMotion()) {
        gsap.from(node, { autoAlpha: 0, duration: 0.4 })
        return
      }
      gsap.from(node, { scale: 2.2, autoAlpha: 0, rotate: -60, duration: 0.6, delay: 1.2, ease: 'back.out(2)' })
      if (hash) gsap.from(hash, { duration: 1.2, delay: 1.6, scrambleText: { text: '{original}', chars: '0123456789abcdef', speed: 0.8 } })
    })
    if (state.stamps.length === 0) seen.current.clear()
  }, [state.stamps])

  return (
    <section ref={root} id="passport" className="passport sand" aria-labelledby="passport-title">
      <div className="wrap">
        <div className="head">
          <div>
            <p className="eyebrow" data-reveal>
              Your passport
            </p>
            <h2 id="passport-title" className="display" data-split>
              A trip record you earn on the ground, not on a sofa.
            </h2>
          </div>
          <p data-reveal>
            Every stamp keeps its signed receipt, the proof behind its on-chain hash and its Stellar record, so anyone can check it without
            asking us. This demo keeps your passport in this browser only.
          </p>
        </div>

        <div className="booklet-stage">
          <div className="booklet">
            <div className="booklet-cover">
              <p className="booklet-brand">VERAPASS</p>
              <p className="booklet-sub">Proof-of-presence passport</p>
              <p className="booklet-island hand">Phuket</p>
              <div className="booklet-progress">
                <div
                  className="bar"
                  role="progressbar"
                  aria-label="Places collected"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={collected}
                >
                  <i style={{ transform: `scaleX(${ratio})` }} />
                </div>
                <p>
                  <b data-testid="passport-count">{collected}</b> of {total} places collected
                </p>
              </div>
              <p className="booklet-id">
                Passport id <code>{state.traveller ? state.traveller.split('.')[0] : 'issued on your first check-in'}</code>
              </p>
              <p className="booklet-pass">
                {state.pass.unlocked ? `Phuket pass active${state.pass.demo ? ' (demo)' : ''}` : 'Free passport - hidden places locked'}
              </p>
              <a className="link-btn" href="/verify">
                How to check a stamp
              </a>
              {state.stamps.length > 0 && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    if (window.confirm('Clear the demo passport in this browser?')) passportStore.reset()
                  }}
                >
                  Reset demo passport
                </button>
              )}
            </div>

            <ol className="booklet-pages" aria-label="Stamps">
              {places.map((p) => {
                const s = state.stamps.find((x) => x.placeId === p.id)
                const verdict = s ? (verdicts.get(s.proofHash) ?? 'checking') : 'checking'
                return (
                  <li
                    key={p.id}
                    className={`slot ${s ? 'is-filled' : ''} ${s && !counts(verdict) ? 'is-unverified' : ''}`}
                    data-slot={p.id}
                  >
                    {s ? (
                      <FilledSlot place={p} s={s} verdict={verdict} />
                    ) : (
                      <div className="slot-empty">
                        <Stamp place={p} name={placeName(p)} size={96} ghost />
                        <small>
                          {!p.detail && <Icon name="lock" size={13} />} {placeName(p)}
                        </small>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      </div>
    </section>
  )
}
