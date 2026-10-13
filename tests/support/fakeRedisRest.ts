import { DELETE_IF_EQUALS_SCRIPT, SYNC_TOKEN_HEADER, type FetchLike } from '../../server/redisStore'

type Arg = string | number
type Reply = { result: unknown } | { error: string }

interface Entry {
  value: string
  /** Absolute time in ms, or undefined for no expiry. */
  expiresAt?: number
}

export interface FakeRedisOptions {
  url?: string
  token?: string
  /** The clock key expiry runs on. Share it with the app under test. */
  now?: () => number
  /**
   * Serve reads (GET, PTTL) from a read replica that lags behind the primary, like an Upstash
   * database with read regions. The replica catches up only when a request carries an
   * upstash-sync-token at least as new as the primary's state, or when syncReplica() is called.
   * Writes, SET NX and scripts always run on the primary.
   */
  replica?: boolean
}

const READS = new Set(['GET', 'PTTL'])

/**
 * An in-process stand-in for an Upstash-style Redis REST endpoint: the base URL takes one command,
 * /pipeline and /multi-exec take a list. Implements the commands RedisStore and RedisCounter use
 * (GET, SET with PX/EX/NX/XX, DEL, INCRBY, PEXPIRE, PTTL, PING, and EVAL of the one
 * compare-and-delete script). Each request is handled after a macrotask, the way a network round
 * trip would interleave, and a /multi-exec block runs without any other request in between.
 * Every reply carries an upstash-sync-token header. Records every request so tests can check the
 * wire format. The same contract suites also run against a real endpoint (see backends.ts), so
 * this fake is not the only thing the store is tested against.
 */
export function fakeRedisRest(options: FakeRedisOptions = {}) {
  const url = (options.url ?? 'https://fake-redis.test').replace(/\/+$/, '')
  const token = options.token ?? 'fake-token'
  const now = options.now ?? Date.now
  const data = new Map<string, Entry>()
  let replicaData = new Map<string, Entry>()
  /** Primary state counter: one step per write command. Its string form is the sync token. */
  let seq = 0
  const requests: { path: string; body: unknown; authorization: string | null; syncToken: string | null }[] = []
  let down = false
  let failWhen: ((cmd: Arg[]) => boolean) | undefined

  const clone = () => new Map([...data].map(([k, e]) => [k, { ...e }]))
  /** Primary state after each write, so the replica can catch up to exactly a token's state. */
  const history: { seq: number; state: Map<string, Entry> }[] = []
  let replicaSeq = 0
  const syncReplica = () => {
    replicaData = clone()
    replicaSeq = seq
  }
  const catchUpTo = (target: number) => {
    if (target <= replicaSeq) return
    const snapshot = history.filter((h) => h.seq <= target).at(-1)
    if (!snapshot) return
    replicaData = new Map([...snapshot.state].map(([k, e]) => [k, { ...e }]))
    replicaSeq = snapshot.seq
  }

  const liveIn = (map: Map<string, Entry>, key: string): Entry | undefined => {
    const entry = map.get(key)
    if (!entry) return undefined
    if (entry.expiresAt !== undefined && entry.expiresAt <= now()) {
      map.delete(key)
      return undefined
    }
    return entry
  }
  const live = (key: string) => liveIn(data, key)

  const run = (cmd: Arg[]): Reply => {
    const [name, ...args] = cmd
    const key = String(args[0])
    const upper = String(name).toUpperCase()
    if (!READS.has(upper) && upper !== 'PING') seq += 1
    switch (upper) {
      case 'PING':
        return { result: 'PONG' }
      case 'GET':
        return { result: liveIn(options.replica ? replicaData : data, key)?.value ?? null }
      case 'SET': {
        if (typeof args[1] !== 'string') return { error: 'ERR value must be a string' }
        let expiresAt: number | undefined
        let nx = false
        let xx = false
        for (let i = 2; i < args.length; i++) {
          const flag = String(args[i]).toUpperCase()
          if (flag === 'PX' || flag === 'EX') {
            const n = Number(args[++i])
            if (!Number.isInteger(n) || n <= 0) return { error: 'ERR invalid expire time in set' }
            expiresAt = now() + (flag === 'EX' ? n * 1000 : n)
          } else if (flag === 'NX') nx = true
          else if (flag === 'XX') xx = true
          else return { error: 'ERR syntax error' }
        }
        const exists = live(key) !== undefined
        if ((nx && exists) || (xx && !exists)) return { result: null }
        data.set(key, { value: args[1], expiresAt })
        return { result: 'OK' }
      }
      case 'DEL': {
        let n = 0
        for (const k of args) if (live(String(k)) && data.delete(String(k))) n += 1
        return { result: n }
      }
      case 'INCRBY': {
        const delta = Number(args[1])
        if (!Number.isInteger(delta)) return { error: 'ERR value is not an integer or out of range' }
        const entry = live(key)
        const current = entry ? Number(entry.value) : 0
        if (!Number.isInteger(current)) return { error: 'ERR value is not an integer or out of range' }
        const next = current + delta
        // INCRBY keeps an existing expiry, like Redis.
        data.set(key, { value: String(next), expiresAt: entry?.expiresAt })
        return { result: next }
      }
      case 'PEXPIRE': {
        const entry = live(key)
        if (!entry) return { result: 0 }
        entry.expiresAt = now() + Number(args[1])
        return { result: 1 }
      }
      case 'PTTL': {
        const entry = liveIn(options.replica ? replicaData : data, key)
        if (!entry) return { result: -2 }
        return { result: entry.expiresAt === undefined ? -1 : entry.expiresAt - now() }
      }
      case 'EVAL': {
        // Only the compare-and-delete script is understood; anything else is refused loudly.
        const [script, numKeys, evalKey, expected] = args
        if (script !== DELETE_IF_EQUALS_SCRIPT || Number(numKeys) !== 1) return { error: 'ERR fake supports only the delete-if-equals script' }
        const entry = live(String(evalKey))
        if (!entry || entry.value !== String(expected)) return { result: 0 }
        data.delete(String(evalKey))
        return { result: 1 }
      }
      default:
        return { error: `ERR unknown command '${String(name)}'` }
    }
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', [SYNC_TOKEN_HEADER]: String(seq) } })
  const isCommand = (value: unknown): value is Arg[] =>
    Array.isArray(value) && value.length > 0 && value.every((a) => typeof a === 'string' || typeof a === 'number')

  const fetch: FetchLike = async (input, init) => {
    // Let other callers run first, as a network round trip would.
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (down) throw new TypeError('fetch failed')
    const headers = new Headers(init.headers)
    const body: unknown = JSON.parse(String(init.body))
    const path = input.startsWith(url) ? input.slice(url.length) : input
    if (failWhen && Array.isArray(body)) {
      const cmds = (isCommand(body) ? [body] : body) as unknown[]
      if (cmds.some((c) => isCommand(c) && failWhen?.(c))) throw new TypeError('fetch failed')
    }
    const syncToken = headers.get(SYNC_TOKEN_HEADER)
    requests.push({ path, body, authorization: headers.get('authorization'), syncToken })
    if (init.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    if (headers.get('authorization') !== `Bearer ${token}`) return json({ error: 'Unauthorized' }, 401)
    // A read replica waits until it has caught up with the token the client sent.
    if (options.replica && syncToken !== null) catchUpTo(Number(syncToken))
    const record = (reply: unknown) => {
      if (options.replica && history.at(-1)?.seq !== seq) history.push({ seq, state: clone() })
      return reply
    }
    if (path === '' || path === '/') {
      if (!isCommand(body)) return json({ error: 'ERR bad command' }, 400)
      const reply = record(run(body)) as Reply
      return json(reply, 'error' in reply ? 400 : 200)
    }
    if (path === '/pipeline' || path === '/multi-exec') {
      if (!Array.isArray(body) || !body.every(isCommand)) return json({ error: 'ERR bad pipeline' }, 400)
      // Synchronous loop: nothing else runs until the whole block is done.
      return json(record(body.map(run)))
    }
    return json({ error: 'Not found' }, 404)
  }

  return {
    url,
    token,
    fetch,
    data,
    requests,
    /** Makes every request fail at the network level, or recover. */
    setDown(value: boolean) {
      down = value
    },
    /** Fails, at the network level, every request that carries a matching command. Undefined clears it. */
    failCommands(predicate: ((cmd: Arg[]) => boolean) | undefined) {
      failWhen = predicate
    },
    /** Brings the read replica up to date with the primary (replica mode only). */
    syncReplica,
  }
}

export type FakeRedis = ReturnType<typeof fakeRedisRest>
