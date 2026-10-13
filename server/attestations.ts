import { attestationEnvelope, type AttestationStatus, type CheckinReceipt } from '../shared/checkin.js'
import { AttestationError, type AttestContext, type Attestor } from './attestor.js'
import type { ReceiptSigner } from './receipts.js'
import { MemoryStore, type Store } from './store.js'

/** How long a status is kept after its last change. */
export const ATTESTATION_STATUS_TTL_MS = 24 * 3_600_000

export interface AttestationQueueOptions {
  /** Extra attempts after a failed attestation. */
  retries?: number
  retryDelayMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  store?: Store<AttestationStatus>
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Writes check-ins to Stellar in the background, one at a time, and keeps the status per
 * proof hash so the client can poll GET /api/attestation/:proofHash. A check-in is accepted as
 * soon as its receipt is signed; the on-chain record follows. A confirmed record is signed
 * together with the proof hash, so the tx link stored with a stamp cannot be swapped.
 */
export class AttestationQueue {
  private readonly statuses: Store<AttestationStatus>
  /** Work queued or in flight on this instance, by proof hash: answered as pending without a store read. */
  private readonly inFlight = new Map<string, Promise<AttestationStatus>>()
  private tail: Promise<unknown> = Promise.resolve()
  private waiting = 0

  constructor(
    private readonly attestor: Attestor,
    private readonly signer: ReceiptSigner,
    private readonly options: AttestationQueueOptions = {},
  ) {
    this.statuses = options.store ?? new MemoryStore({ ttlMs: ATTESTATION_STATUS_TTL_MS, maxEntries: 50_000, now: options.now })
  }

  get mode(): Attestor['mode'] {
    return this.attestor.mode
  }

  /** Number of attestations queued or in flight. */
  backlog(): number {
    return this.waiting
  }

  /** The status for this proof hash, from any instance when the store is shared. */
  async get(proofHash: string): Promise<AttestationStatus | undefined> {
    if (this.inFlight.has(proofHash)) return { status: 'pending' }
    return this.statuses.get(proofHash)
  }

  /** Queues the receipt. The promise settles with the final status (it never rejects). */
  submit(receipt: CheckinReceipt, context?: AttestContext): Promise<AttestationStatus> {
    const proofHash = receipt.proofHash
    const running = this.inFlight.get(proofHash)
    if (running) return running
    this.waiting += 1
    // Mark it pending in the store right away, so other instances can answer polls for it.
    const prepared = this.read(proofHash).then(async (known) => {
      if (known?.status === 'confirmed') return known
      await this.save(proofHash, { status: 'pending' })
      return undefined
    })
    const run = this.tail.then(() => prepared).then((known) => known ?? this.attempt(receipt, context))
    this.tail = run
    const settled = run.finally(() => {
      this.inFlight.delete(proofHash)
      this.waiting -= 1
    })
    this.inFlight.set(proofHash, settled)
    return settled
  }

  /** A store that cannot be read must not stop the attestation: treat it as unknown. */
  private async read(proofHash: string): Promise<AttestationStatus | undefined> {
    try {
      return await this.statuses.get(proofHash)
    } catch (err) {
      console.error('[verapass] could not read attestation status:', err instanceof Error ? err.message : err)
      return undefined
    }
  }

  /** A failed status write is logged, never retried as an attestation (that would write on chain twice). */
  private async save(proofHash: string, status: AttestationStatus): Promise<void> {
    try {
      await this.statuses.set(proofHash, status)
    } catch (err) {
      console.error('[verapass] could not save attestation status:', err instanceof Error ? err.message : err)
    }
  }

  private async attempt(receipt: CheckinReceipt, context?: AttestContext): Promise<AttestationStatus> {
    const retries = this.options.retries ?? 2
    const sleep = this.options.sleep ?? realSleep
    let lastError = 'unknown error'
    for (let i = 0; i <= retries; i++) {
      try {
        const record = await this.attestor.attest(receipt, context)
        const status: AttestationStatus = {
          status: 'confirmed',
          record,
          signature: this.signer.sign(attestationEnvelope(receipt.proofHash, record)),
        }
        await this.save(receipt.proofHash, status)
        return status
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        console.error('[verapass] attestation failed:', lastError)
        // A refusal by the contract (unknown place, revoked creator...) will not change on a retry.
        if (err instanceof AttestationError && !err.retryable) break
        if (i < retries) await sleep((this.options.retryDelayMs ?? 2000) * 2 ** i)
      }
    }
    const failed: AttestationStatus = { status: 'failed', message: 'Writing the record to Stellar failed. The signed receipt is still valid.' }
    await this.save(receipt.proofHash, failed)
    console.error(`[verapass] attestation gave up for ${receipt.proofHash.slice(0, 12)}: ${lastError}`)
    return failed
  }
}
