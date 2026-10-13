import { memoryBackend, type Counter, type StateBackend } from './store.js'

export interface RateLimitResult {
  ok: boolean
  /** How long until one more request would be allowed (0 when ok). */
  retryAfterMs: number
}

export interface RateLimiterOptions {
  now?: () => number
  /** In-memory only: cap on tracked keys. */
  maxKeys?: number
  /** Where the counts live. In memory by default; a shared backend counts across instances. */
  backend?: StateBackend
  /** Keeps the counters of different limiters apart in a shared backend. */
  name?: string
}

/**
 * Sliding-window counter: the count of the current fixed window plus a weighted share of the
 * previous one. Close to a true sliding log, with one small counter per key and window.
 * A refused request is not counted.
 */
export class RateLimiter {
  private readonly counts: Counter
  private readonly now: () => number

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    options: RateLimiterOptions = {},
  ) {
    this.now = options.now ?? Date.now
    const backend = options.backend ?? memoryBackend(this.now)
    // A window's counter is read during the next window too, so it lives for two.
    this.counts = backend.counter(`rate:${options.name ?? 'default'}:${windowMs}`, {
      ttlMs: windowMs * 2,
      maxEntries: options.maxKeys ?? 100_000,
    })
  }

  /** Counts one request for the key and says whether it is allowed. */
  async hit(key: string): Promise<RateLimitResult> {
    const now = this.now()
    const currentStart = now - (now % this.windowMs)
    const currentKey = `${key}:${currentStart}`
    const [count, previous] = await Promise.all([
      this.counts.increment(currentKey),
      this.counts.get(`${key}:${currentStart - this.windowMs}`),
    ])
    const elapsed = (now - currentStart) / this.windowMs
    // Requests before this one: the previous window's weighted share plus this window's count.
    const estimate = previous * (1 - elapsed) + (count - 1)
    if (estimate >= this.limit) {
      await this.counts.increment(currentKey, -1)
      return { ok: false, retryAfterMs: Math.max(1, Math.ceil(this.windowMs - (now - currentStart))) }
    }
    return { ok: true, retryAfterMs: 0 }
  }
}
