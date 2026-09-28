// Bulk data operations behind the "ข้อมูล" settings page.
import type { Table } from 'dexie'
import { SYNC_TABLES, alive, db as defaultDb, saveMany, type ShopDB } from '../../db'
import { getDevice, setDevice } from '../../device'
import { DEMO_STAFF_NAME } from '../../lib/demo'
import { clearCart } from '../pos/cartStore'
import type { ID, SyncMeta, TableName } from '../../types'

type RowTable = Table<SyncMeta & Record<string, unknown>, ID>

function rowTable(database: ShopDB, name: TableName): RowTable {
  return (database as unknown as Record<TableName, RowTable>)[name]
}

/** Everything that happened while selling. Settings (shop, booths, tiers, staff, suppliers) stay. */
export const SALES_TABLES = ['sales', 'shifts', 'cashMoves', 'lots', 'adjustments', 'expenses'] as const
export type SalesTable = (typeof SALES_TABLES)[number]

export const SALES_TABLE_LABEL: Record<SalesTable, string> = {
  sales: 'บิลขาย',
  shifts: 'รอบเปิดร้าน / ปิดยอด',
  cashMoves: 'เงินเข้า-ออกลิ้นชัก',
  lots: 'รับของเข้า',
  adjustments: 'ปรับสต็อก',
  expenses: 'ค่าใช้จ่าย',
}

/** Demo sellers are marked with this suffix in their name. */
export function isDemoStaffName(name: string): boolean {
  return name.trim() === DEMO_STAFF_NAME || name.trim().endsWith('(ทดลอง)')
}

export async function countSalesData(database: ShopDB = defaultDb): Promise<Record<SalesTable, number>> {
  const out = {} as Record<SalesTable, number>
  for (const t of SALES_TABLES) out[t] = await rowTable(database, t).filter((r) => r.deleted !== 1).count()
  return out
}

export interface ClearResult {
  counts: Record<SalesTable, number>
  staffOff: number
}

/**
 * "เริ่มใช้งานจริง": soft-delete every sales-side record (so the deletion also syncs to other
 * devices). Optionally switch off demo sellers created by the training data.
 */
export async function clearSalesData(opts: { deactivateDemoStaff: boolean }, database: ShopDB = defaultDb): Promise<ClearResult> {
  const tables = SALES_TABLES.map((t) => rowTable(database, t))
  const counts = {} as Record<SalesTable, number>
  let staffOff = 0
  await database.transaction('rw', [...tables, database.staff], async () => {
    for (const name of SALES_TABLES) {
      const t = rowTable(database, name)
      const rows = alive(await t.toArray())
      counts[name] = rows.length
      if (rows.length) await saveMany(t, rows.map((r) => ({ ...r, deleted: 1 as const })))
    }
    if (opts.deactivateDemoStaff) {
      const demo = alive(await database.staff.toArray()).filter((s) => s.active === 1 && s.role === 'staff' && isDemoStaffName(s.name))
      staffOff = demo.length
      if (demo.length) await saveMany(database.staff, demo.map((s) => ({ ...s, active: 0 as const })))
    }
  })
  return { counts, staffOff }
}

/** Keys of this device's unfinished work (half-built bills, half-done counts, drawer counts). */
const DRAFT_PREFIXES = ['pratunam.pos.cart.v1:', 'pratunam.stock.countDraft.', 'pratunam.shift.closeDraft.']

/**
 * After "เริ่มใช้งานจริง": drop this device's training leftovers (a cart built while practising
 * must not end up in a real bill). Other devices keep theirs until they are cleared there.
 */
export async function clearDeviceDrafts(database: ShopDB = defaultDb): Promise<void> {
  try {
    for (const b of await database.booths.toArray()) clearCart(b.id)
  } catch {
    /* booths unreadable — the storage sweep below still removes stored carts */
  }
  for (const store of [safeStorage('localStorage'), safeStorage('sessionStorage')]) {
    if (!store) continue
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k && DRAFT_PREFIXES.some((p) => k.startsWith(p))) keys.push(k)
    }
    for (const k of keys) store.removeItem(k)
  }
}

/** Local rows not yet sent to the sync backend. */
export async function unsyncedCount(database: ShopDB = defaultDb): Promise<number> {
  let n = 0
  for (const name of SYNC_TABLES) n += await rowTable(database, name).where('synced').equals(0).count()
  return n
}

export class WipeError extends Error {}

/**
 * Remove everything this app stored on this device (database + 'pratunam.' keys), then reload.
 * Sync is switched off first so a background pull can't refill the database meanwhile.
 */
export async function wipeThisDevice(): Promise<void> {
  if (getDevice().syncUrl) setDevice({ syncUrl: '', syncKey: '' })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      defaultDb.delete(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new WipeError('blocked')), 10_000)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
  for (const store of [safeStorage('localStorage'), safeStorage('sessionStorage')]) {
    if (!store) continue
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k && k.startsWith('pratunam.')) keys.push(k)
    }
    for (const k of keys) store.removeItem(k)
  }
  window.location.replace(window.location.pathname + window.location.search)
}

function safeStorage(name: 'localStorage' | 'sessionStorage'): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window[name]
  } catch {
    return null
  }
}
