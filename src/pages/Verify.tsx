import { useEffect, useState } from 'react'
import { proofHashOf, verifyStamp, type VerifiableStamp, type VerifyReport } from '../../shared/verify'
import { Logo } from '../components/Logo'
import type { Attestation } from '../../shared/checkin'
import { api } from '../lib/api'
import { explorerHref } from '../lib/explorer'
import { isStamp } from '../lib/passport'
import { passportStore } from '../lib/usePassport'
import { toVerifiable } from '../lib/verification'
import { decodeStamp } from '../lib/verifyLink'

function ExplorerLink({ url, children }: { url: string | undefined; children: string }) {
  const href = explorerHref(url)
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <>{children}</>
  )
}

/** Where to find the stamp on chain, and what to compare there. */
function ChainRecord({ record }: { record: Attestation }) {
  const contract = record.contract
  if (!contract) {
    return (
      <p>
        Find this hash as the memo of the transaction on <ExplorerLink url={record.explorerUrl}>stellar.expert (testnet)</ExplorerLink>.
      </p>
    )
  }
  const token = contract.tokenId !== undefined ? `token #${contract.tokenId}` : 'a token'
  if (contract.alreadyStamped) {
    return (
      <p>
        This passport already had a stamp for this place from an earlier visit, so no new one was minted. The stamp on chain is {token} on the{' '}
        <ExplorerLink url={contract.url}>Verapass stamps contract</ExplorerLink>, and its receipt hash is the one from that first visit.
      </p>
    )
  }
  return (
    <p>
      This stamp is {token} on the <ExplorerLink url={contract.url}>Verapass stamps contract</ExplorerLink> (testnet), owned by the
      passport address <code>{contract.traveller.slice(0, 8)}...{contract.traveller.slice(-6)}</code>. The <code>stamped</code> event in{' '}
      <ExplorerLink url={record.explorerUrl}>its transaction on stellar.expert</ExplorerLink> carries the proof hash above as{' '}
      <code>receipt_hash</code>.
    </p>
  )
}

function isVerifiable(v: unknown): v is VerifiableStamp {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return typeof s.signature === 'string' && typeof s.publicKey === 'string' && Boolean(s.receipt) && Boolean(s.proof)
}

/** Accepts a stamp from the passport (or this page's own format) as JSON. */
function parseInput(text: string): VerifiableStamp | null {
  try {
    const data: unknown = JSON.parse(text)
    if (isStamp(data)) return toVerifiable(data)
    return isVerifiable(data) ? data : null
  } catch {
    return null
  }
}

function fromHash(): string {
  const m = /stamp=([\w-]+)/.exec(window.location.hash)
  if (!m?.[1]) return ''
  try {
    return JSON.stringify(decodeStamp(m[1]), null, 2)
  } catch {
    return ''
  }
}

const CHECKS: { key: keyof VerifyReport; label: string; detail: string }[] = [
  { key: 'proofHashMatches', label: 'The proof hashes to the recorded proof hash', detail: 'sha256 of the canonical JSON of the preimage (place, time, location fix, one-time code).' },
  { key: 'receiptMatchesProof', label: 'The receipt says the same as the proof', detail: 'Traveller, place, server time, accuracy and the simulated flag.' },
  { key: 'signatureValid', label: 'The receipt signature is valid', detail: 'Ed25519, over the canonical JSON of the receipt.' },
  { key: 'keyMatches', label: 'It was signed by the Verapass server key', detail: 'Compared with the key the server publishes at /api/health.' },
  { key: 'attestationValid', label: 'The Stellar record belongs to this proof', detail: 'The tx id is signed together with the proof hash, so it cannot be swapped.' },
]

/**
 * Check a stamp without trusting the Verapass database. Everything runs in this browser with
 * WebCrypto: the same code as shared/verify.ts, which anyone can read and run themselves.
 */
interface Result {
  error: string | null
  report: VerifyReport | null
  hash: string | null
}

async function check(input: string, serverKey: string | null): Promise<Result> {
  if (!input.trim()) return { error: null, report: null, hash: null }
  const stamp = parseInput(input)
  if (!stamp) return { error: 'That is not a Verapass stamp. Paste the JSON from a passport, or open a stamp link.', report: null, hash: null }
  return { error: null, hash: await proofHashOf(stamp.proof), report: await verifyStamp(stamp, serverKey) }
}

export function Verify() {
  const [text, setText] = useState(fromHash)
  /** The text last sent for checking. A stamp link checks itself on arrival. */
  const [submitted, setSubmitted] = useState(text)
  const [serverKey, setServerKey] = useState<string | null | undefined>(undefined)
  const [result, setResult] = useState<Result>({ error: null, report: null, hash: null })
  const mine = passportStore.getState().stamps

  useEffect(() => {
    let alive = true
    void api.health().then((h) => alive && setServerKey(h?.receiptPublicKey ?? null))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (serverKey === undefined) return
    let alive = true
    void check(submitted, serverKey).then((r) => alive && setResult(r))
    return () => {
      alive = false
    }
  }, [submitted, serverKey])

  const { report, hash, error } = result
  const stamp = parseInput(text)
  const record = stamp?.attestation?.record

  return (
    <main id="main" className="result night verify-page">
      <div className="result-card verify-card-page">
        <a href="/" aria-label="Verapass home">
          <Logo />
        </a>
        <h1>Check a stamp</h1>
        <p>
          A Verapass stamp carries its own proof. This page recomputes the proof hash and checks the server&apos;s signatures in
          your browser. Nothing you paste here is sent anywhere.
        </p>
        {mine.length > 0 && (
          <div className="verify-mine">
            <span>From this browser&apos;s passport:</span>
            {mine.map((s) => (
              <button
                key={s.proofHash}
                type="button"
                className="chip"
                onClick={() => {
                  const json = JSON.stringify(toVerifiable(s), null, 2)
                  setText(json)
                  setSubmitted(json)
                }}
              >
                {s.placeId}
              </button>
            ))}
          </div>
        )}
        <label htmlFor="stamp-json" className="verify-label">
          Stamp JSON
        </label>
        <textarea id="stamp-json" value={text} onChange={(e) => setText(e.target.value)} rows={10} spellCheck={false} />
        <button type="button" className="btn btn-sand" onClick={() => setSubmitted(text)}>
          Check it
        </button>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        {report && (
          <section className="verify-report" aria-labelledby="verify-result" aria-live="polite">
            <h2 id="verify-result" className={report.ok ? 'is-ok' : 'is-bad'}>
              {report.unsupported ? 'This browser cannot check Ed25519 signatures.' : report.ok ? 'This stamp checks out.' : 'This stamp does not check out.'}
            </h2>
            <ul>
              {CHECKS.map((c) => {
                const v = report[c.key]
                const state = v === null ? 'skip' : v ? 'pass' : 'fail'
                return (
                  <li key={c.key} className={`check-${state}`}>
                    <b>
                      {state === 'pass' ? 'Pass' : state === 'fail' ? 'Fail' : 'No record yet'}: {c.label}
                    </b>
                    <small>{c.detail}</small>
                  </li>
                )
              })}
            </ul>
            {hash && (
              <p className="verify-hash">
                Proof hash <code>{hash}</code>
              </p>
            )}
            {record?.mode === 'testnet' && <ChainRecord record={record} />}
            {record?.mode === 'mock' && <p>This stamp has a mock record: the server that made it had no Stellar key, so nothing is on chain.</p>}
            {stamp?.receipt.simulated && <p>This was a simulated (demo) visit, not a real one.</p>}
          </section>
        )}
        <p className="fineprint">
          Server key {serverKey ? <code>{serverKey.slice(0, 24)}...</code> : 'unavailable (the check still runs, without the key comparison)'}
        </p>
        <a className="link-btn link-light" href="/#passport">
          Back to the passport
        </a>
      </div>
    </main>
  )
}
