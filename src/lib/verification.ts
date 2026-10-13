import { useEffect, useSyncExternalStore } from 'react'
import { verifyStamp, type VerifiableStamp, type VerifyReport } from '../../shared/verify'
import { api } from './api'
import type { Stamp } from './passport'

/**
 * - verified: the preimage hashes to the proof hash and the current server key signed it
 * - other-key: consistent, but signed by a key this server does not use (a restart without
 *   RECEIPT_SIGNING_KEY, or a stamp made somewhere else)
 * - invalid: edited or forged
 * - unsupported: this browser cannot check Ed25519 signatures
 */
export type Verdict = 'checking' | 'verified' | 'other-key' | 'invalid' | 'unsupported'

export function verdictOf(report: VerifyReport): Exclude<Verdict, 'checking'> {
  if (report.unsupported) return 'unsupported'
  const consistent = report.proofHashMatches && report.receiptMatchesProof && report.signatureValid && report.attestationValid !== false
  if (!consistent) return 'invalid'
  return report.keyMatches ? 'verified' : 'other-key'
}

/** A stamp counts towards the passport unless it failed a check. */
export function counts(verdict: Verdict | undefined): boolean {
  return verdict !== 'invalid' && verdict !== 'other-key'
}

export function toVerifiable(s: Stamp): VerifiableStamp {
  return {
    receipt: s.receipt,
    signature: s.signature,
    publicKey: s.publicKey,
    proof: s.proof,
    attestation: s.attestation.status === 'confirmed' ? { record: s.attestation.record, signature: s.attestation.signature } : null,
  }
}

function keyOf(s: Stamp): string {
  return `${s.proofHash}:${s.attestation.status}`
}

const verdicts = new Map<string, Verdict>()
let snapshot: ReadonlyMap<string, Verdict> = new Map()
const listeners = new Set<() => void>()

function publish(): void {
  snapshot = new Map(verdicts)
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

async function check(stamps: Stamp[]): Promise<void> {
  const todo = stamps.filter((s) => !verdicts.has(keyOf(s)))
  if (todo.length === 0) return
  todo.forEach((s) => verdicts.set(keyOf(s), 'checking'))
  publish()
  const pinned = (await api.health())?.receiptPublicKey ?? null
  await Promise.all(
    todo.map(async (s) => {
      verdicts.set(keyOf(s), verdictOf(await verifyStamp(toVerifiable(s), pinned)))
    }),
  )
  publish()
}

/** Verdict per stamp, keyed by proof hash. Checks run in the browser against the server's published key. */
export function useStampVerdicts(stamps: Stamp[]): Map<string, Verdict> {
  const all = useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
  useEffect(() => {
    void check(stamps)
  }, [stamps])
  return new Map(stamps.map((s) => [s.proofHash, all.get(keyOf(s)) ?? 'checking']))
}
