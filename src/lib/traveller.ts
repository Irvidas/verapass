import { api, ApiError } from './api'
import type { PassportStore } from './passport'

/**
 * The traveller id is issued and signed by the server. The first call that needs one asks for
 * it; if the server no longer accepts the stored id (it restarted without TRAVELLER_SECRET),
 * a new one is fetched and the call is retried once.
 */
export function createTravellerSession(store: PassportStore, issue: () => Promise<string> = async () => (await api.traveller()).traveller) {
  let inflight: Promise<string> | null = null

  const renew = (): Promise<string> => {
    inflight ??= issue()
      .then((id) => {
        store.setTraveller(id)
        return id
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  const ensure = async (): Promise<string> => store.getState().traveller ?? renew()

  /** Runs a server call with the traveller id, renewing the id once if the server refuses it. */
  const withTraveller = async <T>(call: (traveller: string) => Promise<T>): Promise<T> => {
    const traveller = await ensure()
    try {
      return await call(traveller)
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'traveller-invalid') throw err
      return call(await renew())
    }
  }

  return { ensure, withTraveller }
}
