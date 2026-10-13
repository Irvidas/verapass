import { randomBytes } from 'node:crypto'
import { redisBackend } from '../../server/redisStore'
import { memoryBackend, type StateBackend } from '../../server/store'
import { fakeRedisRest } from './fakeRedisRest'

/** A fake clock tests can move forward. */
export function clock(start = 1_760_000_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => void (t += ms) }
}

export interface BackendCase {
  name: string
  /** A fresh, empty backend whose expiry runs on the given clock (when it can). */
  make: (now: () => number) => StateBackend
  /**
   * True when key expiry runs on the real wall clock and ignores the fake one: a real Redis.
   * Tests that move the fake clock to expire keys are skipped for such a backend.
   */
  realClock: boolean
}

/**
 * A real Redis REST endpoint for the contract suites, opt-in:
 *   VERAPASS_TEST_REDIS_REST_URL=http://localhost:8079 VERAPASS_TEST_REDIS_REST_TOKEN=... npm test
 * Any Upstash database or a local serverless-redis-http container works. Every backend made
 * from it gets its own random key prefix, and every key has a time to live, so runs never clash
 * and leave nothing behind for long.
 */
const realUrl = process.env.VERAPASS_TEST_REDIS_REST_URL?.trim()
const realToken = process.env.VERAPASS_TEST_REDIS_REST_TOKEN?.trim()

/**
 * Every StateBackend implementation. Contract suites run once per entry with describe.each,
 * so the in-memory store and the Redis REST store are held to the same tests. The replica case
 * serves reads from a lagging copy, so it only passes because the client sends the sync token.
 */
export const BACKENDS: BackendCase[] = [
  { name: 'memory', make: (now) => memoryBackend(now), realClock: false },
  {
    name: 'redis-rest',
    make: (now) => {
      const fake = fakeRedisRest({ now })
      return redisBackend({ url: fake.url, token: fake.token, fetch: fake.fetch })
    },
    realClock: false,
  },
  {
    name: 'redis-rest with a lagging read replica',
    make: (now) => {
      const fake = fakeRedisRest({ now, replica: true })
      return redisBackend({ url: fake.url, token: fake.token, fetch: fake.fetch })
    },
    realClock: false,
  },
  ...(realUrl && realToken
    ? [
        {
          name: 'real redis-rest endpoint',
          make: () => redisBackend({ url: realUrl, token: realToken, prefix: `verapass-test-${randomBytes(6).toString('hex')}:` }),
          realClock: true,
        },
      ]
    : []),
]
