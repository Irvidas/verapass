import { Logo } from '../components/Logo'

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-grid">
        <div>
          <Logo />
          <p className="footer-blurb">
            A proof-of-presence travel passport on Stellar. Real people, real places, proven on chain. Pilot in Phuket with
            Sukanya, a licensed local guide.
          </p>
        </div>
        <nav aria-label="Footer">
          <h3>Explore</h3>
          <ul>
            <li>
              <a href="#problem">The problem</a>
            </li>
            <li>
              <a href="#map">Try a check-in</a>
            </li>
            <li>
              <a href="#passport">Your passport</a>
            </li>
            <li>
              <a href="#guides">For guides</a>
            </li>
            <li>
              <a href="#services">Services</a>
            </li>
            <li>
              <a href="/verify">Check a stamp</a>
            </li>
          </ul>
        </nav>
        <div>
          <h3>Team</h3>
          <ul>
            <li>Irvidas Bulotas, engineering</li>
            <li>Zygimantas Bagdzevicius, fractional CTO</li>
            <li>
              <a href="mailto:sukanyathaiguide@gmail.com">Contact Sukanya</a>
            </li>
          </ul>
        </div>
      </div>
      <p className="copy wrap">
        Copyright 2026 Verapass - Thailand with Sukanya. Demo build: Stripe test mode, Stellar testnet. Not affiliated with the Tourism
        Authority of Thailand.
      </p>
    </footer>
  )
}
