import { expect } from 'vitest'
import type { CheckinError, CheckinResponse, NonceResponse, TravellerResponse } from '../../shared/checkin'
import { createApp, type AppDeps } from '../../server/app'
import { MockAttestor } from '../../server/attestor'
import { createReceiptSigner } from '../../server/receipts'
import type { StateBackend } from '../../server/store'

export const WEBHOOK_SECRET = 'whsec_test_integration_secret'
export const TRAVELLER_SECRET = 'integration-test-traveller-secret'

/**
 * An app on a fake clock. Requests come from `ip` (X-Forwarded-For, trusted in tests).
 * `state` builds the state backend on the same clock (in memory when left out).
 */
export function setup(overrides: Partial<AppDeps> = {}, state?: (now: () => number) => StateBackend) {
  let t = 1_760_000_000_000
  const signer = overrides.signer ?? createReceiptSigner()
  const app = createApp({
    publicOrigin: 'http://localhost:5173',
    attestor: new MockAttestor(),
    signer,
    allowSimulated: true,
    travellerSecret: TRAVELLER_SECRET,
    trustProxy: true,
    attestationWaitMs: 200,
    attestationRetryDelayMs: 0,
    now: () => t,
    state: state?.(() => t),
    ...overrides,
  })
  const post = (path: string, body: unknown, headers: Record<string, string> = {}, ip = '203.0.113.1') =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  const get = (path: string, ip = '203.0.113.1') => app.request(path, { headers: { 'x-forwarded-for': ip } })
  return {
    app,
    signer,
    post,
    get,
    now: () => t,
    advance: (ms: number) => void (t += ms),
  }
}

export type Ctx = ReturnType<typeof setup>

export async function newTraveller(ctx: Ctx, ip?: string): Promise<string> {
  const res = await ctx.post('/api/traveller', {}, {}, ip)
  expect(res.status).toBe(200)
  return ((await res.json()) as TravellerResponse).traveller
}

export async function nonceFor(ctx: Ctx, traveller: string, placeId: string, ip?: string): Promise<NonceResponse> {
  const res = await ctx.post('/api/nonce', { traveller, placeId }, {}, ip)
  expect(res.status).toBe(200)
  return (await res.json()) as NonceResponse
}

export async function checkin(ctx: Ctx, body: Record<string, unknown>, ip?: string) {
  const res = await ctx.post('/api/checkin', body, {}, ip)
  return { status: res.status, body: (await res.json()) as CheckinResponse & CheckinError }
}

export function at(place: { lat: number; lng: number }, extra: Record<string, unknown> = {}) {
  return { lat: place.lat + 0.0001, lng: place.lng, accuracy: 15, ...extra }
}

/** Nonce plus check-in at the place, in one step. */
export async function visit(ctx: Ctx, traveller: string, place: { id: string; lat: number; lng: number }, extra: Record<string, unknown> = {}, ip?: string) {
  const { nonce } = await nonceFor(ctx, traveller, place.id, ip)
  return checkin(ctx, { traveller, placeId: place.id, nonce, deviceTs: ctx.now(), ...at(place), ...extra }, ip)
}

/** A promise you resolve from outside. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
