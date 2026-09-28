// Browser storage helpers: ask the browser to keep our data (not evicted when the phone is low on space).

export interface StorageInfo {
  persisted: boolean | null // null = the browser can't tell
  usage: number | null // bytes
  quota: number | null // bytes
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function storageInfo(): Promise<StorageInfo> {
  const out: StorageInfo = { persisted: null, usage: null, quota: null }
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) return out
    if (navigator.storage.persisted) out.persisted = await navigator.storage.persisted()
    if (navigator.storage.estimate) {
      const e = await navigator.storage.estimate()
      out.usage = e.usage ?? null
      out.quota = e.quota ?? null
    }
  } catch {
    /* not supported */
  }
  return out
}

/** 1536000 → '1.5 MB' */
export function formatBytes(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '–'
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

// ---- small localStorage helpers for per-device UI memory (keys start with 'pratunam.')

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode — ignore */
  }
}

export const LAST_BACKUP_KEY = 'pratunam.lastBackupAt.v1'
