// Sync client API — STUB. The sync agent replaces the bodies (keep these exported signatures).
import { useSyncExternalStore } from 'react'

export type SyncState = 'off' | 'idle' | 'syncing' | 'ok' | 'error' | 'offline'

export interface SyncStatus {
  state: SyncState
  lastSyncAt: number | null
  pending: number // local records not yet pushed
  error: string | null
}

let status: SyncStatus = { state: 'off', lastSyncAt: null, pending: 0, error: null }
const listeners = new Set<() => void>()

/** React hook: live sync status for the header indicator and settings page. */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => status,
    () => status,
  )
}

/** Push local changes then pull remote changes. Safe to call any time (no-op when sync is off). */
export async function syncNow(): Promise<SyncStatus> {
  return status
}

/** Start periodic background sync (call once at app start). Returns a stop function. */
export function startAutoSync(): () => void {
  return () => {}
}

/** Check an Apps Script URL + key before saving them. */
export async function testConnection(_url: string, _key: string): Promise<{ ok: boolean; message: string }> {
  return { ok: false, message: 'ยังไม่ได้เปิดใช้การซิงก์' }
}

/** Ask the sync backend to push a LINE message to the owner (needs LINE set up in the Apps Script). */
export async function sendLineViaBackend(_text: string): Promise<{ ok: boolean; message: string }> {
  return { ok: false, message: 'ยังไม่ได้ตั้งค่า LINE' }
}
