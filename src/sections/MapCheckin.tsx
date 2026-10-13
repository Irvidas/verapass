import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatDistance, haversineMeters, nearestPlace } from '../../shared/geo'
import type { Place } from '../../shared/places'
import { Icon } from '../components/icons'
import { KIND_ICON } from '../components/kindIcon'
import { Stamp } from '../components/Stamp'
import { api, ApiError } from '../lib/api'
import { checkIn, getBrowserFix, simulatedFix } from '../lib/checkin'
import { holdDock, releaseDock } from '../lib/dockHold'
import { fullPlace, placeArea, placeName, useHiddenUnlocked, usePlaces, type ClientPlace } from '../lib/places'
import { passportStore, travellerSession, usePassport } from '../lib/usePassport'
import { gsap, PLAY_ONCE, prefersReducedMotion } from '../motion/gsap'
import { revealElement } from '../motion/SmoothScroll'
import { useSectionMotion } from '../motion/useSectionMotion'

const ISLAND_PATH =
  'M150 18 C162 22 172 30 176 44 C182 62 196 74 206 96 C214 116 206 132 212 150 C218 170 204 186 206 206 C208 226 200 238 192 252 C200 262 212 272 204 290 C196 302 186 300 180 312 C176 326 186 336 176 348 C166 360 152 352 146 366 C140 380 128 390 116 384 C106 378 112 362 102 352 C94 342 104 330 98 318 C92 304 104 296 98 282 C92 268 104 258 100 244 C96 232 110 226 104 214 C98 202 112 194 108 178 C104 162 116 150 114 132 C112 112 124 96 126 78 C128 56 136 30 150 18 Z'

const VB = { x: 40, y: 0, w: 240, h: 410 }
/** Where "you" start walking from, relative to the pin, in px. */
const START = { x: 92, y: -74 }
const STEPS = 7

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; message: string }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string }

interface Flight {
  place: ClientPlace
  name: string
  from: DOMRect
  at: number
}

/**
 * The collect moment: the stamp slams down on the pin (accelerating in, like a real stamp),
 * a white flash, the map takes the hit, then the stamp arcs into the passport dock. The dock
 * counter is held at its old value until the stamp lands, so the number ticks on impact.
 */
function FlyingStamp({ flight, onImpact, onDone }: { flight: Flight; onImpact: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const dock = document.getElementById('passport-dock')
    if (!el || !dock) {
      releaseDock()
      return onDone()
    }
    const to = dock.getBoundingClientRect()
    const size = 140
    const fromX = flight.from.left + flight.from.width / 2 - size / 2
    const fromY = flight.from.top + flight.from.height / 2 - size / 2
    const toX = to.left + to.width / 2 - size / 2
    const toY = to.top + to.height / 2 - size / 2
    const stamp = el.querySelector('.stamp-slam')
    const ink = el.querySelector('.stamp-ink')
    const mapCard = document.querySelector('.map-card')
    const flash = document.querySelector('.map-flash')
    gsap.set(el, { x: fromX, y: fromY })
    const tl = gsap.timeline({
      onComplete: () => {
        releaseDock()
        onDone()
      },
    })
    tl.fromTo(stamp, { scale: 2.8, autoAlpha: 0, rotate: -38 }, { scale: 1, autoAlpha: 1, rotate: -8, duration: 0.3, ease: 'power4.in' })
      // impact: two frames of white, squash, ink ring, the map card jolts
      .fromTo(flash, { autoAlpha: 0.85 }, { autoAlpha: 0, duration: 0.18, ease: 'power2.out' })
      .to(stamp, { scaleX: 1.08, scaleY: 0.92, duration: 0.07, yoyo: true, repeat: 1, ease: 'power1.out' }, '<')
      .fromTo(ink, { scale: 0.6, autoAlpha: 0.9 }, { scale: 2.1, autoAlpha: 0, duration: 0.6, ease: 'expo.out' }, '<')
      .fromTo(
        mapCard,
        { y: 0 },
        { keyframes: [{ y: 5, duration: 0.05 }, { y: -2, duration: 0.07 }, { y: 0, duration: 0.12 }], ease: 'power1.out' },
        '<',
      )
      // hold so the eye reads the stamp, then the camera pulls back and the stamp arcs to the dock
      .add(onImpact, '+=0.3')
      .to(el, { x: toX, duration: 0.85, ease: 'power2.inOut' }, '<0.05')
      .to(el, { y: toY, duration: 0.85, ease: 'back.in(1.8)' }, '<')
      .to(stamp, { scale: 0.22, rotate: 160, duration: 0.85, ease: 'power2.in' }, '<')
      .to(el, { autoAlpha: 0, duration: 0.12 }, '-=0.08')
      .add(() => releaseDock(), '<')
      .fromTo(dock, { scale: 1 }, { keyframes: [{ scale: 1.22, duration: 0.12 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1, 0.4)' }] }, '<')
    // No release here: a dev-mode effect re-run would end the hold early. Unmounting mid-flight
    // is covered by the hold's own safety timeout.
    return () => {
      tl.kill()
    }
  }, [flight, onDone, onImpact])
  return createPortal(
    <div ref={ref} className="flying-stamp" aria-hidden="true">
      <span className="stamp-ink" />
      <span className="stamp-slam">
        <Stamp place={flight.place} name={flight.name} date={flight.at} size={140} />
      </span>
    </div>,
    document.body,
  )
}

/** Percent position of a place on the map stage. */
function mapPos(p: Pick<ClientPlace, 'map'>): { left: string; top: string } {
  return { left: `${((p.map.x - VB.x) / VB.w) * 100}%`, top: `${((p.map.y - VB.y) / VB.h) * 100}%` }
}

/** Accessible and visible name of a pin: the day trip shows its label on the map, so the name starts with it. */
function pinName(p: ClientPlace): string {
  return p.kind === 'day-trip' && p.detail ? `${placeName(p)}, day trip` : placeName(p)
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function MapCheckin() {
  const root = useRef<HTMLElement>(null)
  const passport = usePassport()
  const places = usePlaces()
  const unlocked = useHiddenUnlocked()
  const [selectedId, setSelectedId] = useState(places[0]?.id ?? '')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [flight, setFlight] = useState<Flight | null>(null)
  const [simulationAllowed, setSimulationAllowed] = useState(true)
  const [attestationMode, setAttestationMode] = useState<'mock' | 'testnet' | null>(null)
  const [contractId, setContractId] = useState<string | null>(null)
  const pinRefs = useRef(new Map<string, HTMLButtonElement>())
  const stageRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLSpanElement>(null)
  const youRef = useRef<HTMLSpanElement>(null)
  const stepsRef = useRef<HTMLSpanElement>(null)
  const approachTl = useRef<gsap.core.Timeline | null>(null)
  const endFlight = useCallback(() => setFlight(null), [])

  useEffect(() => {
    let alive = true
    void api.health().then((h) => {
      if (!alive || !h) return
      setSimulationAllowed(h.simulation)
      setAttestationMode(h.attestation)
      setContractId(h.contractId && /^C[A-Z2-7]{55}$/.test(h.contractId) ? h.contractId : null)
    })
    return () => {
      alive = false
    }
  }, [])

  useSectionMotion(root, (full, el) => {
    if (!full) return
    const tl = gsap.timeline({ scrollTrigger: { trigger: el.querySelector('.map-card'), start: 'top 75%', ...PLAY_ONCE } })
    tl.from('.coast', { drawSVG: 0, duration: 2, ease: 'power2.inOut' })
      .from('.island-fill', { autoAlpha: 0, duration: 0.8 }, 0.8)
      .from('.pin', { scale: 0, opacity: 0, duration: 0.6, ease: 'back.out(3)', stagger: 0.06 }, 1.1)
  })

  const selected = places.find((p) => p.id === selectedId) ?? places[0]
  const collected = new Map(passport.stamps.map((s) => [s.placeId, s]))

  /** The camera move: the map zooms towards the pin, and back out. */
  const zoomTo = useCallback((p: ClientPlace | null) => {
    const stage = stageRef.current
    if (!stage || prefersReducedMotion()) return
    if (!p) {
      gsap.to(stage, { scale: 1, x: 0, y: 0, duration: 0.9, ease: 'expo.inOut', overwrite: 'auto', clearProps: 'transform' })
      return
    }
    const fx = (p.map.x - VB.x) / VB.w
    const fy = (p.map.y - VB.y) / VB.h
    // Keep the pin inside the frame: zoom around the pin, pulled towards the centre near the edges.
    gsap.to(stage, {
      scale: 1.8,
      transformOrigin: `${gsap.utils.clamp(0.22, 0.78, fx) * 100}% ${gsap.utils.clamp(0.18, 0.82, fy) * 100}%`,
      duration: 0.9,
      ease: 'expo.inOut',
      overwrite: 'auto',
    })
  }, [])
  const zoomOut = useCallback(() => zoomTo(null), [zoomTo])

  if (!selected) return null
  const locked = !selected.detail
  const stamp = collected.get(selected.id)
  const busy = status.kind === 'working'

  /** While the server checks the fix: the geofence draws on the pin and "you" walk into it, leaving footprints. */
  function approach(p: ClientPlace): void {
    const ring = ringRef.current
    const you = youRef.current
    const steps = stepsRef.current ? Array.from(stepsRef.current.children) : []
    if (!ring || !you || prefersReducedMotion()) return
    const card = root.current?.querySelector('.map-card')
    if (card) revealElement(card)
    zoomTo(p)
    approachTl.current?.kill()
    ring.classList.remove('is-ok', 'is-bad')
    steps.forEach((s, i) => {
      const t = 1 - (i + 1) / (STEPS + 1)
      const side = i % 2 ? 4 : -4
      gsap.set(s, { x: START.x * t + side, y: START.y * t - side * 0.6, autoAlpha: 0, rotate: -50 })
    })
    const tl = gsap.timeline()
    tl.set(ring, { autoAlpha: 1, scale: 0 })
      .set(you, { autoAlpha: 0, scale: 0, x: START.x, y: START.y })
      .to(ring, { scale: 1, duration: 0.7, ease: 'expo.out' }, 0.5)
      .to(ring, { rotate: '+=360', duration: 9, ease: 'none', repeat: -1 }, 0.5)
      .to(you, { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'back.out(3)' }, 0.55)
      .to(you, { x: START.x * 0.3, y: START.y * 0.3, duration: 1.6, ease: 'power1.inOut' }, 0.7)
      .to(steps, { autoAlpha: 0.9, duration: 0.12, stagger: 0.2 }, 0.8)
    approachTl.current = tl
  }

  /** The verdict on the map: inside the ring (green, a pulse) or outside (red, a shake). */
  async function settle(ok: boolean): Promise<void> {
    const ring = ringRef.current
    const you = youRef.current
    const steps = stepsRef.current ? Array.from(stepsRef.current.children) : []
    const tl = approachTl.current
    if (!ring || !you || !tl) return
    approachTl.current = null
    tl.pause()
    ring.classList.add(ok ? 'is-ok' : 'is-bad')
    const out = gsap.timeline()
    if (ok) {
      out
        .to(you, { x: 0, y: 0, duration: 0.4, ease: 'power3.out' })
        .to(ring, { scale: 0.82, duration: 0.18, ease: 'power2.in' }, 0.3)
        .to(ring, { scale: 1.6, autoAlpha: 0, duration: 0.5, ease: 'expo.out' })
        .to(you, { autoAlpha: 0, scale: 0.4, duration: 0.25 }, '<')
        .to(steps, { autoAlpha: 0, duration: 0.4, stagger: 0.04 }, '<')
    } else {
      out
        .to(ring, { keyframes: { x: [0, -8, 7, -5, 3, 0] }, duration: 0.45, ease: 'none' })
        .to(you, { x: START.x * 1.3, y: START.y * 1.3, autoAlpha: 0, duration: 0.6, ease: 'power2.in' }, 0.2)
        .to(steps, { autoAlpha: 0, duration: 0.3 }, 0.2)
        .to(ring, { autoAlpha: 0, scale: 0.6, duration: 0.4, ease: 'power2.in' }, 0.6)
        .add(zoomOut, 0.7)
    }
    out.add(() => tl.kill())
    await wait(ok ? 460 : 0)
  }

  async function run(p: ClientPlace, simulated: boolean) {
    const place: Place | null = fullPlace(p)
    if (!place) return
    setStatus({ kind: 'working', message: simulated ? 'Simulating a visit...' : 'Getting your GPS fix...' })
    approach(p)
    try {
      const fix = simulated ? simulatedFix(place) : await getBrowserFix()
      if (!simulated) {
        const d = haversineMeters(place.lat, place.lng, fix.lat, fix.lng)
        setStatus({ kind: 'working', message: `Fix received, ${formatDistance(d)} from ${place.name}. Asking the server...` })
      }
      // A short minimum beat so the walk into the geofence reads, even when the server answers instantly.
      const [newStamp] = await Promise.all([checkIn(travellerSession.withTraveller, place, fix, simulated), wait(prefersReducedMotion() ? 0 : 1300)])
      const pin = pinRefs.current.get(place.id)
      const animate = Boolean(pin) && !prefersReducedMotion() && !collected.has(place.id)
      // Hold the dock counter at its old value; the flying stamp releases it on landing.
      if (animate) holdDock()
      const added = passportStore.collect(newStamp)
      const onChain = newStamp.attestation.status === 'pending' ? ' Writing it to Stellar...' : ''
      setStatus({
        kind: 'ok',
        message: added
          ? `${simulated ? 'Demo stamp' : 'Stamp'} collected at ${place.name}, ${newStamp.distanceM} m from the check-in point.${onChain}`
          : `Visit to ${place.name} confirmed again. It was already in your passport.`,
      })
      await settle(true)
      if (added && animate && pin) {
        setFlight({ place: p, name: place.name, from: pin.getBoundingClientRect(), at: newStamp.collectedAt })
      } else {
        releaseDock()
        zoomOut()
      }
    } catch (err) {
      void settle(false)
      zoomOut()
      if (err instanceof ApiError && err.code === 'too-far' && err.distanceM !== undefined) {
        setStatus({
          kind: 'error',
          message: `Not yet: you are ${formatDistance(err.distanceM)} from ${place.name}. Go there, or use the demo button.`,
        })
      } else {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Check-in failed.' })
      }
    }
  }

  async function findNearest() {
    setStatus({ kind: 'working', message: 'Getting your GPS fix...' })
    try {
      const fix = await getBrowserFix()
      const open = places.map(fullPlace).filter((p): p is Place => p !== null)
      const near = nearestPlace(open, fix.lat, fix.lng)
      if (!near) return setStatus({ kind: 'idle' })
      setSelectedId(near.place.id)
      setStatus({
        kind: 'ok',
        message: `Nearest place: ${near.place.name}, ${formatDistance(near.distanceM)} away (GPS accuracy ${Math.round(fix.accuracy)} m).`,
      })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not get your location.' })
    }
  }

  const select = (id: string) => {
    setSelectedId(id)
    setStatus({ kind: 'idle' })
  }

  return (
    <section ref={root} id="map" className="mapsec night" aria-labelledby="map-title">
      <div className="wrap map-grid">
        <div className="map-copy">
          <p className="eyebrow eyebrow-light" data-reveal>
            Live demo - Phuket explorer
          </p>
          <h2 id="map-title" className="display" data-split>
            Visit. Check in. Collect.
          </h2>
          <p data-reveal>
            Pick a place, then check in with your phone's GPS. Not in Phuket right now? Use the demo button: it sends a fix a few
            metres from the place and the server marks the stamp as simulated. Simulated stamps are never written on chain.
          </p>

          <div className="place-panel">
            <div className="place-panel-head">
              <span className="place-icon" aria-hidden="true">
                <Icon name={locked ? 'lock' : KIND_ICON[selected.kind]} size={26} />
              </span>
              <div>
                <h3 data-testid="selected-place">{placeName(selected)}</h3>
                <small>
                  {placeArea(selected)} - geofence {formatDistance(selected.radiusM)}
                </small>
              </div>
              {stamp && <span className="badge-ok">Collected</span>}
            </div>
            <p className="place-tip">{selected.detail ? selected.detail.tip : 'The exact spot, directions and tips unlock with the Phuket pass.'}</p>

            {locked ? (
              <a className="btn btn-sand" href="#pricing">
                Unlock with the Phuket pass
              </a>
            ) : (
              <div className="place-actions">
                <button type="button" className="btn btn-coral" disabled={busy} onClick={() => void run(selected, false)} data-cursor="GPS">
                  {stamp ? 'Check in again' : 'Check in with my GPS'}
                </button>
                {simulationAllowed && (
                  <button type="button" className="btn btn-ghost-light" disabled={busy} onClick={() => void run(selected, true)}>
                    Demo: simulate being here
                  </button>
                )}
              </div>
            )}
            <button type="button" className="link-btn link-light" disabled={busy} onClick={() => void findNearest()}>
              Which place is nearest to me?
            </button>
            {status.kind !== 'idle' && (
              <p className={`status status-${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
                {status.message}
              </p>
            )}
            {attestationMode === 'mock' && (
              <p className="fineprint">Server is in mock attestation mode: stamps are signed but not written to Stellar.</p>
            )}
            {attestationMode === 'testnet' && contractId && (
              <p className="fineprint">
                Real check-ins are minted as stamps on the{' '}
                <a href={`https://stellar.expert/explorer/testnet/contract/${contractId}`} target="_blank" rel="noreferrer">
                  Verapass contract on Stellar testnet
                </a>
                . Simulated visits are not.
              </p>
            )}
          </div>
        </div>

        <div className="map-card" data-reveal>
          <div className="map-viewport">
            <div className="map-stage" ref={stageRef}>
              <svg className="island" viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} aria-hidden="true">
                <defs>
                  <pattern id="sandtex" width="6" height="6" patternUnits="userSpaceOnUse">
                    <rect width="6" height="6" fill="#EEDDBF" />
                    <circle cx="2" cy="2" r=".7" fill="#D9BF92" />
                  </pattern>
                </defs>
                <path d={ISLAND_PATH} fill="none" stroke="#1B9AAA" strokeWidth="22" opacity=".3" />
                <path d={ISLAND_PATH} fill="none" stroke="#D3EEF0" strokeWidth="8" opacity=".3" />
                <path className="island-fill" d={ISLAND_PATH} fill="url(#sandtex)" />
                <path className="coast" d={ISLAND_PATH} fill="none" stroke="#F6ECD9" strokeWidth="2" />
                <path d="M150 40 C140 90 150 140 140 190 C134 240 150 290 140 360" stroke="#2E6A4C" strokeWidth="22" opacity=".22" fill="none" strokeLinecap="round" />
                <ellipse cx="190" cy="400" rx="12" ry="7" fill="#EEDDBF" />
                <ellipse cx="236" cy="330" rx="8" ry="5" fill="#EEDDBF" />
                <ellipse cx="80" cy="390" rx="5" ry="4" fill="#EEDDBF" />
                <text x="56" y="250" fill="#D3EEF0" fontSize="9" letterSpacing="2" transform="rotate(-80 56 250)">
                  ANDAMAN SEA
                </text>
                <path d="M222 52 L250 30" stroke="#EEDDBF" strokeDasharray="3 3" />
              </svg>
              <span ref={ringRef} className="geo-ring" style={mapPos(selected)} aria-hidden="true" />
              <span ref={stepsRef} className="footsteps" style={mapPos(selected)} aria-hidden="true">
                {Array.from({ length: STEPS }, (_, i) => (
                  <i key={i} />
                ))}
              </span>
              <span ref={youRef} className="you-dot" style={mapPos(selected)} aria-hidden="true" />
              {/* Pointer shortcut only: the place list below is the keyboard and screen reader path. */}
              <div className="pins" aria-hidden="true">
                {places.map((p) => {
                  const isCollected = collected.has(p.id)
                  const state = isCollected ? 'done' : p.detail ? 'todo' : 'hidden'
                  return (
                    <button
                      key={p.id}
                      ref={(node) => {
                        if (node) pinRefs.current.set(p.id, node)
                        else pinRefs.current.delete(p.id)
                      }}
                      type="button"
                      tabIndex={-1}
                      className={`pin pin-${state} ${p.id === selected.id ? 'is-selected' : ''}`}
                      style={mapPos(p)}
                      onClick={() => select(p.id)}
                      data-cursor={p.detail ? 'Select' : 'Locked'}
                      data-place={p.id}
                    >
                      <span className="pin-dot">{state === 'done' ? <Icon name="check" size={10} strokeWidth={3.5} /> : state === 'hidden' ? '?' : ''}</span>
                      {p.kind === 'day-trip' && <span className="pin-label">{pinName(p)}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
            <span className="map-flash" aria-hidden="true" />
          </div>
          <div className="map-legend" aria-hidden="true">
            <span>
              <i className="lg-done" />
              Collected
            </span>
            <span>
              <i className="lg-todo" />
              Waiting for you
            </span>
            <span>
              <i className="lg-hidden" />
              Hidden (with the pass)
            </span>
          </div>
        </div>

        <ul className="place-chips" aria-label="All places">
          {places.map((p) => {
            const done = collected.has(p.id)
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`chip ${p.id === selected.id ? 'is-selected' : ''} ${done ? 'is-done' : ''}`}
                  aria-pressed={p.id === selected.id}
                  aria-label={`${placeName(p)}${done ? ', collected' : ''}${p.detail ? '' : ', locked'}`}
                  onClick={() => select(p.id)}
                >
                  <Icon name={p.detail ? KIND_ICON[p.kind] : 'lock'} size={16} />
                  {placeName(p)}
                </button>
              </li>
            )
          })}
        </ul>
        {unlocked && <p className="sr-only">The Phuket pass is active: the hidden places are on the map.</p>}
      </div>
      {flight && <FlyingStamp flight={flight} onImpact={zoomOut} onDone={endFlight} />}
    </section>
  )
}
