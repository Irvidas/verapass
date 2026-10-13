import { useEffect, useState } from 'react'
import { normalisePath } from '../shared/routes'
import { Nav } from './components/Nav'
import { PassportDock } from './components/PassportDock'
import { pollPendingAttestations } from './lib/checkin'
import { syncPass } from './lib/places'
import { passportStore, travellerSession } from './lib/usePassport'
import { Cursor } from './motion/Cursor'
import { useRefreshOnLayoutChange, useSmoothScroll } from './motion/SmoothScroll'
import { useRevealOnFocus } from './motion/useRevealOnFocus'
import { useStampWipes } from './motion/useStampWipes'
import { Cancel } from './pages/Cancel'
import { NotFound } from './pages/NotFound'
import { Success } from './pages/Success'
import { Verify } from './pages/Verify'
import { Creators } from './sections/Creators'
import { Faq } from './sections/Faq'
import { FinalCta } from './sections/FinalCta'
import { Footer } from './sections/Footer'
import { Hero } from './sections/Hero'
import { HiddenPlaces } from './sections/HiddenPlaces'
import { HowItWorks } from './sections/HowItWorks'
import { MapCheckin } from './sections/MapCheckin'
import { Market } from './sections/Market'
import { MeetSukanya } from './sections/MeetSukanya'
import { Passport } from './sections/Passport'
import { Pricing } from './sections/Pricing'
import { Problem } from './sections/Problem'
import { Services } from './sections/Services'
import { Values } from './sections/Values'

/** Starts the hero once the web fonts are in (so SplitText measures real glyphs), or after 700 ms at most. */
function useIntroReady(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let done = false
    const go = () => {
      if (done) return
      done = true
      setReady(true)
    }
    const timer = window.setTimeout(go, 700)
    void document.fonts?.ready.then(go)
    return () => window.clearTimeout(timer)
  }, [])
  return ready
}

/** A deep link such as /#map (used by the checkout success page) lands on its section. */
function useScrollToHash(ready: boolean): void {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!ready || !id) return
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [ready])
}

/** Server-side state the page depends on: the pass (and hidden places), and pending Stellar records. */
function useServerSync(): void {
  useEffect(() => {
    void syncPass(passportStore, travellerSession.withTraveller)
    return pollPendingAttestations(passportStore)
  }, [])
}

function Home() {
  const ready = useIntroReady()
  useSmoothScroll()
  useRefreshOnLayoutChange()
  useScrollToHash(ready)
  useServerSync()
  useStampWipes()
  useRevealOnFocus()
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Cursor />
      <Nav />
      <main id="main">
        <Hero ready={ready} />
        <Problem />
        <div className="wipe wipe-from-night-deep">
          <MeetSukanya />
        </div>
        <Values />
        <HowItWorks />
        <div className="wipe wipe-from-paper">
          <MapCheckin />
        </div>
        <Passport />
        <HiddenPlaces />
        <Pricing />
        <div className="wipe wipe-from-sand">
          <Creators />
        </div>
        <Market />
        <Services />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <PassportDock />
    </>
  )
}

export function App() {
  const path = normalisePath(window.location.pathname)
  if (path === '/success') return <Success />
  if (path === '/cancel') return <Cancel />
  if (path === '/verify') return <Verify />
  if (path !== '/') return <NotFound />
  return <Home />
}
