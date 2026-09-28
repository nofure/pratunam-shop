// Backup / restore of the whole local database (JSON) and CSV export of bills.
import { SYNC_TABLES, db as defaultDb, type ShopDB } from '../db'
import { getDeviceId } from '../device'
import { PAY_METHOD_LABEL } from '../constants'
import type { Booth, ID, PayMethod, Sale, ShopConfig, Staff, SyncMeta, TableName } from '../types'
import type { Table } from 'dexie'
import { toCsv } from './share'
import { baht, timeHM } from './format'
import { toDayKey } from './dates'

export const BACKUP_APP = 'pratunam-shop'
export const BACKUP_VERSION = 1

export type BackupRow = SyncMeta & Record<string, unknown>
type RowTable = Table<BackupRow, ID>

export interface BackupFile {
  app: typeof BACKUP_APP
  version: number
  exportedAt: number
  deviceId: string
  shopName: string
  counts: Record<TableName, number>
  tables: Record<TableName, BackupRow[]>
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

function rowTable(database: ShopDB, name: TableName): RowTable {
  return (database as unknown as Record<TableName, RowTable>)[name]
}

function emptyCounts(): Record<TableName, number> {
  const c = {} as Record<TableName, number>
  for (const t of SYNC_TABLES) c[t] = 0
  return c
}

/** Every table including soft-deleted rows, so a restore brings deletions back too. */
export async function exportBackup(database: ShopDB = defaultDb): Promise<BackupFile> {
  const tables = {} as Record<TableName, BackupRow[]>
  const counts = emptyCounts()
  await database.transaction('r', SYNC_TABLES.map((n) => rowTable(database, n)), async () => {
    for (const name of SYNC_TABLES) {
      const rows = await rowTable(database, name).toArray()
      tables[name] = rows
      counts[name] = rows.length
    }
  })
  const shop = (tables.shop.find((r) => r.id === 'shop') ?? null) as ShopConfig | null
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    deviceId: getDeviceId(),
    shopName: shop?.name ?? '',
    counts,
    tables,
  }
}

/** 'pratunam-backup-2026-09-29-1405.json' */
export function backupFilename(ts: number = Date.now()): string {
  const d = new Date(ts)
  return `pratunam-backup-${toDayKey(d)}-${timeHM(ts).replace(':', '')}.json`
}

export function backupJson(file: BackupFile): string {
  return JSON.stringify(file)
}

// ---------------------------------------------------------------- validation

type Kind = 'str' | 'num' | 'arr' | 'bit'

/** Minimum fields each table needs so pages can render it. */
const REQUIRED: Record<TableName, Record<string, Kind>> = {
  shop: { name: 'str', setupDone: 'bit' },
  booths: { name: 'str', openingFloat: 'num', sort: 'num', active: 'bit' },
  staff: { name: 'str', pin: 'str', role: 'str', active: 'bit' },
  tiers: { boothId: 'str', name: 'str', price: 'num', unit: 'str', sort: 'num', active: 'bit' },
  sales: {
    boothId: 'str',
    shiftId: 'str',
    staffId: 'str',
    dayKey: 'str',
    billNo: 'num',
    items: 'arr',
    total: 'num',
    method: 'str',
    status: 'str',
  },
  shifts: { boothId: 'str', staffId: 'str', dayKey: 'str', openedAt: 'num', openingFloat: 'num', status: 'str' },
  cashMoves: { shiftId: 'str', boothId: 'str', dayKey: 'str', type: 'str', amount: 'num' },
  lots: { boothId: 'str', tierId: 'str', dayKey: 'str', qty: 'num', unitCost: 'num', totalCost: 'num' },
  adjustments: { boothId: 'str', tierId: 'str', dayKey: 'str', qtyChange: 'num', reason: 'str' },
  suppliers: { name: 'str' },
  expenses: { dayKey: 'str', category: 'str', amount: 'num' },
}

function kindOk(v: unknown, k: Kind): boolean {
  switch (k) {
    case 'str':
      return typeof v === 'string'
    case 'num':
      return typeof v === 'number' && Number.isFinite(v)
    case 'arr':
      return Array.isArray(v)
    case 'bit':
      return v === 0 || v === 1
  }
}

/** A usable row of `table`, normalised (deleted 0/1, synced 0), or null. */
export function cleanRow(table: TableName, v: unknown): BackupRow | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  if (typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt)) return null
  if (table === 'shop' && r.id !== 'shop') return null
  for (const [field, kind] of Object.entries(REQUIRED[table])) if (!kindOk(r[field], kind)) return null
  return {
    ...r,
    id: r.id,
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : r.updatedAt,
    updatedAt: r.updatedAt,
    deviceId: typeof r.deviceId === 'string' ? r.deviceId : '',
    deleted: r.deleted === 1 ? 1 : 0,
    synced: 0,
  }
}

export interface ParsedBackup {
  exportedAt: number | null
  shop: ShopConfig | null
  tables: Record<TableName, BackupRow[]>
  counts: Record<TableName, number>
  /** rows per table that are not soft-deleted (for showing what the file holds) */
  live: Record<TableName, number>
  /** rows that were dropped because they were malformed */
  invalid: number
  total: number
}

const parsedResults = new WeakSet<object>()

/** Read and check a backup file (text or already-parsed JSON). Throws BackupError with a Thai message. */
export function parseBackup(input: unknown): ParsedBackup {
  let data: unknown = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input.replace(/^﻿/, ''))
    } catch {
      throw new BackupError('ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบร้าน')
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BackupError('ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบร้าน')
  const o = data as Record<string, unknown>
  if (o.app !== BACKUP_APP || !o.tables || typeof o.tables !== 'object' || Array.isArray(o.tables)) {
    throw new BackupError('ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบร้าน')
  }
  if (typeof o.version !== 'number' || o.version > BACKUP_VERSION) {
    throw new BackupError('ไฟล์สำรองนี้มาจากแอปรุ่นใหม่กว่า อัปเดตแอปก่อนแล้วลองอีกครั้ง')
  }
  const src = o.tables as Record<string, unknown>
  const tables = {} as Record<TableName, BackupRow[]>
  const counts = emptyCounts()
  const live = emptyCounts()
  let invalid = 0
  let total = 0
  for (const name of SYNC_TABLES) {
    const list = src[name]
    const rows: BackupRow[] = []
    if (Array.isArray(list)) {
      // Same id twice in one file: keep the newest.
      const byId = new Map<string, BackupRow>()
      for (const item of list) {
        const row = cleanRow(name, item)
        if (!row) {
          invalid++
          continue
        }
        const prev = byId.get(row.id)
        if (!prev || row.updatedAt > prev.updatedAt) byId.set(row.id, row)
      }
      rows.push(...byId.values())
    } else if (list !== undefined) {
      invalid++
    }
    tables[name] = rows
    counts[name] = rows.length
    live[name] = rows.filter((r) => r.deleted !== 1).length
    total += rows.length
  }
  if (total === 0) throw new BackupError('ไฟล์สำรองนี้ไม่มีข้อมูล')
  const shop = (tables.shop.find((r) => r.id === 'shop') ?? null) as ShopConfig | null
  const result: ParsedBackup = {
    exportedAt: typeof o.exportedAt === 'number' && Number.isFinite(o.exportedAt) ? o.exportedAt : null,
    shop,
    tables,
    counts,
    live,
    invalid,
    total,
  }
  parsedResults.add(result)
  return result
}

// ---------------------------------------------------------------- import (merge)

/** Last write wins: a backup row replaces the local one only when it is strictly newer. */
export function backupRowWins(local: SyncMeta | undefined, incoming: SyncMeta): boolean {
  return !local || incoming.updatedAt > local.updatedAt
}

export interface ImportResult {
  added: number
  updated: number
  skipped: number
  invalid: number
  byTable: Record<TableName, { added: number; updated: number; skipped: number }>
}

/**
 * Merge a backup into the local database. Rows keep their own updatedAt (so a restore never
 * overrides newer data on other devices) and are marked synced 0 so sync sends them out.
 * This is the one place besides the sync module that writes rows without stamping them:
 * stamping would make old backup rows look newer than everyone else's edits.
 */
export async function importBackup(input: unknown, database: ShopDB = defaultDb): Promise<ImportResult> {
  const parsed = isParsed(input) ? input : parseBackup(input)
  const byTable = {} as ImportResult['byTable']
  let added = 0
  let updated = 0
  let skipped = 0
  await database.transaction('rw', SYNC_TABLES.map((n) => rowTable(database, n)), async () => {
    for (const name of SYNC_TABLES) {
      const t = rowTable(database, name)
      const rows = parsed.tables[name]
      const stats = { added: 0, updated: 0, skipped: 0 }
      if (rows.length) {
        const locals = await t.bulkGet(rows.map((r) => r.id))
        const puts: BackupRow[] = []
        rows.forEach((row, i) => {
          const local = locals[i]
          if (!backupRowWins(local, row)) {
            stats.skipped++
            return
          }
          if (local) stats.updated++
          else stats.added++
          puts.push({ ...row, synced: 0 })
        })
        if (puts.length) await t.bulkPut(puts)
      }
      byTable[name] = stats
      added += stats.added
      updated += stats.updated
      skipped += stats.skipped
    }
  })
  return { added, updated, skipped, invalid: parsed.invalid, byTable }
}

function isParsed(v: unknown): v is ParsedBackup {
  return !!v && typeof v === 'object' && parsedResults.has(v)
}

// ---------------------------------------------------------------- CSV

export interface CsvContext {
  booths: Booth[]
  staff: Staff[]
  shop?: ShopConfig | null
}

function methodName(m: PayMethod, shop?: ShopConfig | null): string {
  if (m === 'other') return shop?.otherPayLabel?.trim() || PAY_METHOD_LABEL.other
  return PAY_METHOD_LABEL[m] ?? String(m)
}

function lookups(ctx: CsvContext) {
  const booth = new Map(ctx.booths.map((b) => [b.id, b.name]))
  const staff = new Map(ctx.staff.map((s) => [s.id, s.name]))
  return {
    booth: (id: ID) => booth.get(id) ?? '',
    staff: (id: ID | null) => (id ? (staff.get(id) ?? '') : ''),
  }
}

function sortedLive(sales: Sale[]): Sale[] {
  return sales.filter((s) => s.deleted !== 1).sort((a, b) => a.createdAt - b.createdAt)
}

/** One row per bill (not deleted), oldest first. Voided bills are included with their status. */
export function salesCsv(sales: Sale[], ctx: CsvContext): string {
  const L = lookups(ctx)
  const rows: (string | number | null)[][] = [
    [
      'วันที่',
      'เวลา',
      'แผง',
      'บิลที่',
      'คนขาย',
      'รายการ',
      'จำนวนชิ้น',
      'ยอดเต็ม',
      'ส่วนลดโปร',
      'ส่วนลดต่อราคา',
      'ยอดสุทธิ',
      'วิธีจ่าย',
      'รับเงินสด',
      'เงินทอน',
      'สถานะ',
      'เหตุผลยกเลิก',
      'หมายเหตุ',
      'รหัสบิล',
    ],
  ]
  for (const s of sortedLive(sales)) {
    const items = (Array.isArray(s.items) ? s.items : [])
      .map((i) => `${i.name} ${baht(i.price)} x${i.qty}`)
      .join(' + ')
    rows.push([
      s.dayKey,
      timeHM(s.createdAt),
      L.booth(s.boothId),
      s.billNo,
      L.staff(s.staffId),
      items,
      s.pieces,
      s.subtotal,
      s.promoDiscount,
      s.manualDiscount,
      s.total,
      methodName(s.method, ctx.shop),
      s.cashReceived,
      s.change,
      s.status === 'void' ? 'ยกเลิก' : 'ขายแล้ว',
      s.voidReason,
      s.note,
      s.id,
    ])
  }
  return toCsv(rows)
}

/** One row per item line, for pivot tables in Excel / Google Sheets. */
export function saleItemsCsv(sales: Sale[], ctx: CsvContext): string {
  const L = lookups(ctx)
  const rows: (string | number | null)[][] = [
    ['วันที่', 'เวลา', 'แผง', 'บิลที่', 'สินค้า', 'ราคา', 'จำนวน', 'หน่วย', 'โปร', 'ยอดเต็ม', 'ยอดหลังโปร', 'วิธีจ่าย', 'สถานะ', 'รหัสบิล'],
  ]
  for (const s of sortedLive(sales)) {
    for (const i of Array.isArray(s.items) ? s.items : []) {
      const promo = i.promoQty != null && i.promoPrice != null ? `${i.promoQty} ${i.unit} ${baht(i.promoPrice)}` : ''
      rows.push([
        s.dayKey,
        timeHM(s.createdAt),
        L.booth(s.boothId),
        s.billNo,
        i.name,
        i.price,
        i.qty,
        i.unit,
        promo,
        i.fullTotal,
        i.lineTotal,
        methodName(s.method, ctx.shop),
        s.status === 'void' ? 'ยกเลิก' : 'ขายแล้ว',
        s.id,
      ])
    }
  }
  return toCsv(rows)
}
