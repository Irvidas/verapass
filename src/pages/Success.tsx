import { useEffect, useState } from 'react'
import { Logo } from '../components/Logo'
import { api, ApiError } from '../lib/api'
import { syncPass } from '../lib/places'
import { passportStore, travellerSession } from '../lib/usePassport'

type State = { kind: 'checking' } | { kind: 'paid'; demo: boolean } | { kind: 'pending' } | { kind: 'error'; message: string }

/**
 * After Stripe Checkout. The pass unlocks only when the server confirms the payment (webhook,
 * or a direct Checkout Session lookup), and only for the passport that paid: never from the URL alone.
 */
export function Success() {
  const sessionId = new URLSearchParams(window.location.search).get('session_id')
  const [state, setState] = useState<State>(() => (sessionId ? { kind: 'checking' } : { kind: 'error', message: 'No checkout session in the link.' }))

  useEffect(() => {
    if (!sessionId) return
    let alive = true
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const res = await travellerSession.withTraveller((t) => api.pass(sessionId, t))
        if (!alive) return
        if (res.paid) {
          passportStore.unlockPass(sessionId, res.demo)
          await syncPass(passportStore, travellerSession.withTraveller)
          if (alive) setState({ kind: 'paid', demo: res.demo })
          return
        }
        tries += 1
        if (tries > 15) return setState({ kind: 'pending' })
        timer = setTimeout(() => void poll(), 1000)
      } catch (err) {
        if (!alive) return
        const message =
          err instanceof ApiError && err.code === 'pass-not-yours'
            ? 'This pass was bought with another passport. Open the link in the browser you paid with.'
            : err instanceof Error
              ? err.message
              : 'Could not confirm the payment.'
        setState({ kind: 'error', message })
      }
    }
    void poll()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [sessionId])

  return (
    <main id="main" className="result night">
      <div className="result-card">
        <a href="/" aria-label="Verapass home">
          <Logo />
        </a>
        {state.kind === 'checking' && (
          <>
            <h1>Confirming your payment...</h1>
            <p>Waiting for Stripe to tell our server the payment went through.</p>
          </>
        )}
        {state.kind === 'paid' && (
          <>
            {state.demo && <p className="demo-badge">Demo mode - no payment was taken</p>}
            <h1 data-testid="success-title">Your Phuket pass is active.</h1>
            <p>
              The hidden places are unlocked on the map. Go and collect them: each one only counts when you are really there.
            </p>
            <a className="btn btn-sand btn-big" href="/#map">
              Open the map
            </a>
          </>
        )}
        {state.kind === 'pending' && (
          <>
            <h1>Payment received, still confirming.</h1>
            <p>Stripe has not confirmed the payment to our server yet. Refresh this page in a minute.</p>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <h1>Something went wrong.</h1>
            <p role="alert">{state.message}</p>
            <a className="btn btn-sand" href="/#pricing">
              Back to the pass
            </a>
          </>
        )}
      </div>
    </main>
  )
}
