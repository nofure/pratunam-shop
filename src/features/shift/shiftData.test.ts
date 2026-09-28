import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShopDB, alive, save } from '../../db'
import { mkItem, mkSale } from '../../domain/test-fixtures'
import type { Shift } from '../../types'
import {
  addCashMove,
  buildShiftText,
  canDeleteMove,
  cleanDenominations,
  closeShift,
  deleteCashMove,
  findOpenShifts,
  isShiftError,
  loadCloseDraft,
  openShift,
  shiftTotalsOf,
} from './shiftData'

let database: ShopDB
let n = 0

beforeEach(async () => {
  n += 1
  database = new ShopDB(`shift-test-${n}`)
  await database.open()
})

afterEach(async () => {
  database.close()
  await database.delete()
})

const OPENED = new Date(2026, 8, 29, 9, 0).getTime()

async function open(float = 500): Promise<Shift> {
  return openShift({ boothId: 'b1', staffId: 's1', openingFloat: float, now: OPENED }, database)
}

async function addSale(shift: Shift, p: Parameters<typeof mkSale>[0]) {
  return save(database.sales, mkSale({ boothId: shift.boothId, shiftId: shift.id, dayKey: shift.dayKey, ...p }))
}

describe('openShift', () => {
  it('creates an open shift for today with empty close fields', async () => {
    const s = await open(1000)
    expect(s).toMatchObject({
      boothId: 'b1',
      staffId: 's1',
      dayKey: '2026-09-29',
      openedAt: OPENED,
      openingFloat: 1000,
      status: 'open',
      closedAt: null,
      closedBy: null,
      countedCash: null,
      denominations: null,
      expectedCash: null,
      cashDiff: null,
      transferChecked: 0,
      halfhalfChecked: 0,
      note: null,
      snapshot: null,
      synced: 0,
      deleted: 0,
    })
    expect((await findOpenShifts('b1', database)).map((x) => x.id)).toEqual([s.id])
  })

  it('refuses a second open shift for the same booth', async () => {
    const first = await open()
    const err = await open().catch((e) => e)
    expect(isShiftError(err, 'already_open')).toBe(true)
    expect(err.shift.id).toBe(first.id)
    // other booths are independent
    await expect(openShift({ boothId: 'b2', staffId: 's1', openingFloat: 0 }, database)).resolves.toBeTruthy()
  })

  it('lets only one of two simultaneous opens win', async () => {
    const results = await Promise.allSettled([open(), open(), open()])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await findOpenShifts('b1', database)).toHaveLength(1)
  })

  it('rejects a negative or missing float', async () => {
    const err = await openShift({ boothId: 'b1', staffId: 's1', openingFloat: -1 }, database).catch((e) => e)
    expect(isShiftError(err, 'invalid')).toBe(true)
  })
})

describe('closeShift', () => {
  it('freezes totals, stores the count and the difference', async () => {
    const shift = await open(500)
    await addSale(shift, { items: [mkItem({ price: 139, qty: 2 })], method: 'cash' }) // 278
    await addSale(shift, { items: [mkItem({ price: 39, qty: 3, promoQty: 3, promoPrice: 100 })], method: 'transfer' }) // 100
    await addSale(shift, { items: [mkItem({ price: 200, qty: 1 })], method: 'cash', status: 'void' })
    await addCashMove({ shiftId: shift.id, staffId: 's1', type: 'out', amount: 60, reason: 'ค่าข้าว', category: 'food' }, database)
    await addCashMove({ shiftId: shift.id, staffId: 's1', type: 'in', amount: 100, reason: 'เติมเงินทอน', category: 'food' }, database)

    // expected = 500 + 278 + 100 − 60 = 818; counted 800 → ขาด 18
    const res = await closeShift(
      {
        shiftId: shift.id,
        staffId: 's2',
        countedCash: 800,
        denominations: { '500': 1, '100': 3, '20': 0, '7': 4 },
        seen: { expectedCash: 818, transfer: 100, halfhalf: 0 },
        transferChecked: true,
        halfhalfChecked: true,
        note: '  ทอนผิด  ',
        now: OPENED + 3_600_000,
      },
      database,
    )
    expect(res.shift).toMatchObject({
      status: 'closed',
      closedBy: 's2',
      closedAt: OPENED + 3_600_000,
      countedCash: 800,
      denominations: { '500': 1, '100': 3 },
      expectedCash: 818,
      cashDiff: -18,
      transferChecked: 1,
      halfhalfChecked: 0, // no คนละครึ่ง sales → nothing to check
      note: 'ทอนผิด',
    })
    expect(res.shift.snapshot).toMatchObject({ bills: 2, total: 378, voidBills: 1, cashIn: 100, cashOut: 60, expectedCash: 818 })
    expect(res.sales).toHaveLength(3)
    expect(await findOpenShifts('b1', database)).toHaveLength(0)

    const stored = await database.shifts.get(shift.id)
    expect(stored?.status).toBe('closed')
    expect(stored?.synced).toBe(0)
    // the "in" move never carries an expense category
    const moves = alive(await database.cashMoves.where('shiftId').equals(shift.id).toArray())
    expect(moves.find((m) => m.type === 'in')?.category).toBeNull()
    expect(moves.every((m) => m.dayKey === shift.dayKey)).toBe(true)
  })

  it('refuses when new bills arrived after the numbers were checked', async () => {
    const shift = await open(500)
    await addSale(shift, { items: [mkItem({ price: 100, qty: 1 })], method: 'cash' })
    const err = await closeShift(
      {
        shiftId: shift.id,
        staffId: 's1',
        countedCash: 500,
        denominations: null,
        seen: { expectedCash: 500, transfer: 0, halfhalf: 0 },
        transferChecked: false,
        halfhalfChecked: false,
        note: '',
      },
      database,
    ).catch((e) => e)
    expect(isShiftError(err, 'changed')).toBe(true)
    expect((await database.shifts.get(shift.id))?.status).toBe('open')
  })

  it('refuses to close twice and to add money to a closed shift', async () => {
    const shift = await open(0)
    const input = {
      shiftId: shift.id,
      staffId: 's1',
      countedCash: 0,
      denominations: null,
      seen: { expectedCash: 0, transfer: 0, halfhalf: 0 },
      transferChecked: false,
      halfhalfChecked: false,
      note: '',
    }
    const first = await closeShift(input, database)
    expect(first.shift.cashDiff).toBe(0)
    expect(first.shift.note).toBeNull()
    expect(isShiftError(await closeShift(input, database).catch((e) => e), 'not_open')).toBe(true)
    const err = await addCashMove({ shiftId: shift.id, staffId: 's1', type: 'out', amount: 10, reason: 'x', category: null }, database).catch(
      (e) => e,
    )
    expect(isShiftError(err, 'not_open')).toBe(true)
  })
})

describe('cash moves', () => {
  it('validates amount and reason', async () => {
    const shift = await open()
    for (const bad of [
      { amount: 0, reason: 'x' },
      { amount: -5, reason: 'x' },
      { amount: 10, reason: '   ' },
    ]) {
      const err = await addCashMove({ shiftId: shift.id, staffId: 's1', type: 'out', category: null, ...bad }, database).catch((e) => e)
      expect(isShiftError(err, 'invalid')).toBe(true)
    }
  })

  it('lets the recorder delete while open, the owner always', async () => {
    const shift = await open()
    const mv = await addCashMove({ shiftId: shift.id, staffId: 's1', type: 'out', amount: 40, reason: 'ถุง', category: 'supplies' }, database)
    const mv2 = await addCashMove({ shiftId: shift.id, staffId: 's1', type: 'out', amount: 50, reason: 'ข้าว', category: 'food' }, database)

    const other = await deleteCashMove(mv.id, { id: 's9', isOwner: false }, database).catch((e) => e)
    expect(isShiftError(other, 'not_allowed')).toBe(true)
    await deleteCashMove(mv.id, { id: 's1', isOwner: false }, database)
    expect((await database.cashMoves.get(mv.id))?.deleted).toBe(1)

    await closeShift(
      {
        shiftId: shift.id,
        staffId: 's1',
        countedCash: 450,
        denominations: null,
        seen: { expectedCash: 450, transfer: 0, halfhalf: 0 },
        transferChecked: false,
        halfhalfChecked: false,
        note: '',
      },
      database,
    )
    const late = await deleteCashMove(mv2.id, { id: 's1', isOwner: false }, database).catch((e) => e)
    expect(isShiftError(late, 'not_allowed')).toBe(true)
    await deleteCashMove(mv2.id, { id: 'owner', isOwner: true }, database)
    expect((await database.cashMoves.get(mv2.id))?.deleted).toBe(1)
    // the frozen snapshot keeps the numbers seen at close
    const closed = (await database.shifts.get(shift.id)) as Shift
    expect(shiftTotalsOf(closed, [], []).cashOut).toBe(50)
  })

  it('canDeleteMove rules', () => {
    expect(canDeleteMove({ staffId: 'a' }, true, { id: 'a', isOwner: false })).toBe(true)
    expect(canDeleteMove({ staffId: 'a' }, false, { id: 'a', isOwner: false })).toBe(false)
    expect(canDeleteMove({ staffId: 'a' }, true, { id: 'b', isOwner: false })).toBe(false)
    expect(canDeleteMove({ staffId: 'a' }, false, { id: 'b', isOwner: true })).toBe(true)
    expect(canDeleteMove({ staffId: 'a' }, true, null)).toBe(false)
  })
})

describe('helpers', () => {
  it('cleanDenominations keeps known notes with positive whole counts', () => {
    expect(cleanDenominations({ '1000': 2, '100': 2.7, '50': -1, '3': 5, abc: 1 })).toEqual({ '1000': 2, '100': 2 })
    expect(cleanDenominations({ '20': 0 })).toBeNull()
    expect(cleanDenominations(null)).toBeNull()
  })

  it('loadCloseDraft falls back to an empty draft without storage', () => {
    expect(loadCloseDraft('x')).toEqual({
      mode: 'count',
      counts: {},
      totalText: '',
      note: '',
      transferChecked: false,
      halfhalfChecked: false,
    })
  })

  it('buildShiftText names the closer of a closed shift', async () => {
    const shift = await open(500)
    await addSale(shift, { items: [mkItem({ name: 'เสื้อยืด', price: 59, qty: 2 })], method: 'cash' })
    const { shift: closed, sales, moves } = await closeShift(
      {
        shiftId: shift.id,
        staffId: 's2',
        countedCash: 618,
        denominations: null,
        seen: { expectedCash: 618, transfer: 0, halfhalf: 0 },
        transferChecked: false,
        halfhalfChecked: false,
        note: '',
      },
      database,
    )
    const names: Record<string, string> = { s1: 'แม่', s2: 'น้องเอ' }
    const text = buildShiftText({
      shop: null,
      boothName: 'แผงเสื้อ',
      staffName: (id) => (id ? (names[id] ?? '?') : '?'),
      shift: closed,
      sales,
      moves,
    })
    expect(text).toContain('แผงเสื้อ')
    expect(text).toContain('โดย น้องเอ')
    expect(text).toContain('ยอดขาย 118 บาท')
    expect(text).toContain('นับได้ 618 → ตรง')
  })
})
