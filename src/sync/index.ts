// Optional multi-device sync through the owner's Google Sheet + Apps Script web app,
// plus LINE push through the same script. Setup guide: docs/sync-setup.md
import { useSyncExternalStore } from 'react'
import { db } from '../db'
import { getDevice, setDevice, useDevice } from '../device'
import { SyncEngine } from './engine'
import type { SyncStatus } from './status'
import { browserStorage } from './storage'

export type { LineResult, SyncState, SyncStatus } from './status'

const engine = new SyncEngine({
  db,
  device: { get: getDevice, set: setDevice },
  storage: browserStorage(),
})

/** React hook: live sync status for the header indicator and settings page. */
export function useSyncStatus(): SyncStatus {
  useDevice() // re-render when the sync URL / key change so 'off' ↔ 'idle' shows at once
  return useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus)
}

/** Push local changes then pull remote changes. Safe to call any time (no-op when sync is off). */
export async function syncNow(): Promise<SyncStatus> {
  return engine.syncNow()
}

/** Start periodic background sync (call once at app start). Returns a stop function. */
export function startAutoSync(): () => void {
  try {
    return engine.start()
  } catch (e) {
    console.error('sync: could not start', e)
    return () => {}
  }
}

/** Check an Apps Script URL + key before saving them. */
export async function testConnection(url: string, key: string): Promise<{ ok: boolean; message: string }> {
  return engine.testConnection(url, key)
}

/**
 * Ask the sync backend to push a LINE message to the owner (needs LINE set up in the Apps Script).
 * `queued: true` = no connection right now; the message is kept on this device and sent automatically.
 */
export async function sendLineViaBackend(text: string): Promise<{ ok: boolean; message: string; queued: boolean }> {
  return engine.sendLine(text)
}
