import { describe, expect, it } from 'vitest'
import { cashDiffText, cashDiffTone, computeShiftTotals, denominationTotal, nextBillNo, topItems } from './shift'
import { mkItem, mkMove, mkSale } from './test-fixtures'

describe('computeShiftTotals', () => {
  const sales = [
    // 39 × 4 with 3-for-100 → 139 (promo 17)
    mkSale({ method: 'cash', items: [mkItem({ tierId: 't39', price: 39, qty: 4, promoQty: 3, promoPrice: 100 })] }),
    mkSale({ method: 'transfer', items: [mkItem({ tierId: 't100', price: 100, qty: 2 })] }),
    mkSale({ method: 'halfhalf', manualDiscount: 20, items: [mkItem({ tierId: 't259', price: 259, qty: 1 })] }),
    mkSale({ method: 'other', items: [mkItem({ tierId: 't59', price: 59, qty: 1 })] }),
    mkSale({ method: 'cash', status: 'void', items: [mkItem({ tierId: 't59', price: 59, qty: 1 })] }),
    mkSale({ method: 'cash', deleted: 1, items: [mkItem({ tierId: 't100', price: 100, qty: 10 })] }),
    mkSale({ method: 'cash', status: 'void', deleted: 1, items: [mkItem({ tierId: 't100', price: 100, qty: 1 })] }),
  ]
  const moves = [
    mkMove({ type: 'in', amount: 100, reason: 'เติมเงินทอน' }),
    mkMove({ type: 'out', amount: 50, reason: 'ค่าข้าว', category: 'food' }),
    mkMove({ type: 'out', amount: 300, reason: 'เจ้าของเก็บเงิน', category: null }),
    mkMove({ type: 'out', amount: 999, deleted: 1 }),
  ]

  it('counts paid bills, methods, discounts and voids', () => {
    const t = computeShiftTotals(500, sales, moves)
    expect(t.bills).toBe(4)
    expect(t.pieces).toBe(8)
    expect(t.byMethod).toEqual({ cash: 139, transfer: 200, halfhalf: 239, other: 59 })
    expect(t.total).toBe(637)
    expect(t.promoDiscount).toBe(17)
    expect(t.manualDiscount).toBe(20)
    expect(t.voidBills).toBe(1)
    expect(t.voidTotal).toBe(59)
    expect(t.cashIn).toBe(100)
    expect(t.cashOut).toBe(350)
  })

  it('expected cash = float + cash sales + in − out', () => {
    const t = computeShiftTotals(500, sales, moves)
    expect(t.expectedCash).toBe(500 + 139 + 100 - 350)
  })

  it('empty shift = opening float', () => {
    const t = computeShiftTotals(1000, [], [])
    expect(t.bills).toBe(0)
    expect(t.total).toBe(0)
    expect(t.expectedCash).toBe(1000)
    expect(t.byMethod).toEqual({ cash: 0, transfer: 0, halfhalf: 0, other: 0 })
  })

  it('rounds float noise', () => {
    const s = [0.1, 0.2].map((p) => mkSale({ items: [mkItem({ price: p, qty: 1 })] }))
    const t = computeShiftTotals(0, s, [])
    expect(t.total).toBe(0.3)
    expect(t.expectedCash).toBe(0.3)
  })
})

describe('denominationTotal', () => {
  it('sums notes and coins', () => {
    expect(denominationTotal({ '1000': 2, '500': 1, '100': 5, '20': 3, '1': 4 })).toBe(3064)
  })
  it('ignores invalid entries', () => {
    expect(denominationTotal({ '100': -1, abc: 3, '50': Number.NaN, '20': 2 })).toBe(40)
    expect(denominationTotal({})).toBe(0)
  })
})

describe('nextBillNo', () => {
  it('starts at 1', () => {
    expect(nextBillNo([])).toBe(1)
  })
  it('continues after the highest number, including voided bills', () => {
    expect(nextBillNo([mkSale({ billNo: 3 }), mkSale({ billNo: 7, status: 'void' }), mkSale({ billNo: 5 })])).toBe(8)
  })
})

describe('cashDiffTone / cashDiffText', () => {
  it('classifies differences', () => {
    expect(cashDiffTone(0)).toBe('ok')
    expect(cashDiffTone(0.001)).toBe('ok')
    expect(cashDiffTone(-20)).toBe('short')
    expect(cashDiffTone(15)).toBe('over')
  })
  it('says ตรง / ขาด / เกิน', () => {
    expect(cashDiffText(0)).toBe('ตรง')
    expect(cashDiffText(-20)).toBe('ขาด 20')
    expect(cashDiffText(1500)).toBe('เกิน 1,500')
  })
})

describe('topItems', () => {
  const sales = [
    mkSale({
      createdAt: 1,
      items: [
        mkItem({ tierId: 't39', name: 'เสื้อยืด', price: 39, qty: 4, promoQty: 3, promoPrice: 100 }),
        mkItem({ tierId: null, name: 'ราคาอื่น', price: 250, qty: 1 }),
      ],
    }),
    mkSale({
      createdAt: 2,
      items: [
        mkItem({ tierId: 't39', name: 'เสื้อยืดใหม่', price: 39, qty: 2, promoQty: 3, promoPrice: 100 }),
        mkItem({ tierId: 't100', name: 'ขาสั้น', price: 100, qty: 2 }),
        mkItem({ tierId: null, name: 'ราคาอื่น', price: 250, qty: 1 }),
        mkItem({ tierId: null, name: 'ราคาอื่น', price: 80, qty: 2 }),
      ],
    }),
    mkSale({ status: 'void', items: [mkItem({ tierId: 't100', price: 100, qty: 50 })] }),
    mkSale({ deleted: 1, items: [mkItem({ tierId: 't100', price: 100, qty: 50 })] }),
  ]

  it('groups by tier and custom name+price, paid only, sorted by qty then total', () => {
    const top = topItems(sales)
    expect(top.map((r) => [r.tierId, r.price, r.qty, r.total])).toEqual([
      ['t39', 39, 6, 217],
      // tie on qty 2 → higher total first
      [null, 250, 2, 500],
      ['t100', 100, 2, 200],
      [null, 80, 2, 160],
    ])
    expect(top[0].name).toBe('เสื้อยืดใหม่') // latest name wins
  })

  it('respects the limit', () => {
    expect(topItems(sales, 2)).toHaveLength(2)
    expect(topItems(sales, 0)).toHaveLength(0)
    expect(topItems([], 3)).toEqual([])
  })
})
