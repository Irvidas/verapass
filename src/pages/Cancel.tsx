import { Logo } from '../components/Logo'

export function Cancel() {
  return (
    <main id="main" className="result night">
      <div className="result-card">
        <a href="/" aria-label="Verapass home">
          <Logo />
        </a>
        <h1>Checkout cancelled.</h1>
        <p>No payment was taken. Your free passport and any stamps you collected are still here.</p>
        <a className="btn btn-sand" href="/#pricing">
          Back to the pass
        </a>
      </div>
    </main>
  )
}
