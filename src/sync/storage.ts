// Small key/value store for sync bookkeeping (bound backend URL, LINE outbox).
// localStorage when available, in-memory otherwise (private mode, tests).

export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string | null): void
}

export function memoryStorage(): KeyValueStore {
  const m = new Map<string, string>()
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => {
      if (v === null) m.delete(k)
      else m.set(k, v)
    },
  }
}

export function browserStorage(): KeyValueStore {
  const fallback = memoryStorage()
  const ls = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage
    } catch {
      return null
    }
  }
  return {
    get: (k) => {
      try {
        const s = ls()
        return s ? s.getItem(k) : fallback.get(k)
      } catch {
        return fallback.get(k)
      }
    },
    set: (k, v) => {
      fallback.set(k, v)
      try {
        const s = ls()
        if (!s) return
        if (v === null) s.removeItem(k)
        else s.setItem(k, v)
      } catch {
        /* quota / private mode — the in-memory copy still works for this session */
      }
    },
  }
}
