import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { ShopDB, save } from '../db'
import type { Booth, Sale, ShopConfig, Staff } from '../types'
import { BackupError, backupRowWins, exportBackup, importBackup, parseBackup, saleItemsCsv, salesCsv } from './backup'

const dbs: ShopDB[] = []
let n = 0
function makeDb(): ShopDB {
  const d = new ShopDB(`backup-test-${++n}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  while (dbs.length) await dbs.pop()!.delete()
})

async function seed(d: ShopDB) {
  await save<ShopConfig>(d.shop, {
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
  const booth = await save<Booth>(d.booths, { name: 'แผงเสื้อ', openingFloat: 1000, sort: 0, active: 1 })
  const owner = await save<Staff>(d.staff, { name: 'เจ้าของ', pin: '2580', role: 'owner', boothId: null, active: 1 })
  const gone = await save<Booth>(d.booths, { name: 'แผงเก่า', openingFloat: 500, sort: 1, active: 1, deleted: 1 })
  return { booth, owner, gone }
}

function sale(p: Partial<Sale>): Omit<Sale, 'id' | 'createdAt' | 'updatedAt' | 'deviceId' | 'deleted' | 'synced'> & Partial<Sale> {
  return {
    boothId: 'b',
    shiftId: 'sh',
    staffId: 'st',
    dayKey: '2026-09-28',
    billNo: 1,
    items: [
      { tierId: 't', name: 'เสื้อยืด, ลาย "หมี"', unit: 'ตัว', price: 39, qty: 3, promoQty: 3, promoPrice: 100, fullTotal: 117, lineTotal: 100 },
    ],
    pieces: 3,
    subtotal: 117,
    promoDiscount: 17,
    manualDiscount: 0,
    total: 100,
    method: 'cash',
    cashReceived: 100,
    change: 0,
    status: 'paid',
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    note: null,
    ...p,
  }
}

describe('backup export / import', () => {
  it('round-trips every table including deleted rows and marks rows unsynced', async () => {
    const a = makeDb()
    await seed(a)
    const file = await exportBackup(a)
    expect(file.app).toBe('pratunam-shop')
    expect(file.version).toBe(1)
    expect(file.counts.booths).toBe(2)
    expect(file.shopName).toBe('ร้านทดสอบ')

    const parsed = parseBackup(JSON.stringify(file))
    expect(parsed.total).toBe(4)
    expect(parsed.shop?.name).toBe('ร้านทดสอบ')

    const b = makeDb()
    const res = await importBackup(JSON.stringify(file), b)
    expect(res.added).toBe(4)
    expect(res.updated).toBe(0)
    const booths = await b.booths.toArray()
    expect(booths).toHaveLength(2)
    expect(booths.filter((x) => x.deleted === 1)).toHaveLength(1)
    expect(booths.every((x) => x.synced === 0)).toBe(true)
    const original = await a.booths.toArray()
    for (const r of booths) expect(r.updatedAt).toBe(original.find((o) => o.id === r.id)!.updatedAt)
  })

  it('keeps newer local rows (last write wins) and skips equal ones', async () => {
    const a = makeDb()
    const { booth } = await seed(a)
    const file = await exportBackup(a)
    const b = makeDb()
    await importBackup(file.tables ? JSON.stringify(file) : '', b)
    // Local edit after the backup was taken.
    const cur = (await b.booths.get(booth.id))!
    await b.booths.put({ ...cur, name: 'แผงเสื้อ (แก้แล้ว)', updatedAt: cur.updatedAt + 1000 })
    const res = await importBackup(JSON.stringify(file), b)
    expect(res.added).toBe(0)
    expect(res.updated).toBe(0)
    expect(res.skipped).toBe(4)
    expect((await b.booths.get(booth.id))!.name).toBe('แผงเสื้อ (แก้แล้ว)')

    // A newer row in the file replaces the local one.
    const newer = { ...file, tables: { ...file.tables, booths: file.tables.booths.map((r) => (r.id === booth.id ? { ...r, name: 'จากไฟล์', updatedAt: cur.updatedAt + 5000 } : r)) } }
    const res2 = await importBackup(JSON.stringify(newer), b)
    expect(res2.updated).toBe(1)
    expect((await b.booths.get(booth.id))!.name).toBe('จากไฟล์')
  })

  it('rejects files that are not backups and drops malformed rows', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError)
    expect(() => parseBackup(JSON.stringify({ app: 'other', version: 1, tables: {} }))).toThrow(BackupError)
    expect(() => parseBackup(JSON.stringify({ app: 'pratunam-shop', version: 99, tables: {} }))).toThrow(/รุ่นใหม่กว่า/)
    expect(() => parseBackup(JSON.stringify({ app: 'pratunam-shop', version: 1, tables: {} }))).toThrow(/ไม่มีข้อมูล/)
    const parsed = parseBackup({
      app: 'pratunam-shop',
      version: 1,
      tables: {
        booths: [
          { id: 'b1', updatedAt: 5, createdAt: 1, name: 'ok', openingFloat: 0, sort: 0, active: 1, deleted: 0 },
          { id: 'b2', updatedAt: 5, name: 'no float', sort: 0, active: 1 },
          { id: '', updatedAt: 5 },
          'junk',
        ],
        shop: [{ id: 'not-shop', updatedAt: 1, name: 'x', setupDone: 1 }],
      },
    })
    expect(parsed.counts.booths).toBe(1)
    expect(parsed.counts.shop).toBe(0)
    expect(parsed.invalid).toBe(4)
  })

  it('backupRowWins is strict last-write-wins', () => {
    const m = { id: 'x', createdAt: 1, deviceId: 'd', deleted: 0 as const, synced: 1 as const }
    expect(backupRowWins(undefined, { ...m, updatedAt: 1 })).toBe(true)
    expect(backupRowWins({ ...m, updatedAt: 5 }, { ...m, updatedAt: 5 })).toBe(false)
    expect(backupRowWins({ ...m, updatedAt: 5 }, { ...m, updatedAt: 6 })).toBe(true)
  })
})

describe('CSV', () => {
  it('writes bills and items with Thai headers, escaping and no deleted rows', async () => {
    const d = makeDb()
    const s1 = await save<Sale>(d.sales, sale({ boothId: 'b', staffId: 'st' }))
    await save<Sale>(d.sales, sale({ billNo: 2, status: 'void', voidReason: 'กดผิด' }))
    await save<Sale>(d.sales, sale({ billNo: 3, deleted: 1 }))
    const all = await d.sales.toArray()
    const ctx = {
      booths: [{ id: 'b', name: 'แผงเสื้อ' } as Booth],
      staff: [{ id: 'st', name: 'น้องบี' } as Staff],
    }
    const csv = salesCsv(all, ctx)
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(3)
    expect(lines[0].startsWith('วันที่,เวลา,แผง,บิลที่')).toBe(true)
    expect(lines[1]).toContain('แผงเสื้อ')
    expect(lines[1]).toContain('น้องบี')
    expect(lines[1]).toContain('"เสื้อยืด, ลาย ""หมี"" 39 x3"')
    expect(lines[1]).toContain(s1.id)
    expect(lines[2]).toContain('ยกเลิก')
    const items = saleItemsCsv(all, ctx).split('\r\n')
    expect(items).toHaveLength(3)
    expect(items[1]).toContain('3 ตัว 100')
  })
})
