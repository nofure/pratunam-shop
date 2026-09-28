export type SyncState = 'off' | 'idle' | 'syncing' | 'ok' | 'error' | 'offline'

export interface SyncStatus {
  state: SyncState
  lastSyncAt: number | null
  pending: number // local records not yet pushed
  error: string | null
}

export interface ActionResult {
  ok: boolean
  message: string
}

/** Result of a LINE send. queued = not sent yet, kept on this device and sent automatically later. */
export interface LineResult extends ActionResult {
  queued: boolean
}
