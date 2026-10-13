/**
 * Key-value state with a time-to-live. Every piece of server state (nonces, last fixes, passes,
 * rate-limit counters, attestation status) goes through these interfaces, so the same code runs
 * on one in-process map (local dev, tests, a single Node server) or on a shared Redis-compatible
 * store (several Vercel instances). Every method is async so a network store fits behind it.
 */
export interface Store<V> {
  get(key: string): Promise<V | undefined>
  /** Writes the value and restarts its time to live. */
  set(key: string, value: V): Promise<void>
  /**
   * Writes the value only when the key is absent (or expired). True when this call wrote it.
   * Atomic: of two calls racing for the same key, exactly one gets true.
   */
  add(key: string, value: V): Promise<boolean>
  delete(key: string): Promise<void>
  /**
   * Deletes the key only while it still holds this value (compared as JSON). True when it deleted.
   * Atomic: lets the owner of a lock release it without deleting a lock someone else took over.
   */
  deleteIf(key: string, value: V): Promise<boolean>
}

/** Integer counters with a time-to-live, restarted on every increment. */
export interface Counter {
  /** Adds delta (may be negative) and returns the new count. Atomic. A missing key counts as 0. */
  increment(key: string, delta?: number): Promise<number>
  get(key: string): Promise<number>
}

export interface StoreOptions {
  /** How long an entry lives after its last write. */
  ttlMs: number
  /** In-memory only: oldest entries are dropped first once the store holds more than this. */
  maxEntries: number
}

/**
 * Makes stores and counters for one backend. The namespace keeps the keys of different stores
 * apart when they share one database.
 */
export interface StateBackend {
  readonly kind: 'memory' | 'redis'
  store<V>(namespace: string, options: StoreOptions): Store<V>
  counter(namespace: string, options: StoreOptions): Counter
}

/** A store call that could not reach the backing database. The API answers 503. */
export class StoreError extends Error {
  override name = 'StoreError'
}

interface Entry<V> {
  value: V
  expiresAt: number
}

export interface MemoryStoreOptions extends StoreOptions {
  now?: () => number
}

/**
 * In-process implementation. Expired entries are dropped on read and in a sweep every few writes.
 * The work happens synchronously inside each async call, so every call is atomic on its own.
 */
export class MemoryStore<V> implements Store<V> {
  private readonly entries = new Map<string, Entry<V>>()
  private readonly now: () => number
  private writes = 0

  constructor(private readonly options: MemoryStoreOptions) {
    this.now = options.now ?? Date.now
  }

  async get(key: string): Promise<V | undefined> {
    return this.getSync(key)
  }

  async set(key: string, value: V): Promise<void> {
    this.setSync(key, value)
  }

  async add(key: string, value: V): Promise<boolean> {
    if (this.getSync(key) !== undefined) return false
    this.setSync(key, value)
    return true
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async deleteIf(key: string, value: V): Promise<boolean> {
    const current = this.getSync(key)
    if (current === undefined || JSON.stringify(current) !== JSON.stringify(value)) return false
    this.entries.delete(key)
    return true
  }

  /** Entries held right now, expired ones included until they are swept. */
  size(): number {
    return this.entries.size
  }

  *values(): IterableIterator<V> {
    const now = this.now()
    for (const entry of this.entries.values()) if (entry.expiresAt > now) yield entry.value
  }

  /** Drops every expired entry. */
  sweep(): void {
    const now = this.now()
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key)
  }

  /** Synchronous get, for in-process read-modify-write steps that must not yield in between. */
  getSync(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  /** Synchronous set, see getSync. */
  setSync(key: string, value: V): void {
    // Delete first, so the key moves to the end of the insertion order (newest).
    this.entries.delete(key)
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs })
    this.writes += 1
    if (this.writes % 64 === 0) this.sweep()
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }
}

/**
 * In-process counter on top of a MemoryStore. Read and write happen in one synchronous step
 * (no await in between), so concurrent increments are never lost.
 */
export class MemoryCounter implements Counter {
  private readonly store: MemoryStore<number>

  constructor(options: MemoryStoreOptions) {
    this.store = new MemoryStore<number>(options)
  }

  async increment(key: string, delta = 1): Promise<number> {
    const next = (this.store.getSync(key) ?? 0) + Math.trunc(delta)
    this.store.setSync(key, next)
    return next
  }

  async get(key: string): Promise<number> {
    return this.store.getSync(key) ?? 0
  }
}

/** State in this process only. Lost on restart and not shared between instances. */
export function memoryBackend(now?: () => number): StateBackend {
  return {
    kind: 'memory',
    store: <V>(_namespace: string, options: StoreOptions) => new MemoryStore<V>({ ...options, now }),
    counter: (_namespace: string, options: StoreOptions) => new MemoryCounter({ ...options, now }),
  }
}
