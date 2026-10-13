import { useEffect } from 'react'
import { Logo } from '../components/Logo'

/** Any path the app does not know. The server answers these with a 404 status as well. */
export function NotFound() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    document.title = 'Page not found - Verapass'
    return () => meta.remove()
  }, [])
  return (
    <main id="main" className="result night">
      <div className="result-card">
        <a href="/" aria-label="Verapass home">
          <Logo />
        </a>
        <h1>This page is not on the map.</h1>
        <p>Nothing lives at this address. The places that do exist are on the home page, each one checked by a real person.</p>
        <a className="btn btn-sand" href="/">
          Back to Verapass
        </a>
      </div>
    </main>
  )
}
