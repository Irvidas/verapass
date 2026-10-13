import { StoreError, type Counter, type StateBackend, type Store, type StoreOptions } from './store.js'

/**
 * Stores on a Redis-compatible REST endpoint (the Upstash REST protocol, which Vercel's Redis
 * integration provides). Uses global fetch only:
 *
 * - one command:  POST <url>            body ["SET","k","v","PX","1000"]   -> {"result": ...}
 * - a pipeline:   POST <url>/pipeline   body [["GET","a"],["GET","b"]]     -> [{"result": ...}, ...]
 * - a transaction POST <url>/multi-exec body as for a pipeline, run as MULTI/EXEC
 *
 * Every request carries "Authorization: Bearer <token>". Errors come back as {"error": "..."}.
 * Time-to-live is enforced by Redis (PX on every write), matching MemoryStore: an entry lives
 * ttlMs after its last write. The in-memory size cap does not apply; Redis evicts by its own
 * maxmemory policy, and every key here has a TTL.
 *
 * Read your writes: an Upstash database with read replicas may answer a GET from a replica that
 * has not seen the latest write yet. Every reply carries an "upstash-sync-token" header (the
 * primary's state); the client sends the latest one back, so a read waits until the replica has
 * caught up with it. That matters for the check-in lock: the token from winning SET NX covers the
 * last fix the previous lock holder wrote, so the speed check never reads an older one.
 */

export type RedisArg = string | number
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface RedisRestOptions {
  url: string
  token: string
  /** Put in front of every key, so several deployments can share one database. */
  prefix?: string
  /** Per-request timeout. */
  timeoutMs?: number
  /** Injected in tests. Defaults to the global fetch. */
  fetch?: FetchLike
}

type Reply = { result?: unknown; error?: string }

/** Response header (and request header) for Upstash read-your-writes consistency. */
export const SYNC_TOKEN_HEADER = 'upstash-sync-token'

/**
 * Deletes KEYS[1] only while it holds ARGV[1]. One script, so GET and DEL run with nothing in
 * between (Redis runs a script atomically). Returns 1 when it deleted, else 0.
 */
export const DELETE_IF_EQUALS_SCRIPT = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end"

export class RedisRestClient {
  private readonly url: string
  private readonly fetchFn: FetchLike
  private readonly timeoutMs: number
  /** Latest upstash-sync-token seen, sent with the next request. Same rule as the official SDK. */
  private syncToken: string | undefined

  constructor(private readonly options: RedisRestOptions) {
    this.url = options.url.replace(/\/+$/, '')
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? 5000
  }

  /** Runs one command and returns its result. */
  async command(args: RedisArg[]): Promise<unknown> {
    return this.unwrap(await this.post('', args), String(args[0]))
  }

  /** Runs several commands in one round trip. Not atomic: use transaction() for that. */
  async pipeline(commands: RedisArg[][]): Promise<unknown[]> {
    return this.many('/pipeline', commands)
  }

  /** Runs several commands as one MULTI/EXEC block: no other client's command runs in between. */
  async transaction(commands: RedisArg[][]): Promise<unknown[]> {
    return this.many('/multi-exec', commands)
  }

  private async many(path: string, commands: RedisArg[][]): Promise<unknown[]> {
    const body = await this.post(path, commands)
    if (!Array.isArray(body)) {
      throw this.error(`Redis REST ${path.slice(1)} failed: ${describe(body)}`)
    }
    if (body.length !== commands.length) {
      throw this.error(`Redis REST ${path.slice(1)} returned ${body.length} replies for ${commands.length} commands`)
    }
    return body.map((reply, i) => this.unwrap(reply, String(commands[i]?.[0])))
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.options.token}`, 'content-type': 'application/json' }
    if (this.syncToken) headers[SYNC_TOKEN_HEADER] = this.syncToken
    let res: Response
    try {
      res = await this.fetchFn(`${this.url}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      // Never echo the request: it carries the token in a header and user ids in the body.
      throw this.error(`Redis REST request failed: ${err instanceof Error ? err.name : 'network error'}`)
    }
    const token = res.headers.get(SYNC_TOKEN_HEADER)
    if (token) this.syncToken = token
    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw this.error(`Redis REST answered ${res.status} without JSON`)
    }
    if (!res.ok) throw this.error(`Redis REST answered ${res.status}: ${describe(body)}`)
    return body
  }

  private unwrap(reply: unknown, command: string): unknown {
    if (!reply || typeof reply !== 'object') throw this.error(`Redis REST ${command}: unexpected reply`)
    const r = reply as Reply
    if (typeof r.error === 'string') throw this.error(`Redis REST ${command}: ${r.error.slice(0, 200)}`)
    return r.result ?? null
  }

  /** A StoreError whose message can never carry the token, whatever the endpoint echoed back. */
  private error(message: string): StoreError {
    const token = this.options.token
    return new StoreError(token ? message.split(token).join('[redacted]') : message)
  }
}

function describe(body: unknown): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error.slice(0, 200)
  return 'unexpected reply'
}

function parse<V>(raw: unknown): V | undefined {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw !== 'string') throw new StoreError('Redis REST GET: expected a string value')
  try {
    return JSON.parse(raw) as V
  } catch {
    throw new StoreError('Redis REST GET: stored value is not JSON')
  }
}

function ttl(options: StoreOptions): number {
  return Math.max(1, Math.ceil(options.ttlMs))
}

export class RedisStore<V> implements Store<V> {
  constructor(
    private readonly client: RedisRestClient,
    private readonly keyPrefix: string,
    private readonly options: StoreOptions,
  ) {}

  async get(key: string): Promise<V | undefined> {
    return parse<V>(await this.client.command(['GET', this.keyPrefix + key]))
  }

  async set(key: string, value: V): Promise<void> {
    await this.client.command(['SET', this.keyPrefix + key, JSON.stringify(value), 'PX', ttl(this.options)])
  }

  async add(key: string, value: V): Promise<boolean> {
    // SET NX is atomic on the server: of two racing calls, only one gets "OK".
    const reply = await this.client.command(['SET', this.keyPrefix + key, JSON.stringify(value), 'PX', ttl(this.options), 'NX'])
    return reply === 'OK'
  }

  async delete(key: string): Promise<void> {
    await this.client.command(['DEL', this.keyPrefix + key])
  }

  async deleteIf(key: string, value: V): Promise<boolean> {
    const reply = await this.client.command(['EVAL', DELETE_IF_EQUALS_SCRIPT, 1, this.keyPrefix + key, JSON.stringify(value)])
    return Number(reply) === 1
  }
}

export class RedisCounter implements Counter {
  constructor(
    private readonly client: RedisRestClient,
    private readonly keyPrefix: string,
    private readonly options: StoreOptions,
  ) {}

  async increment(key: string, delta = 1): Promise<number> {
    const k = this.keyPrefix + key
    // In one transaction, so a counter never exists without its expiry.
    const [count] = await this.client.transaction([
      ['INCRBY', k, Math.trunc(delta)],
      ['PEXPIRE', k, ttl(this.options)],
    ])
    const n = Number(count)
    if (!Number.isFinite(n)) throw new StoreError('Redis REST INCRBY: expected an integer')
    return n
  }

  async get(key: string): Promise<number> {
    const raw = await this.client.command(['GET', this.keyPrefix + key])
    if (raw === null || raw === undefined) return 0
    const n = Number(raw)
    if (!Number.isFinite(n)) throw new StoreError('Redis REST GET: counter is not a number')
    return n
  }
}

export const DEFAULT_REDIS_PREFIX = 'verapass:'

/** State in a shared Redis-compatible database. Survives restarts and is shared by every instance. */
export function redisBackend(options: RedisRestOptions): StateBackend {
  const client = new RedisRestClient(options)
  const prefix = options.prefix ?? DEFAULT_REDIS_PREFIX
  return {
    kind: 'redis',
    store: <V>(namespace: string, storeOptions: StoreOptions) => new RedisStore<V>(client, `${prefix}${namespace}:`, storeOptions),
    counter: (namespace: string, storeOptions: StoreOptions) => new RedisCounter(client, `${prefix}${namespace}:`, storeOptions),
  }
}
