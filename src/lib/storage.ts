/** Minimal key-value storage, so the passport store can run against localStorage or an in-memory map. */
export interface KVStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** localStorage when the browser allows it (private windows and blocked site data can throw). */
export function browserStorage(): KVStorage | null {
  try {
    const ls = window.localStorage
    const probe = '__verapass_probe__'
    ls.setItem(probe, '1')
    ls.removeItem(probe)
    return ls
  } catch {
    return null
  }
}

export function memoryStorage(): KVStorage {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}
