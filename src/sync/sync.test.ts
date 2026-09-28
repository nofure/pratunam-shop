import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import codeGs from '../../backend/Code.gs?raw'
import { ShopDB, alive, newId, patch, remove, save } from '../db'
import type { DeviceConfig } from '../device'
import type { Booth, ShopConfig, Staff, SyncMeta, TableName, Tier } from '../types'
import { SyncEngine, parseRemoteRows, takeRemote, type Row } from './engine'
import { backendFetch, createGasEnv, loadBackend, type Backend, type BackendFetch, type GasEnv } from './gasMock'
import { memoryStorage, type KeyValueStore } from './storage'

const URL1 = 'https://script.google.com/macros/s/AKfy-test-1/exec'
const URL2 = 'https://script.google.com/macros/s/AKfy-test-2/exec'
const KEY = 'test-key-12345'

interface Server {
  env: GasEnv
  backend: Backend
  post(body: Record<string, unknown>): Record<string, unknown>
}

function makeServer(): Server {
  const env = createGasEnv()
  env.props.set('SYNC_KEY', KEY)
  const backend = loadBackend(codeGs, env)
  return {
    env,
    backend,
    post: (body) => JSON.parse(backend.doPost({ postData: { contents: JSON.stringify(body) } }).getContent()),
  }
}

interface Dev {
  name: string
  db: ShopDB
  cfg: () => DeviceConfig
  setCfg: (c: Partial<DeviceConfig>) => void
  net: BackendFetch
  engine: SyncEngine
  online: { value: boolean }
  storage: KeyValueStore
}

let dbSeq = 0
const openDbs: ShopDB[] = []
const engines: SyncEngine[] = []

function makeDevice(
  server: Server,
  name: string,
  opts: { url?: string; pushChunk?: number; pullLimit?: number; debounceMs?: number; cfg?: DeviceConfig; storage?: KeyValueStore } = {},
): Dev {
  const db = new ShopDB(`sync-test-${name}-${++dbSeq}`)
  const storage = opts.storage ?? memoryStorage()
  openDbs.push(db)
  let cfg: DeviceConfig = opts.cfg ?? {
    deviceId: `dev-${name}`,
    boothId: null,
    syncUrl: opts.url ?? URL1,
    syncKey: KEY,
    lastPullSeq: 0,
    lastSyncAt: null,
    lineNotify: true,
    autoLockMin: 0,
  }
  const net = backendFetch(server.backend)
  const online = { value: true }
  const engine = new SyncEngine({
    db,
    device: {
      get: () => cfg,
      set: (c) => {
        cfg = { ...cfg, ...c }
        return cfg
      },
    },
    fetch: net.fetch,
    isOnline: () => online.value,
    storage,
    pushChunk: opts.pushChunk,
    pullLimit: opts.pullLimit,
    debounceMs: opts.debounceMs ?? 20,
    tickMs: 60_000,
    errorBackoffMs: 50,
    timeoutMs: 5000,
  })
  engines.push(engine)
  return {
    name,
    db,
    cfg: () => cfg,
    setCfg: (c) => {
      cfg = { ...cfg, ...c }
    },
    net,
    engine,
    online,
    storage,
  }
}

function tbl(db: ShopDB, name: TableName) {
  return (db as unknown as Record<TableName, import('dexie').Table<Row, string>>)[name]
}

/** Write a record as a given device with a chosen updatedAt (for last-write-wins scenarios). */
async function putAs(dev: Dev, table: TableName, rec: Record<string, unknown>, updatedAt: number): Promise<Row> {
  const t = tbl(dev.db, table)
  const id = typeof rec.id === 'string' ? rec.id : newId()
  const cur = await t.get(id)
  const row = {
    ...(cur ?? {}),
    ...rec,
    id,
    createdAt: cur?.createdAt ?? updatedAt,
    updatedAt,
    deviceId: dev.cfg().deviceId,
    deleted: (rec.deleted as 0 | 1 | undefined) ?? cur?.deleted ?? 0,
    synced: 0,
  } as Row
  await t.put(row)
  return row
}

async function seedShop(dev: Dev) {
  const db = dev.db
  const shop = await save<ShopConfig>(db.shop, {
    id: 'shop',
    name: 'ร้านทดสอบ',
    promptPayId: '',
    promptPayName: '',
    halfHalfEnabled: 1,
    otherPayEnabled: 0,
    otherPayLabel: 'อื่นๆ',
    voidNeedsOwner: 1,
    setupDone: 1,
  })
  const owner = await save<Staff>(db.staff, { name: 'เจ้าของ', pin: '1234', role: 'owner', boothId: null, active: 1 })
  const booth1 = await save<Booth>(db.booths, { name: 'แผงเสื้อ', openingFloat: 500, sort: 0, active: 1 })
  const booth2 = await save<Booth>(db.booths, { name: 'แผงรองเท้า', openingFloat: 300, sort: 1, active: 1 })
  const tiers: Tier[] = []
  for (const [i, price] of [39, 59, 100].entries()) {
    tiers.push(
      await save<Tier>(db.tiers, {
        boothId: booth1.id,
        name: 'เสื้อยืด',
        price,
        promoQty: price === 39 ? 3 : null,
        promoPrice: price === 39 ? 100 : null,
        unit: 'ตัว',
        color: 'yellow',
        sort: i,
        active: 1,
        trackStock: 1,
        lowStock: 5,
      }),
    )
  }
  return { shop, owner, booth1, booth2, tiers }
}

async function unsyncedCount(db: ShopDB): Promise<number> {
  let n = 0
  for (const name of ['shop', 'booths', 'staff', 'tiers', 'sales', 'shifts', 'cashMoves', 'lots', 'adjustments', 'suppliers', 'expenses'] as TableName[]) {
    n += await tbl(db, name).where('synced').equals(0).count()
  }
  return n
}

function actions(net: BackendFetch): string[] {
  return net.requests.map((r) => String(r.body.action))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(check: () => boolean | Promise<boolean>, ms = 2000): Promise<void> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (await check()) return
    await sleep(10)
  }
  throw new Error('timed out waiting for condition')
}

afterEach(async () => {
  engines.splice(0).forEach((e) => e.stop())
  for (const db of openDbs.splice(0)) {
    db.close()
    await db.delete()
  }
})

// ---------------------------------------------------------------------------- backend

describe('Code.gs backend', () => {
  let server: Server
  beforeEach(() => {
    server = makeServer()
  })

  it('refuses a wrong or missing key', () => {
    expect(server.post({ key: 'nope', action: 'ping' })).toEqual({ ok: false, error: 'unauthorized' })
    expect(server.post({ action: 'ping' })).toEqual({ ok: false, error: 'unauthorized' })
    expect(server.post({ key: KEY, action: 'launch' })).toEqual({ ok: false, error: 'unknown_action' })
    server.env.props.delete('SYNC_KEY')
    expect(server.post({ key: KEY, action: 'ping' })).toEqual({ ok: false, error: 'server_key_missing' })
    const bad = JSON.parse(server.backend.doPost({ postData: { contents: 'not json' } }).getContent())
    expect(bad).toEqual({ ok: false, error: 'bad_request' })
  })

  it('setup() creates one tab per table with headers, keeps an existing key, and removes the empty default tab', () => {
    server.backend.setup()
    const names = server.env.ss.getSheets().map((s) => s.getName())
    expect(names).toEqual(['shop', 'booths', 'staff', 'tiers', 'suppliers', 'shifts', 'sales', 'cashMoves', 'lots', 'adjustments', 'expenses'])
    const sales = server.env.ss.getSheetByName('sales')!
    const header = sales.getRange(1, 1, 1, sales.getLastColumn()).getValues()[0]
    expect(header.slice(0, 6)).toEqual(['id', 'seq', 'updatedAt', 'deleted', 'deviceId', 'data'])
    expect(header).toContain('ยอด')
    expect(header).toContain('จ่ายด้วย')
    expect(sales.frozenRows).toBe(1)
    expect(server.env.props.get('SYNC_KEY')).toBe(KEY)
    expect(server.env.props.get('SEQ')).toBe('0')
    // running it again is harmless
    server.backend.setup()
    expect(server.env.ss.getSheets()).toHaveLength(11)
  })

  it('setup() generates a readable SYNC_KEY when none is set', () => {
    server.env.props.delete('SYNC_KEY')
    server.backend.setup()
    expect(server.env.props.get('SYNC_KEY')).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}-[a-z2-9]{5}$/)
    expect(server.env.logs.join('\n')).toContain(server.env.props.get('SYNC_KEY'))
  })

  it('doGet shows a Thai status page', () => {
    const page = server.backend.doGet()
    expect(page.getContent()).toContain('ตัวเชื่อมข้อมูลร้านทำงานอยู่')
    expect(page.getContent()).toContain('ตั้งแล้ว')
    expect(page.title).toContain('ระบบร้าน')
  })

  it('push upserts by id with last-write-wins and pull returns rows by seq in pages', () => {
    const row = (id: string, updatedAt: number, name: string) => ({
      table: 'booths',
      row: { id, name, openingFloat: 0, sort: 0, active: 1, createdAt: 1, updatedAt, deviceId: 'dev-x', deleted: 0 },
    })
    let res = server.post({ key: KEY, action: 'push', rows: [row('b1', 100, 'A'), row('b2', 100, 'B'), row('b3', 100, 'C')] })
    expect(res).toMatchObject({ ok: true, accepted: 3, seq: 3 })
    res = server.post({ key: KEY, action: 'push', rows: [row('b1', 50, 'old'), row('b2', 200, 'B2')] })
    expect(res).toMatchObject({ ok: true, accepted: 1, seq: 4 })
    const booths = server.env.ss.getSheetByName('booths')!
    expect(booths.getLastRow()).toBe(4) // header + 3, updated in place
    expect(booths.records().map((r) => r['ชื่อแผง'])).toEqual(['A', 'B2', 'C'])

    const p1 = server.post({ key: KEY, action: 'pull', since: 0, limit: 2 })
    expect(p1).toMatchObject({ ok: true, more: true, nextSeq: 3 })
    expect((p1.rows as { row: { id: string } }[]).map((r) => r.row.id)).toEqual(['b1', 'b3'])
    const p2 = server.post({ key: KEY, action: 'pull', since: 3, limit: 2 })
    expect(p2).toMatchObject({ ok: true, more: false, nextSeq: 4, seq: 4 })
    expect((p2.rows as { row: { id: string; name: string } }[]).map((r) => r.row.name)).toEqual(['B2'])
    expect(server.post({ key: KEY, action: 'pull', since: 4 })).toEqual({ ok: true, rows: [], nextSeq: 4, more: false, seq: 4 })
    expect(server.env.props.get('TABMAX_booths')).toBe('4')
    expect(server.env.props.get('COMMITTED')).toBe('4')
  })

  it('grows a full tab and keeps appending after the first 1000 rows', () => {
    const rows = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        table: 'expenses',
        row: { id: `e${from + i}`, dayKey: '2026-09-29', category: 'food', amount: 50, boothId: null, note: null, staffId: null, createdAt: 1, updatedAt: 1, deviceId: 'd', deleted: 0 },
      }))
    for (let i = 0; i < 1200; i += 400) expect(server.post({ key: KEY, action: 'push', rows: rows(i, 400) })).toMatchObject({ ok: true, accepted: 400 })
    const sh = server.env.ss.getSheetByName('expenses')!
    expect(sh.getLastRow()).toBe(1201)
    expect(sh.getMaxRows()).toBeGreaterThanOrEqual(1201)
    let since = 0
    let got = 0
    for (;;) {
      const page = server.post({ key: KEY, action: 'pull', since, limit: 1000 })
      got += (page.rows as unknown[]).length
      since = page.nextSeq as number
      if (!page.more) break
    }
    expect(got).toBe(1200)
  })

  it('refuses malformed rows without failing the batch', () => {
    const res = server.post({
      key: KEY,
      action: 'push',
      rows: [
        { table: 'nope', row: { id: 'x1', updatedAt: 1 } },
        { table: 'booths', row: { id: '=HYPERLINK("x")', updatedAt: 1 } },
        { table: 'booths', row: { id: 'ok1', updatedAt: 'soon' } },
        { table: 'booths', row: { id: 'ok2', name: '+ไม่ใช่สูตร', updatedAt: 5, deleted: 0 } },
      ],
    })
    expect(res).toMatchObject({ ok: true, accepted: 1 })
    expect((res.invalid as unknown[]).length).toBe(3)
    const rec = server.env.ss.getSheetByName('booths')!.records()[0]
    expect(rec['ชื่อแผง']).toBe("'+ไม่ใช่สูตร") // no formula injection in readable columns
  })

  it('fills readable columns with booth / staff / price names', () => {
    const now = Date.UTC(2026, 8, 29, 7, 5) // 14:05 in Bangkok
    const meta = { createdAt: now, updatedAt: now, deviceId: 'd', deleted: 0 }
    server.post({
      key: KEY,
      action: 'push',
      rows: [
        { table: 'booths', row: { ...meta, id: 'b1', name: 'แผงเสื้อ', openingFloat: 500, sort: 0, active: 1 } },
        { table: 'staff', row: { ...meta, id: 's1', name: 'น้อย', pin: '1111', role: 'staff', boothId: 'b1', active: 1 } },
      ],
    })
    server.post({
      key: KEY,
      action: 'push',
      rows: [
        {
          table: 'sales',
          row: {
            ...meta,
            id: 'x1',
            boothId: 'b1',
            staffId: 's1',
            dayKey: '2026-09-29',
            billNo: 7,
            pieces: 3,
            total: 100,
            promoDiscount: 17,
            manualDiscount: 0,
            method: 'cash',
            status: 'paid',
            items: [{ name: 'เสื้อยืด', price: 39, qty: 3 }],
          },
        },
      ],
    })
    const sale = server.env.ss.getSheetByName('sales')!.records()[0]
    expect(sale).toMatchObject({ วันที่: '2026-09-29', เวลา: '14:05', แผง: 'แผงเสื้อ', คนขาย: 'น้อย', ยอด: 100, ส่วนลด: 17, จ่ายด้วย: 'เงินสด', สถานะ: 'ขายแล้ว' })
    expect(server.post({ key: KEY, action: 'ping' })).toMatchObject({ ok: true, shopName: '' })
  })

  it('stores oversized rows in the overflow tab and returns them intact', () => {
    const note = 'ก'.repeat(120_000)
    const row = { id: 'big', name: 'x', phone: null, location: null, note, createdAt: 1, updatedAt: 10, deviceId: 'd', deleted: 0 }
    expect(server.post({ key: KEY, action: 'push', rows: [{ table: 'suppliers', row }] })).toMatchObject({ ok: true, accepted: 1 })
    expect(server.env.ss.getSheetByName('_overflow')).not.toBeNull()
    const pulled = server.post({ key: KEY, action: 'pull', since: 0 })
    expect((pulled.rows as { row: { note: string } }[])[0].row.note).toBe(note)
  })

  it('answers busy when another write holds the lock', () => {
    server.env.lockFree = false
    expect(server.post({ key: KEY, action: 'push', rows: [] })).toEqual({ ok: false, error: 'busy' })
  })

  it('sends LINE pushes with a retry key and maps LINE errors', () => {
    expect(server.post({ key: KEY, action: 'line', text: 'hi' })).toEqual({ ok: false, error: 'line_not_configured' })
    server.env.props.set('LINE_TOKEN', 'tok')
    server.env.props.set('LINE_TO', 'Uaaa, Cbbb')
    const retryKey = newId()
    expect(server.post({ key: KEY, action: 'line', text: 'สรุปยอด', retryKey })).toEqual({ ok: true })
    expect(server.env.lineCalls).toHaveLength(2)
    const [a, b] = server.env.lineCalls
    expect(a.url).toBe('https://api.line.me/v2/bot/message/push')
    expect(a.options.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(a.options.payload)).toEqual({ to: 'Uaaa', messages: [{ type: 'text', text: 'สรุปยอด' }] })
    expect(a.options.headers['X-Line-Retry-Key']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a.options.headers['X-Line-Retry-Key']).not.toBe(b.options.headers['X-Line-Retry-Key'])
    server.env.lineStatus = 409 // already sent with this retry key
    expect(server.post({ key: KEY, action: 'line', text: 'x', retryKey })).toEqual({ ok: true })
    server.env.lineStatus = 429
    server.env.lineBody = '{"message":"You have reached your monthly limit."}'
    expect(server.post({ key: KEY, action: 'line', text: 'x' })).toMatchObject({ ok: false, error: 'line_quota' })
    server.env.lineStatus = 401
    expect(server.post({ key: KEY, action: 'line', text: 'x' })).toMatchObject({ ok: false, error: 'line_auth' })
  })
})

// ---------------------------------------------------------------------------- engine

describe('sync engine', () => {
  let server: Server
  beforeEach(() => {
    server = makeServer()
    server.backend.setup()
  })

  it('pushes unsynced rows with a text/plain POST and marks them synced', async () => {
    const a = makeDevice(server, 'A')
    await seedShop(a)
    expect(await unsyncedCount(a.db)).toBe(7)
    const st = await a.engine.syncNow()
    expect(st).toMatchObject({ state: 'ok', pending: 0, error: null })
    expect(st.lastSyncAt).toBeTypeOf('number')
    expect(await unsyncedCount(a.db)).toBe(0)
    const req = a.net.requests.find((r) => r.body.action === 'push')!
    expect(req).toMatchObject({ url: URL1, method: 'POST', contentType: 'text/plain;charset=utf-8' })
    expect(req.body).toMatchObject({ key: KEY, deviceId: 'dev-A' })
    const sent = (req.body.rows as { table: string; row: Record<string, unknown> }[])[0]
    expect(sent.table).toBe('shop') // config tables go first
    expect('synced' in sent.row).toBe(false)
    expect(server.env.ss.getSheetByName('tiers')!.records()).toHaveLength(3)
    expect(server.env.ss.getSheetByName('tiers')!.records()[0]['แผง']).toBe('แผงเสื้อ')
    expect(a.cfg().lastPullSeq).toBe(7)
  })

  it('keeps a row unsynced when it changed while the push was in flight', async () => {
    const a = makeDevice(server, 'A')
    const { booth1 } = await seedShop(a)
    a.net.before = async (body) => {
      if (body.action === 'push') {
        a.net.before = null
        await patch(a.db.booths, booth1.id, { name: 'แผงเสื้อ (ใหม่)' })
      }
    }
    await a.engine.syncNow()
    const local = await a.db.booths.get(booth1.id)
    expect(local).toMatchObject({ name: 'แผงเสื้อ (ใหม่)', synced: 0 })
    expect(a.engine.getStatus().pending).toBe(1)
    await a.engine.syncNow()
    expect((await a.db.booths.get(booth1.id))!.synced).toBe(1)
    const rec = server.env.ss.getSheetByName('booths')!.records().find((r) => r.id === booth1.id)!
    expect(rec['ชื่อแผง']).toBe('แผงเสื้อ (ใหม่)')
  })

  it('lets a new device join an existing shop with no local data', async () => {
    const a = makeDevice(server, 'A')
    const seeded = await seedShop(a)
    await a.engine.syncNow()

    const b = makeDevice(server, 'B')
    expect(await b.db.shop.count()).toBe(0)
    const st = await b.engine.syncNow()
    expect(st).toMatchObject({ state: 'ok', pending: 0 })
    expect(await b.db.shop.get('shop')).toMatchObject({ name: 'ร้านทดสอบ', setupDone: 1, synced: 1 })
    expect(alive(await b.db.booths.toArray())).toHaveLength(2)
    expect(await b.db.staff.get(seeded.owner.id)).toMatchObject({ pin: '1234', role: 'owner' })
    expect(await b.db.tiers.where('boothId').equals(seeded.booth1.id).count()).toBe(3)
    expect(b.cfg().lastPullSeq).toBe(7)
    expect(actions(b.net)).toEqual(['pull']) // nothing to push
    expect(await b.engine.testConnection(URL1, KEY)).toEqual({ ok: true, message: 'เชื่อมต่อสำเร็จ · ร้านทดสอบ' })
  })

  it('pulls large histories in pages', async () => {
    const a = makeDevice(server, 'A', { pushChunk: 5 })
    await seedShop(a)
    for (let i = 0; i < 16; i++) await save(a.db.suppliers, { name: `ร้านส่ง ${i}`, phone: null, location: null, note: null })
    await a.engine.syncNow()
    expect(actions(a.net).filter((x) => x === 'push')).toHaveLength(5) // 23 rows in chunks of 5

    const b = makeDevice(server, 'B', { pullLimit: 4 })
    await b.engine.syncNow()
    expect(await b.db.suppliers.count()).toBe(16)
    expect(actions(b.net).filter((x) => x === 'pull')).toHaveLength(6) // 23 rows / 4 per page
    expect(b.cfg().lastPullSeq).toBe(23)
  })

  it('does not push pulled rows back (no loop) and skips its own echo', async () => {
    const a = makeDevice(server, 'A')
    await seedShop(a)
    await a.engine.syncNow()
    const b = makeDevice(server, 'B')
    await b.engine.syncNow()
    await b.engine.syncNow()
    await a.engine.syncNow()
    expect(actions(b.net)).toEqual(['pull', 'pull'])
    expect(actions(a.net)).toEqual(['push', 'pull', 'pull'])
    expect(await unsyncedCount(b.db)).toBe(0)
    // the idle pull is answered from the counter without reading the sheet
    const last = a.net.requests[a.net.requests.length - 1]
    expect(last.body).toMatchObject({ action: 'pull', since: 7 })
  })

  it('last write wins in both directions', async () => {
    const a = makeDevice(server, 'A')
    const { booth1 } = await seedShop(a)
    await a.engine.syncNow()
    const b = makeDevice(server, 'B')
    await b.engine.syncNow()
    const base = (await a.db.booths.get(booth1.id))!.updatedAt

    // B's later edit beats A's earlier one, whoever syncs first.
    await putAs(a, 'booths', { id: booth1.id, name: 'จาก A' }, base + 1000)
    await putAs(b, 'booths', { id: booth1.id, name: 'จาก B' }, base + 2000)
    await a.engine.syncNow()
    await b.engine.syncNow()
    await a.engine.syncNow()
    expect((await a.db.booths.get(booth1.id))!.name).toBe('จาก B')
    expect((await b.db.booths.get(booth1.id))!.name).toBe('จาก B')

    // An older offline edit loses to a newer one already on the server.
    await putAs(b, 'booths', { id: booth1.id, name: 'B ออฟไลน์' }, base + 3000)
    await putAs(a, 'booths', { id: booth1.id, name: 'A ใหม่กว่า' }, base + 4000)
    await a.engine.syncNow()
    await b.engine.syncNow()
    expect(await b.db.booths.get(booth1.id)).toMatchObject({ name: 'A ใหม่กว่า', synced: 1 })
    expect(await unsyncedCount(b.db)).toBe(0)
    expect(server.env.ss.getSheetByName('booths')!.records().find((r) => r.id === booth1.id)!['ชื่อแผง']).toBe('A ใหม่กว่า')
  })

  it('converges when two devices write the same record in the same millisecond', async () => {
    const a = makeDevice(server, 'A')
    const { booth2 } = await seedShop(a)
    await a.engine.syncNow()
    const b = makeDevice(server, 'B')
    await b.engine.syncNow()
    const t = (await a.db.booths.get(booth2.id))!.updatedAt + 500
    await putAs(a, 'booths', { id: booth2.id, name: 'ชื่อ A' }, t)
    await putAs(b, 'booths', { id: booth2.id, name: 'ชื่อ B' }, t)
    await a.engine.syncNow()
    await b.engine.syncNow() // server keeps A's copy and hands it back as stale
    await a.engine.syncNow()
    expect((await a.db.booths.get(booth2.id))!.name).toBe('ชื่อ A')
    expect(await b.db.booths.get(booth2.id)).toMatchObject({ name: 'ชื่อ A', synced: 1 })
  })

  it('propagates deletions', async () => {
    const a = makeDevice(server, 'A')
    const { tiers } = await seedShop(a)
    await a.engine.syncNow()
    const b = makeDevice(server, 'B')
    await b.engine.syncNow()
    expect(alive(await b.db.tiers.toArray())).toHaveLength(3)
    await remove(a.db.tiers, tiers[1].id)
    await a.engine.syncNow()
    await b.engine.syncNow()
    expect((await b.db.tiers.get(tiers[1].id))!.deleted).toBe(1)
    expect(alive(await b.db.tiers.toArray()).map((t) => t.price).sort((x, y) => x - y)).toEqual([39, 100])
    const rec = server.env.ss.getSheetByName('tiers')!.records().find((r) => r.id === tiers[1].id)!
    expect(rec.deleted).toBe(1)
  })

  it('re-sends everything to a new backend and re-reads it', async () => {
    const a = makeDevice(server, 'A')
    await seedShop(a)
    await a.engine.syncNow()
    const other = makeServer()
    other.backend.setup()
    a.engine = new SyncEngine({
      db: a.db,
      device: { get: a.cfg, set: (c) => a.setCfg(c) },
      fetch: backendFetch(other.backend).fetch,
      storage: memoryStorage(),
      isOnline: () => true,
    })
    a.setCfg({ syncUrl: URL2 })
    await a.engine.syncNow()
    expect(other.env.ss.getSheetByName('booths')!.records()).toHaveLength(2)
    expect(other.env.ss.getSheetByName('tiers')!.records()).toHaveLength(3)
    expect(a.cfg().lastPullSeq).toBe(7)
  })

  it('recovers when the backend counter was reset', async () => {
    const a = makeDevice(server, 'A')
    await seedShop(a)
    await a.engine.syncNow()
    const b = makeDevice(server, 'B')
    await b.engine.syncNow()
    for (const k of [...server.env.props.keys()]) if (k !== 'SYNC_KEY') server.env.props.delete(k)
    const sup = await save(a.db.suppliers, { name: 'หลังรีเซ็ต', phone: null, location: null, note: null })
    await a.engine.syncNow() // pushes with seq 1 (< A's cursor) and notices the reset
    await b.engine.syncNow()
    expect(await b.db.suppliers.get(sup.id)).toMatchObject({ name: 'หลังรีเซ็ต' })
    await a.engine.syncNow()
    await b.engine.syncNow()
    expect(await unsyncedCount(a.db)).toBe(0)
    expect(await unsyncedCount(b.db)).toBe(0)
  })

  it('re-reads everything when the local database was wiped', async () => {
    const a = makeDevice(server, 'A')
    await seedShop(a)
    await a.engine.syncNow()
    const b = makeDevice(server, 'B')
    await b.engine.syncNow()
    const cfg = b.cfg()
    expect(cfg.lastPullSeq).toBe(7)
    // Same device settings and sync bookkeeping, but the IndexedDB data is gone.
    const b2 = makeDevice(server, 'B2', { cfg: { ...cfg }, storage: b.storage })
    await b2.engine.syncNow()
    expect(await b2.db.booths.count()).toBe(2)
    expect(await b2.db.shop.get('shop')).toMatchObject({ name: 'ร้านทดสอบ' })
    expect(b2.cfg().lastPullSeq).toBe(7)
  })

  it('reports off, offline and error states without throwing', async () => {
    const a = makeDevice(server, 'A')
    await seedShop(a)

    a.setCfg({ syncUrl: '' })
    expect(a.engine.getStatus().state).toBe('off')
    expect(await a.engine.syncNow()).toMatchObject({ state: 'off', pending: 0 })
    expect(a.net.requests).toHaveLength(0)

    a.setCfg({ syncUrl: URL1 })
    expect(a.engine.getStatus().state).toBe('idle')
    a.online.value = false
    expect(await a.engine.syncNow()).toMatchObject({ state: 'offline', pending: 7 })
    expect(a.net.requests).toHaveLength(0)

    a.online.value = true
    a.net.down = true
    expect(await a.engine.syncNow()).toMatchObject({ state: 'offline', error: 'เชื่อมต่อไม่ได้ ตรวจลิงก์และอินเทอร์เน็ต' })

    a.net.down = false
    a.setCfg({ syncKey: 'wrong' })
    expect(await a.engine.syncNow()).toMatchObject({ state: 'error', error: 'รหัสไม่ถูกต้อง', pending: 7 })

    a.setCfg({ syncKey: KEY })
    a.net.rawReply = '<!doctype html><title>Sign in</title>'
    expect((await a.engine.syncNow()).state).toBe('error')

    a.net.rawReply = null
    expect(await a.engine.syncNow()).toMatchObject({ state: 'ok', error: null, pending: 0 })
  })

  it('testConnection gives short Thai answers', async () => {
    const a = makeDevice(server, 'A')
    expect(await a.engine.testConnection(URL1, KEY)).toEqual({ ok: true, message: 'เชื่อมต่อสำเร็จ · ยังไม่มีข้อมูลร้าน' })
    expect(await a.engine.testConnection(URL1, 'bad')).toEqual({ ok: false, message: 'รหัสไม่ถูกต้อง' })
    expect((await a.engine.testConnection('', KEY)).ok).toBe(false)
    expect((await a.engine.testConnection('script.google.com/x', KEY)).message).toContain('https://')
    expect((await a.engine.testConnection('https://script.google.com/macros/s/x/dev', KEY)).message).toContain('/exec')
    expect((await a.engine.testConnection(URL1, '  ')).ok).toBe(false)
    a.net.down = true
    expect(await a.engine.testConnection(URL1, KEY)).toEqual({ ok: false, message: 'เชื่อมต่อไม่ได้ ตรวจลิงก์และอินเทอร์เน็ต' })
    a.net.down = false
    a.net.rawReply = '<html>login</html>'
    expect((await a.engine.testConnection(URL1, KEY)).message).toContain('/exec')
    expect(a.net.requests.every((r) => r.body.action === 'ping')).toBe(true)
  })

  it('auto sync pushes shortly after a local write and ignores rows applied from the server', async () => {
    const a = makeDevice(server, 'A', { debounceMs: 20 })
    const b = makeDevice(server, 'B', { debounceMs: 20 })
    const stopA = a.engine.start()
    const stopB = b.engine.start()
    await waitFor(() => a.engine.getStatus().state === 'ok' && b.engine.getStatus().state === 'ok')

    await seedShop(a)
    await waitFor(async () => (await unsyncedCount(a.db)) === 0 && a.engine.getStatus().pending === 0)
    expect(actions(a.net)).toContain('push')

    await b.engine.syncNow()
    expect(await b.db.booths.count()).toBe(2)
    const afterPull = b.net.requests.length
    await sleep(80) // longer than the debounce: applying remote rows must not schedule another sync
    expect(b.net.requests.length).toBe(afterPull)
    expect(actions(b.net)).not.toContain('push')

    stopA()
    stopA() // stopping twice is fine
    const before = a.net.requests.length
    await save(a.db.suppliers, { name: 'หลังหยุด', phone: null, location: null, note: null })
    await sleep(80)
    expect(a.net.requests.length).toBe(before)
    stopB()
  })

  it('StrictMode-style start/stop/start keeps one set of timers and hooks', async () => {
    const a = makeDevice(server, 'A', { debounceMs: 20 })
    const stop1 = a.engine.start()
    stop1()
    const stop2 = a.engine.start()
    await waitFor(() => a.engine.getStatus().state === 'ok')
    await save(a.db.suppliers, { name: 'x', phone: null, location: null, note: null })
    await waitFor(async () => (await unsyncedCount(a.db)) === 0)
    expect(actions(a.net).filter((x) => x === 'push')).toHaveLength(1)
    stop2()
  })

  it('sends LINE through the backend, queues it offline and delivers it on the next sync', async () => {
    const a = makeDevice(server, 'A')
    expect(await a.engine.sendLine('ยอดวันนี้')).toEqual({ ok: false, queued: false, message: 'ยังไม่ได้ตั้งค่า LINE ใน Apps Script' })
    server.env.props.set('LINE_TOKEN', 'tok')
    server.env.props.set('LINE_TO', 'Uowner')
    expect(await a.engine.sendLine('ยอดวันนี้ 1,234 บาท')).toEqual({ ok: true, queued: false, message: 'ส่ง LINE แล้ว' })
    expect(server.env.lineCalls).toHaveLength(1)

    a.online.value = false
    const queued = await a.engine.sendLine('ปิดยอดแผงเสื้อ')
    expect(queued.ok).toBe(false)
    expect(queued.queued).toBe(true)
    expect(queued.message).toContain('จะส่ง LINE ให้เอง')
    a.online.value = true
    a.net.down = true
    const queuedNoNet = await a.engine.sendLine('ปิดยอดแผงรองเท้า')
    expect(queuedNoNet.message).toContain('จะส่ง LINE ให้เอง')
    expect(queuedNoNet.queued).toBe(true)
    a.net.down = false
    expect(server.env.lineCalls).toHaveLength(1)

    await a.engine.syncNow()
    expect(server.env.lineCalls).toHaveLength(3)
    const texts = server.env.lineCalls.map((c) => JSON.parse(c.options.payload).messages[0].text)
    expect(texts).toEqual(['ยอดวันนี้ 1,234 บาท', 'ปิดยอดแผงเสื้อ', 'ปิดยอดแผงรองเท้า'])
    await a.engine.syncNow()
    expect(server.env.lineCalls).toHaveLength(3) // sent once

    server.env.lineStatus = 500 // LINE hiccup: queued, then delivered with the same retry key
    expect(await a.engine.sendLine('ลองใหม่')).toEqual({ ok: false, queued: true, message: 'ส่ง LINE ยังไม่สำเร็จ จะลองส่งให้เองอีกครั้ง' })
    server.env.lineStatus = 200
    await a.engine.syncNow()
    const retried = server.env.lineCalls.slice(-2)
    expect(retried.map((c) => JSON.parse(c.options.payload).messages[0].text)).toEqual(['ลองใหม่', 'ลองใหม่'])
    expect(retried[0].options.headers['X-Line-Retry-Key']).toBe(retried[1].options.headers['X-Line-Retry-Key'])

    server.env.lineStatus = 429
    server.env.lineBody = '{"message":"You have reached your monthly limit."}'
    expect(await a.engine.sendLine('x')).toEqual({ ok: false, queued: false, message: 'ส่ง LINE ครบโควตาของเดือนนี้แล้ว' })

    a.setCfg({ syncUrl: '' })
    expect((await a.engine.sendLine('x')).ok).toBe(false)
    expect((await a.engine.sendLine('   ')).ok).toBe(false)
  })

  it('status subscribers are notified', async () => {
    const a = makeDevice(server, 'A')
    await seedShop(a)
    const states: string[] = []
    const unsub = a.engine.subscribe(() => states.push(a.engine.getStatus().state))
    await a.engine.syncNow()
    unsub()
    expect(states).toContain('syncing')
    expect(states[states.length - 1]).toBe('ok')
  })
})

// ---------------------------------------------------------------------------- merge rules

describe('merge rules', () => {
  const meta = (updatedAt: number, synced: 0 | 1, deviceId = 'd1'): Row =>
    ({ id: 'r', createdAt: 1, updatedAt, deviceId, deleted: 0, synced }) as SyncMeta as Row

  it('takeRemote follows last-write-wins', () => {
    expect(takeRemote(undefined, meta(5, 1))).toBe(true)
    expect(takeRemote(meta(4, 1), meta(5, 1))).toBe(true)
    expect(takeRemote(meta(4, 0), meta(5, 1))).toBe(true) // newer remote beats an older unpushed edit
    expect(takeRemote(meta(6, 0), meta(5, 1))).toBe(false) // newer local edit is kept and pushed
    expect(takeRemote(meta(6, 1), meta(5, 1))).toBe(false)
    expect(takeRemote(meta(5, 0, 'd2'), meta(5, 1))).toBe(false) // tie + unpushed: keep local
    expect(takeRemote(meta(5, 1, 'd2'), meta(5, 1))).toBe(true) // tie + synced: server copy
    expect(takeRemote(meta(5, 1, 'd1'), meta(5, 1, 'd1'))).toBe(false) // own echo
  })

  it('parseRemoteRows drops unknown tables and malformed rows', () => {
    const rows = parseRemoteRows([
      { table: 'booths', row: { id: 'a', updatedAt: 1 } },
      { table: 'unknownTable', row: { id: 'b', updatedAt: 1 } },
      { table: 'booths', row: { id: '', updatedAt: 1 } },
      { table: 'booths', row: { id: 'c' } },
      { table: 'booths', row: [1, 2] },
      null,
      'x',
    ])
    expect(rows.map((r) => r.row.id)).toEqual(['a'])
    expect(parseRemoteRows('nope')).toEqual([])
  })
})
