import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, save } from '../../db'
import { customLine, lineFromTier, type CartLine } from '../../domain/pricing'
import type { Sale, Shift, Tier } from '../../types'
import { parseCart } from './cartStore'
import { PosError, recordSale, voidSale } from './saleService'
import { itemsSummary, promoText, roundDownDiscount } from './util'

function tier(over: Partial<Tier> = {}): Tier {
  return {
    id: 't39',
    createdAt: 0,
    updatedAt: 0,
    deviceId: 'd',
    deleted: 0,
    synced: 0,
    boothId: 'b1',
    name: 'เสื้อยืด',
    price: 39,
    promoQty: 3,
    promoPrice: 100,
    unit: 'ตัว',
    color: 'yellow',
    sort: 0,
    active: 1,
    trackStock: 0,
    lowStock: null,
    ...over,
  }
}

function withQty(l: CartLine, qty: number): CartLine {
  return { ...l, qty }
}

async function openShift(over: Partial<Shift> = {}): Promise<Shift> {
  return save<Shift>(db.shifts, {
    boothId: 'b1',
    staffId: 's1',
    dayKey: '2026-09-28',
    openedAt: Date.now() - 1000,
    openingFloat: 500,
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
    ...over,
  })
}

describe('util', () => {
  it('rounds down to the lower multiple of 10', () => {
    expect(roundDownDiscount(139)).toBe(9)
    expect(roundDownDiscount(130)).toBe(0)
    expect(roundDownDiscount(9)).toBe(0)
    expect(roundDownDiscount(1005)).toBe(5)
    expect(roundDownDiscount(25.5)).toBe(5.5)
  })

  it('formats promos and item summaries', () => {
    expect(promoText(3, 100, 'ตัว')).toBe('3 ตัว 100')
    expect(promoText(null, null, 'ตัว')).toBe('')
    expect(promoText(1, 100, 'ตัว')).toBe('')
    const items = [
      { tierId: 't', name: 'เสื้อยืด', unit: 'ตัว', price: 39, qty: 4, promoQty: 3, promoPrice: 100, fullTotal: 156, lineTotal: 139 },
      { tierId: null, name: 'อื่นๆ', unit: 'ชิ้น', price: 250, qty: 1, promoQty: null, promoPrice: null, fullTotal: 250, lineTotal: 250 },
    ]
    expect(itemsSummary(items)).toBe('เสื้อยืด 39 ×4, อื่นๆ 250 ×1')
  })
})

describe('parseCart', () => {
  const line = withQty(lineFromTier(tier()), 2)

  it('restores a valid cart', () => {
    const raw = JSON.stringify({ lines: [line], discount: 9, at: Date.now() })
    expect(parseCart(raw)).toEqual({ lines: [line], discount: 9 })
  })

  it('drops malformed lines, duplicates and bad discounts', () => {
    const raw = JSON.stringify({
      lines: [line, line, { ...line, key: 'x', qty: 0 }, { ...line, key: 'y', price: 'a' }, null],
      discount: -5,
      at: Date.now(),
    })
    expect(parseCart(raw)).toEqual({ lines: [line], discount: 0 })
  })

  it('forgets old or broken carts', () => {
    const old = JSON.stringify({ lines: [line], discount: 0, at: Date.now() - 13 * 3600_000 })
    expect(parseCart(old).lines).toEqual([])
    expect(parseCart('{nope').lines).toEqual([])
    expect(parseCart(null).lines).toEqual([])
  })
})

describe('recordSale / voidSale', () => {
  beforeEach(async () => {
    await Promise.all([db.sales.clear(), db.shifts.clear()])
  })

  it('refuses to sell without an open shift', async () => {
    await expect(
      recordSale({ boothId: 'b1', staffId: 's1', lines: [lineFromTier(tier())], manualDiscount: 0, method: 'cash', cashReceived: null }),
    ).rejects.toMatchObject({ code: 'no-shift' })
    expect(await db.sales.count()).toBe(0)
  })

  it('records a bill into the open shift with running numbers', async () => {
    const shift = await openShift()
    const lines = [withQty(lineFromTier(tier()), 4), customLine('อื่นๆ', 50)]
    const a = await recordSale({ boothId: 'b1', staffId: 's2', lines, manualDiscount: 9, method: 'cash', cashReceived: 500 })
    expect(a).toMatchObject({
      shiftId: shift.id,
      dayKey: '2026-09-28',
      boothId: 'b1',
      staffId: 's2',
      billNo: 1,
      pieces: 5,
      subtotal: 206,
      promoDiscount: 17,
      manualDiscount: 9,
      total: 180,
      method: 'cash',
      cashReceived: 500,
      change: 320,
      status: 'paid',
      voidReason: null,
      synced: 0,
    })
    const b = await recordSale({ boothId: 'b1', staffId: 's2', lines: [lineFromTier(tier())], manualDiscount: 0, method: 'transfer', cashReceived: 999 })
    expect(b.billNo).toBe(2)
    expect(b.cashReceived).toBeNull()
    expect(b.change).toBeNull()
    const exact = await recordSale({ boothId: 'b1', staffId: 's2', lines: [lineFromTier(tier())], manualDiscount: 0, method: 'cash', cashReceived: null })
    expect(exact).toMatchObject({ billNo: 3, cashReceived: 39, change: 0 })
  })

  it('never reuses a number of a deleted bill', async () => {
    const shift = await openShift()
    const first = await recordSale({ boothId: 'b1', staffId: 's1', lines: [lineFromTier(tier())], manualDiscount: 0, method: 'cash', cashReceived: null })
    await db.sales.update(first.id, { deleted: 1 })
    const next = await recordSale({ boothId: 'b1', staffId: 's1', lines: [lineFromTier(tier())], manualDiscount: 0, method: 'cash', cashReceived: null })
    expect(next.billNo).toBe(2)
    expect(next.shiftId).toBe(shift.id)
  })

  it('rejects short cash and empty carts', async () => {
    await openShift()
    await expect(
      recordSale({ boothId: 'b1', staffId: 's1', lines: [lineFromTier(tier())], manualDiscount: 0, method: 'cash', cashReceived: 20 }),
    ).rejects.toBeInstanceOf(PosError)
    await expect(
      recordSale({ boothId: 'b1', staffId: 's1', lines: [], manualDiscount: 0, method: 'cash', cashReceived: null }),
    ).rejects.toMatchObject({ code: 'empty' })
    expect(await db.sales.count()).toBe(0)
  })

  it('voids a paid bill once', async () => {
    await openShift()
    const sale = await recordSale({ boothId: 'b1', staffId: 's1', lines: [lineFromTier(tier())], manualDiscount: 0, method: 'cash', cashReceived: null })
    const v = await voidSale(sale.id, 'กดผิด', 'owner1')
    expect(v).toMatchObject({ status: 'void', voidReason: 'กดผิด', voidedBy: 'owner1', total: 39, billNo: 1 })
    expect(typeof v.voidedAt).toBe('number')
    const stored = (await db.sales.get(sale.id)) as Sale
    expect(stored.status).toBe('void')
    await expect(voidSale(sale.id, 'กดผิด', 'owner1')).rejects.toMatchObject({ code: 'not-paid' })
    await expect(voidSale('missing', 'กดผิด', 'owner1')).rejects.toMatchObject({ code: 'not-found' })
  })
})
