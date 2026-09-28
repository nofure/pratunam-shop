import Dexie, { type Table } from 'dexie'
import type {
  Adjustment,
  Booth,
  CashMove,
  Expense,
  ID,
  Lot,
  Sale,
  Shift,
  ShopConfig,
  Staff,
  Supplier,
  SyncMeta,
  TableName,
  Tier,
} from './types'
import { getDeviceId } from './device'

export class ShopDB extends Dexie {
  shop!: Table<ShopConfig, ID>
  booths!: Table<Booth, ID>
  staff!: Table<Staff, ID>
  tiers!: Table<Tier, ID>
  sales!: Table<Sale, ID>
  shifts!: Table<Shift, ID>
  cashMoves!: Table<CashMove, ID>
  lots!: Table<Lot, ID>
  adjustments!: Table<Adjustment, ID>
  suppliers!: Table<Supplier, ID>
  expenses!: Table<Expense, ID>

  constructor(name = 'pratunam-shop') {
    super(name)
    this.version(1).stores({
      shop: 'id, synced',
      booths: 'id, synced, sort',
      staff: 'id, synced',
      tiers: 'id, boothId, synced, [boothId+sort]',
      sales: 'id, dayKey, shiftId, boothId, [boothId+dayKey], synced, createdAt',
      shifts: 'id, boothId, dayKey, status, [boothId+status], synced, openedAt',
      cashMoves: 'id, shiftId, dayKey, synced',
      lots: 'id, tierId, boothId, dayKey, synced',
      adjustments: 'id, tierId, boothId, dayKey, synced',
      suppliers: 'id, synced',
      expenses: 'id, dayKey, boothId, synced',
    })
  }
}

export const db = new ShopDB()

export const SYNC_TABLES: TableName[] = [
  'shop',
  'booths',
  'staff',
  'tiers',
  'sales',
  'shifts',
  'cashMoves',
  'lots',
  'adjustments',
  'suppliers',
  'expenses',
]

export function tableOf(name: TableName): Table<SyncMeta & Record<string, unknown>, ID> {
  return (db as unknown as Record<TableName, Table<SyncMeta & Record<string, unknown>, ID>>)[name]
}

/** UUID v4 that also works on plain-http LAN addresses (crypto.randomUUID needs a secure context). */
export function newId(): ID {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

type NewRecord<T extends SyncMeta> = Omit<T, keyof SyncMeta> & Partial<SyncMeta>

/** Fill sync metadata for a record about to be written locally. */
export function stamp<T extends SyncMeta>(rec: NewRecord<T>): T {
  const now = Date.now()
  return {
    ...rec,
    id: rec.id ?? newId(),
    createdAt: rec.createdAt ?? now,
    updatedAt: Math.max(now, (rec.updatedAt ?? 0) + 1),
    deviceId: getDeviceId(),
    deleted: rec.deleted ?? 0,
    synced: 0,
  } as T
}

/**
 * Insert or update a record. ALWAYS write through save()/remove() (never table.put directly)
 * so the change is stamped and picked up by sync.
 */
export async function save<T extends SyncMeta>(table: Table<T, ID>, rec: NewRecord<T>): Promise<T> {
  const full = stamp<T>(rec)
  await table.put(full)
  return full
}

export async function saveMany<T extends SyncMeta>(table: Table<T, ID>, recs: NewRecord<T>[]): Promise<T[]> {
  const full = recs.map((r) => stamp<T>(r))
  await table.bulkPut(full)
  return full
}

/** Partial update of an existing record (stamps it). Returns the updated record or undefined. */
export async function patch<T extends SyncMeta>(
  table: Table<T, ID>,
  id: ID,
  changes: Partial<Omit<T, keyof SyncMeta>>,
): Promise<T | undefined> {
  const cur = await table.get(id)
  if (!cur) return undefined
  return save(table, { ...cur, ...changes } as NewRecord<T>)
}

/** Soft delete (keeps the row so the deletion syncs to other devices). */
export async function remove<T extends SyncMeta>(table: Table<T, ID>, id: ID): Promise<void> {
  const cur = await table.get(id)
  if (!cur) return
  await table.put(stamp<T>({ ...cur, deleted: 1 } as NewRecord<T>))
}

/** Drop soft-deleted rows. */
export function alive<T extends { deleted: 0 | 1 }>(rows: T[]): T[] {
  return rows.filter((r) => r.deleted !== 1)
}
