// Sync engine: pushes local changes to the Google Apps Script backend and pulls
// everyone else's. Last write wins per record (updatedAt). Never throws into the UI.
import type { Table } from 'dexie'
import { SYNC_TABLES, newId, type ShopDB } from '../db'
import type { DeviceConfig } from '../device'
import type { SyncMeta, TableName } from '../types'
import { MSG, callErrorMessage, isPermanentLineError, isTransientError, lineErrorMessage } from './messages'
import type { ActionResult, LineResult, SyncStatus } from './status'
import { memoryStorage, type KeyValueStore } from './storage'
import {
  SyncCallError,
  asCallError,
  callBackend,
  checkSyncUrl,
  isConnectivityError,
  type BackendResponse,
  type FetchFn,
} from './transport'

export type Row = SyncMeta & Record<string, unknown>
type RowTable = Table<Row, string>

/** A record on the wire: { table, row } (row without the local-only `synced` flag). */
export interface WireItem {
  table: TableName
  row: Row
}

export interface DeviceAccess {
  get(): DeviceConfig
  set(changes: Partial<DeviceConfig>): unknown
}

export interface SyncEngineOptions {
  db: ShopDB
  device: DeviceAccess
  fetch?: FetchFn
  isOnline?: () => boolean
  storage?: KeyValueStore
  /** rows per push request (server accepts up to 500) */
  pushChunk?: number
  /** rows per pull page */
  pullLimit?: number
  /** delay between a local write and the sync it triggers */
  debounceMs?: number
  /** background sync period */
  intervalMs?: number
  /** how often the background timer checks settings / period */
  tickMs?: number
  /** after a failed sync, local writes wait this long before retrying */
  errorBackoffMs?: number
  timeoutMs?: number
  pingTimeoutMs?: number
}

interface Config {
  url: string
  key: string
}

interface OutboxItem {
  id: string // also the LINE retry key, so a resend is delivered once
  text: string
  at: number
  tries: number
}

const BOUND_KEY = 'pratunam.sync.boundUrl.v1'
const OUTBOX_KEY = 'pratunam.sync.lineOutbox.v1'
const OUTBOX_MAX = 20
const OUTBOX_TTL_MS = 3 * 24 * 3600_000
const OUTBOX_MAX_TRIES = 8
const MAX_PULL_PAGES = 10_000
const MAX_AUTO_CHAIN = 3
const CLOCK_SKEW_WARN_MS = 10 * 60_000
const VISIBLE_RESYNC_MS = 10_000
const TABLE_SET: ReadonlySet<string> = new Set<string>(SYNC_TABLES)
const LOCAL_ERROR = 'ซิงก์ไม่สำเร็จ จะลองใหม่อีกครั้ง'

/**
 * Decide whether a row from the server replaces the local copy.
 * Newer wins. On a tie an unpushed local edit is kept (it will be pushed and the server keeps
 * its own copy, which comes back as `stale`); otherwise the server copy wins, except when it is
 * the very same write returning to the device that made it.
 */
export function takeRemote(local: Row | undefined, remote: Row): boolean {
  if (!local) return true
  if (remote.updatedAt > local.updatedAt) return true
  if (remote.updatedAt < local.updatedAt) return false
  return local.synced === 1 && remote.deviceId !== local.deviceId
}

/** Validate { table, row }[] from the server; unknown tables and malformed rows are dropped. */
export function parseRemoteRows(v: unknown): WireItem[] {
  if (!Array.isArray(v)) return []
  const out: WireItem[] = []
  for (const it of v) {
    if (!it || typeof it !== 'object') continue
    const { table, row } = it as { table?: unknown; row?: unknown }
    if (typeof table !== 'string' || !TABLE_SET.has(table)) continue
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const r = row as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id) continue
    if (typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt)) continue
    out.push({ table: table as TableName, row: r as Row })
  }
  return out
}

function groupByTable(items: WireItem[]): Map<TableName, WireItem[]> {
  const groups = new Map<TableName, WireItem[]>()
  for (const it of items) {
    const list = groups.get(it.table)
    if (list) list.push(it)
    else groups.set(it.table, [it])
  }
  return groups
}

function wireRow(row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row }
  delete out.synced
  return out
}

function isOutboxItem(v: unknown): v is OutboxItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.text === 'string' && typeof o.at === 'number' && typeof o.tries === 'number'
}

export class SyncEngine {
  private readonly db: ShopDB
  private readonly device: DeviceAccess
  private readonly fetchFn: FetchFn
  private readonly online: () => boolean
  private readonly storage: KeyValueStore
  private readonly pushChunk: number
  private readonly pullLimit: number
  private readonly debounceMs: number
  private readonly intervalMs: number
  private readonly tickMs: number
  private readonly errorBackoffMs: number
  private readonly timeoutMs: number
  private readonly pingTimeoutMs: number

  private status: SyncStatus
  private readonly listeners = new Set<() => void>()
  private inflight: Promise<SyncStatus> | null = null
  private inflightCfg = ''
  private applying = false
  private hooksInstalled = false
  private running = false
  private stopFns: (() => void)[] = []
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  private pendingTimer: ReturnType<typeof setTimeout> | null = null
  private pendingRun: Promise<void> | null = null
  private pendingAgain = false
  private lastAttemptAt = 0
  private lastCfgKey = ''
  private autoChain = 0
  private wipeChecked = false

  constructor(o: SyncEngineOptions) {
    this.db = o.db
    this.device = o.device
    this.fetchFn = o.fetch ?? ((input, init) => fetch(input, init))
    this.online = o.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false)
    this.storage = o.storage ?? memoryStorage()
    this.pushChunk = Math.min(500, Math.max(1, o.pushChunk ?? 200))
    this.pullLimit = Math.max(1, o.pullLimit ?? 500)
    this.debounceMs = o.debounceMs ?? 4000
    this.intervalMs = o.intervalMs ?? 60_000
    this.tickMs = o.tickMs ?? 5000
    this.errorBackoffMs = o.errorBackoffMs ?? 30_000
    this.timeoutMs = o.timeoutMs ?? 60_000
    this.pingTimeoutMs = o.pingTimeoutMs ?? 30_000
    let lastSyncAt: number | null = null
    try {
      lastSyncAt = this.device.get().lastSyncAt ?? null
    } catch {
      lastSyncAt = null
    }
    this.status = { state: 'off', lastSyncAt, pending: 0, error: null }
  }

  // ------------------------------------------------------------ status store

  /** Current status. 'off' / 'idle' follow the device settings immediately. */
  getStatus = (): SyncStatus => {
    const on = this.config() !== null
    if (!on && this.status.state !== 'off') this.status = { ...this.status, state: 'off', pending: 0, error: null }
    else if (on && this.status.state === 'off') this.status = { ...this.status, state: 'idle', error: null }
    return this.status
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    const cur = this.status
    const next = { ...cur, ...patch }
    if (next.state === cur.state && next.lastSyncAt === cur.lastSyncAt && next.pending === cur.pending && next.error === cur.error) return
    this.status = next
    for (const l of this.listeners) {
      try {
        l()
      } catch (e) {
        console.error('sync status listener failed', e)
      }
    }
  }

  // ------------------------------------------------------------ public API

  /** Push local changes, then pull remote ones. Resolves (never rejects) with the final status. */
  syncNow(): Promise<SyncStatus> {
    const cfgKey = this.cfgKey()
    if (this.inflight) {
      if (cfgKey === this.inflightCfg) return this.inflight
      // Settings changed during a sync: run again with the new ones afterwards.
      return this.inflight.then(() => this.syncNow())
    }
    this.inflightCfg = cfgKey
    const run = (async (): Promise<SyncStatus> => {
      try {
        return await this.run()
      } catch (e) {
        console.error('sync failed', e)
        this.setStatus({ state: 'error', error: LOCAL_ERROR })
        return this.status
      } finally {
        this.inflight = null
        this.afterRun()
      }
    })()
    this.inflight = run
    return run
  }

  /** Start background sync. Returns a stop function (safe to call twice). */
  start(): () => void {
    if (this.running) return this.stop
    this.running = true
    this.installHooks()
    const win = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null
    const doc = typeof document !== 'undefined' && typeof document.addEventListener === 'function' ? document : null
    const onOnline = () => void this.syncNow()
    const onOffline = () => {
      if (this.config()) this.setStatus({ state: 'offline', error: MSG.offline })
    }
    const onVisibility = () => {
      // Coming back to the app: catch up, but not on every quick app switch.
      if (doc && doc.visibilityState === 'visible' && Date.now() - this.lastAttemptAt > VISIBLE_RESYNC_MS) void this.syncNow()
    }
    win?.addEventListener('online', onOnline)
    win?.addEventListener('offline', onOffline)
    doc?.addEventListener('visibilitychange', onVisibility)
    const tick = setInterval(() => this.tick(), this.tickMs)
    this.stopFns = [
      () => clearInterval(tick),
      () => win?.removeEventListener('online', onOnline),
      () => win?.removeEventListener('offline', onOffline),
      () => doc?.removeEventListener('visibilitychange', onVisibility),
    ]
    this.lastCfgKey = this.cfgKey()
    void this.refreshPending()
    if (this.config()) void this.syncNow()
    return this.stop
  }

  stop = (): void => {
    if (!this.running) return
    this.running = false
    for (const f of this.stopFns) f()
    this.stopFns = []
    if (this.syncTimer) clearTimeout(this.syncTimer)
    if (this.pendingTimer) clearTimeout(this.pendingTimer)
    this.syncTimer = null
    this.pendingTimer = null
  }

  /** Ping a URL + key before saving them. */
  async testConnection(url: string, key: string): Promise<ActionResult> {
    const u = url.trim()
    const k = key.trim()
    switch (checkSyncUrl(u)) {
      case 'empty':
        return { ok: false, message: MSG.needUrl }
      case 'not_url':
        return { ok: false, message: MSG.badUrl }
      case 'dev_url':
        return { ok: false, message: MSG.devUrl }
    }
    if (!k) return { ok: false, message: MSG.needKey }
    if (!this.online()) return { ok: false, message: MSG.cannotConnect }
    try {
      const res = await this.call({ url: u, key: k }, 'ping', {}, this.pingTimeoutMs)
      const name = typeof res.shopName === 'string' ? res.shopName.trim() : ''
      let message = `${MSG.connected} · ${name || MSG.noShopYet}`
      const serverTime = typeof res.serverTime === 'number' ? res.serverTime : null
      if (serverTime !== null && Math.abs(serverTime - Date.now()) > CLOCK_SKEW_WARN_MS) message += ` · ${MSG.clockOff}`
      return { ok: true, message }
    } catch (e) {
      const err = asCallError(e)
      return { ok: false, message: isConnectivityError(err) ? MSG.cannotConnect : callErrorMessage(err) }
    }
  }

  /**
   * Push a LINE message through the backend. Without internet (or on a passing server hiccup) it is
   * queued on this device and sent on a later sync: `queued: true`.
   */
  async sendLine(text: string): Promise<LineResult> {
    const body = String(text ?? '').trim()
    if (!body) return { ok: false, queued: false, message: MSG.lineEmpty }
    const cfg = this.config()
    if (!cfg || !cfg.key) return { ok: false, queued: false, message: MSG.lineNeedsSync }
    const item: OutboxItem = { id: newId(), text: body, at: Date.now(), tries: 0 }
    if (!this.online()) {
      this.enqueue(item)
      return { ok: false, queued: true, message: MSG.lineQueued }
    }
    try {
      await this.call(cfg, 'line', { text: body, retryKey: item.id })
      return { ok: true, queued: false, message: MSG.lineSent }
    } catch (e) {
      const err = asCallError(e)
      if (isConnectivityError(err)) {
        this.enqueue(item)
        return { ok: false, queued: true, message: MSG.lineQueued }
      }
      if (isTransientError(err)) {
        this.enqueue(item)
        return { ok: false, queued: true, message: MSG.lineRetry }
      }
      return { ok: false, queued: false, message: lineErrorMessage(err) }
    }
  }

  // ------------------------------------------------------------ one sync run

  private async run(): Promise<SyncStatus> {
    this.lastAttemptAt = Date.now()
    const cfg = this.config()
    if (!cfg) {
      this.setStatus({ state: 'off', pending: 0, error: null })
      return this.status
    }
    if (!this.online()) {
      await this.refreshPending()
      this.setStatus({ state: 'offline', error: MSG.offline })
      return this.status
    }
    this.setStatus({ state: 'syncing' })
    try {
      await this.bind(cfg)
      await this.push(cfg)
      await this.pull(cfg)
      const now = Date.now()
      this.device.set({ lastSyncAt: now })
      await this.refreshPending()
      this.setStatus({ state: 'ok', error: null, lastSyncAt: now })
    } catch (e) {
      if (e instanceof SyncCallError) {
        if (e.kind === 'server' || e.kind === 'invalid') console.warn('sync:', e.message)
        this.setStatus({ state: isConnectivityError(e) ? 'offline' : 'error', error: callErrorMessage(e) })
      } else {
        console.error('sync failed', e)
        this.setStatus({ state: 'error', error: LOCAL_ERROR })
      }
      await this.refreshPending()
      return this.status
    }
    await this.flushOutbox(cfg)
    return this.status
  }

  /** First sync against a backend (or a new one): send everything, read everything. */
  private async bind(cfg: Config): Promise<void> {
    if (this.storage.get(BOUND_KEY) !== cfg.url) {
      await this.markAllUnsynced()
      this.device.set({ lastPullSeq: 0 })
      this.storage.set(BOUND_KEY, cfg.url)
      this.wipeChecked = true
      return
    }
    if (!this.wipeChecked) {
      this.wipeChecked = true
      // Local data was cleared but the cursor survived: read everything again.
      if ((Number(this.device.get().lastPullSeq) || 0) > 0 && (await this.db.shop.count()) === 0) {
        this.device.set({ lastPullSeq: 0 })
      }
    }
  }

  private async markAllUnsynced(): Promise<void> {
    for (const name of SYNC_TABLES) await this.table(name).where('synced').equals(1).modify({ synced: 0 })
  }

  private async push(cfg: Config): Promise<void> {
    const refs: { table: TableName; id: string }[] = []
    for (const name of SYNC_TABLES) {
      const ids = await this.table(name).where('synced').equals(0).primaryKeys()
      for (const id of ids) refs.push({ table: name, id })
    }
    let left = refs.length
    for (let i = 0; i < refs.length; i += this.pushChunk) {
      const slice = refs.slice(i, i + this.pushChunk)
      const items = await this.loadUnsynced(slice)
      if (items.length) {
        const res = await this.call(cfg, 'push', { rows: items.map(({ table, row }) => ({ table, row: wireRow(row) })) })
        if (typeof res.accepted !== 'number') throw new SyncCallError('invalid', 'bad_push_response')
        await this.markPushed(items)
        if (Array.isArray(res.invalid) && res.invalid.length) console.warn('sync: server refused rows', res.invalid)
        const stale = parseRemoteRows(res.stale)
        if (stale.length) await this.applyRemote(stale)
      }
      left -= slice.length
      this.setStatus({ pending: Math.max(0, left) })
    }
  }

  private async loadUnsynced(refs: { table: TableName; id: string }[]): Promise<WireItem[]> {
    const byTable = new Map<TableName, string[]>()
    for (const r of refs) {
      const ids = byTable.get(r.table)
      if (ids) ids.push(r.id)
      else byTable.set(r.table, [r.id])
    }
    const out: WireItem[] = []
    for (const [name, ids] of byTable) {
      const rows = await this.table(name).bulkGet(ids)
      for (const row of rows) if (row && row.synced === 0) out.push({ table: name, row })
    }
    return out
  }

  /** Mark pushed rows synced — only those not changed locally while the request was in flight. */
  private async markPushed(items: WireItem[]): Promise<void> {
    const groups = groupByTable(items)
    await this.db.transaction('rw', [...groups.keys()].map((n) => this.table(n)), async () => {
      for (const [name, list] of groups) {
        const t = this.table(name)
        const sent = new Map(list.map((i) => [i.row.id, i.row.updatedAt]))
        const current = await t.bulkGet([...sent.keys()])
        const done = current.filter(
          (cur): cur is Row => !!cur && cur.synced === 0 && Object.is(cur.updatedAt, sent.get(cur.id)),
        )
        if (done.length) await t.bulkPut(done.map((cur) => ({ ...cur, synced: 1 as const })))
      }
    })
  }

  private async pull(cfg: Config): Promise<void> {
    let since = Math.max(0, Math.floor(Number(this.device.get().lastPullSeq) || 0))
    let restarted = false
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const res = await this.call(cfg, 'pull', { since, limit: this.pullLimit })
      if (typeof res.seq === 'number' && res.seq < since && !restarted) {
        // The backend's counter is behind this device: it was reset. Read and send everything again.
        restarted = true
        since = 0
        this.device.set({ lastPullSeq: 0 })
        await this.markAllUnsynced()
        continue
      }
      if (!Array.isArray(res.rows) || typeof res.nextSeq !== 'number' || !Number.isFinite(res.nextSeq)) {
        throw new SyncCallError('invalid', 'bad_pull_response')
      }
      const items = parseRemoteRows(res.rows)
      if (items.length) await this.applyRemote(items)
      const next = Math.max(0, Math.floor(res.nextSeq))
      this.device.set({ lastPullSeq: next, lastSyncAt: Date.now() })
      if (res.more !== true || next <= since) break
      since = next
    }
  }

  /** Apply server rows (last write wins). Returns how many replaced local data. */
  private async applyRemote(items: WireItem[]): Promise<number> {
    const groups = groupByTable(items)
    let applied = 0
    this.applying = true
    try {
      await this.db.transaction('rw', [...groups.keys()].map((n) => this.table(n)), async () => {
        for (const [name, list] of groups) {
          const t = this.table(name)
          const ids = [...new Set(list.map((i) => i.row.id))]
          const locals = await t.bulkGet(ids)
          const current = new Map<string, Row | undefined>(ids.map((id, i) => [id, locals[i]]))
          const puts = new Map<string, Row>()
          for (const { row } of list) {
            if (!takeRemote(current.get(row.id), row)) continue
            const next: Row = { ...row, deleted: row.deleted === 1 ? 1 : 0, synced: 1 }
            current.set(row.id, next)
            puts.set(row.id, next)
          }
          if (puts.size) await t.bulkPut([...puts.values()])
          applied += puts.size
        }
      })
    } finally {
      this.applying = false
    }
    return applied
  }

  // ------------------------------------------------------------ LINE outbox

  private readOutbox(): OutboxItem[] {
    try {
      const raw = this.storage.get(OUTBOX_KEY)
      const v: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(v) ? v.filter(isOutboxItem) : []
    } catch {
      return []
    }
  }

  private writeOutbox(items: OutboxItem[]): void {
    this.storage.set(OUTBOX_KEY, items.length ? JSON.stringify(items) : null)
  }

  private enqueue(item: OutboxItem): void {
    this.writeOutbox([...this.readOutbox(), item].slice(-OUTBOX_MAX))
  }

  private async flushOutbox(cfg: Config): Promise<void> {
    const start = this.readOutbox()
    if (!start.length) return
    const now = Date.now()
    const items = start.filter((i) => now - i.at < OUTBOX_TTL_MS)
    const keep: OutboxItem[] = []
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]
      try {
        await this.call(cfg, 'line', { text: item.text, retryKey: item.id })
      } catch (e) {
        const err = asCallError(e)
        if (isConnectivityError(err)) {
          keep.push(...items.slice(idx))
          break
        }
        if (!isPermanentLineError(err) && item.tries + 1 < OUTBOX_MAX_TRIES) keep.push({ ...item, tries: item.tries + 1 })
        else console.warn('sync: dropped queued LINE message', err.message)
      }
    }
    // Keep messages queued while we were sending.
    const known = new Set(start.map((i) => i.id))
    const added = this.readOutbox().filter((i) => !known.has(i.id))
    this.writeOutbox([...keep, ...added].slice(-OUTBOX_MAX))
  }

  // ------------------------------------------------------------ background scheduling

  private tick(): void {
    const key = this.cfgKey()
    if (key !== this.lastCfgKey) {
      this.lastCfgKey = key
      if (key) void this.syncNow()
      else this.setStatus({ state: 'off', pending: 0, error: null })
      return
    }
    if (key && Date.now() - this.lastAttemptAt >= this.intervalMs) void this.syncNow()
  }

  private installHooks(): void {
    if (this.hooksInstalled) return
    this.hooksInstalled = true
    for (const name of SYNC_TABLES) {
      const t = this.table(name)
      t.hook('creating', (_pk, obj) => {
        if (!this.applying && obj.synced === 0) this.onLocalWrite()
      })
      t.hook('updating', (mods, _pk, obj) => {
        const m = mods as Partial<Row>
        const synced = 'synced' in m ? m.synced : obj.synced
        if (!this.applying && synced === 0) this.onLocalWrite()
      })
    }
  }

  private onLocalWrite(): void {
    if (!this.running) return
    this.autoChain = 0
    if (!this.pendingTimer) {
      this.pendingTimer = setTimeout(() => {
        this.pendingTimer = null
        void this.refreshPending()
      }, 600)
    }
    if (!this.config() || this.syncTimer) return
    this.scheduleSync(this.status.state === 'error' ? this.errorBackoffMs : this.debounceMs)
  }

  private scheduleSync(ms: number): void {
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      void this.syncNow()
    }, ms)
  }

  /** Writes made during a sync are still pending: follow up soon (bounded, the timer covers the rest). */
  private afterRun(): void {
    if (!this.running || this.syncTimer) return
    if (this.status.state === 'ok' && this.status.pending > 0 && this.autoChain < MAX_AUTO_CHAIN) {
      this.autoChain++
      this.scheduleSync(this.debounceMs)
    }
  }

  /** Count local rows not yet pushed (uses the `synced` index). Never rejects. */
  refreshPending(): Promise<void> {
    if (this.pendingRun) {
      this.pendingAgain = true
      return this.pendingRun
    }
    this.pendingRun = (async () => {
      try {
        do {
          this.pendingAgain = false
          if (!this.config()) {
            this.setStatus({ pending: 0 })
            continue
          }
          let n = 0
          for (const name of SYNC_TABLES) n += await this.table(name).where('synced').equals(0).count()
          this.setStatus({ pending: n })
        } while (this.pendingAgain)
      } catch (e) {
        console.warn('sync: pending count failed', e)
      } finally {
        this.pendingRun = null
      }
    })()
    return this.pendingRun
  }

  // ------------------------------------------------------------ helpers

  private config(): Config | null {
    let d: DeviceConfig
    try {
      d = this.device.get()
    } catch {
      return null
    }
    const url = String(d.syncUrl ?? '').trim()
    if (!url) return null
    return { url, key: String(d.syncKey ?? '').trim() }
  }

  private cfgKey(): string {
    const c = this.config()
    return c ? `${c.url}\n${c.key}` : ''
  }

  private table(name: TableName): RowTable {
    return (this.db as unknown as Record<TableName, RowTable>)[name]
  }

  private call(cfg: Config, action: string, payload: Record<string, unknown> = {}, timeoutMs = this.timeoutMs): Promise<BackendResponse> {
    let deviceId = ''
    try {
      deviceId = this.device.get().deviceId
    } catch {
      deviceId = ''
    }
    return callBackend(this.fetchFn, cfg.url, { ...payload, key: cfg.key, deviceId, action }, timeoutMs)
  }
}
