import { describe, expect, it } from 'vitest'
import { allocateSaleNet, buildReport, lowStockList, slowMovers, type ReportInput } from './reports'
import { computeStock } from './stock'
import { round2 } from '../lib/format'
import {
  mkAdj,
  mkBooth,
  mkExpense,
  mkItem,
  mkLot,
  mkMove,
  mkSale,
  mkShift,
  mkStaff,
  mkTier,
} from './test-fixtures'

const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m).getTime()

const b1 = mkBooth({ id: 'b1', name: 'แผงเสื้อยืด', sort: 1 })
const b2 = mkBooth({ id: 'b2', name: 'แผงกางเกง', sort: 2 })
const b3 = mkBooth({ id: 'b3', name: 'แผงปิด', sort: 3, active: 0 })
const s1 = mkStaff({ id: 's1', name: 'น้อย' })
const s2 = mkStaff({ id: 's2', name: 'แดง' })
const t39 = mkTier({ id: 't39', boothId: 'b1', name: 'เสื้อยืด', price: 39, promoQty: 3, promoPrice: 100 })
const t100 = mkTier({ id: 't100', boothId: 'b2', name: 'ขาสั้น', price: 100, unit: 'ตัว' })

const S1 = mkSale({
  id: 'S1',
  boothId: 'b1',
  staffId: 's1',
  dayKey: '2026-09-01',
  createdAt: at(1, 10, 30),
  method: 'cash',
  manualDiscount: 9,
  items: [
    mkItem({ tierId: 't39', name: 'เสื้อยืด', price: 39, qty: 4, promoQty: 3, promoPrice: 100 }), // 139
    mkItem({ tierId: null, name: 'ราคาอื่น', price: 50, qty: 1 }),
  ],
})
const S2 = mkSale({
  id: 'S2',
  boothId: 'b2',
  staffId: 's2',
  dayKey: '2026-09-03',
  createdAt: at(3, 14, 5),
  method: 'transfer',
  items: [mkItem({ tierId: 't100', name: 'ขาสั้น', price: 100, qty: 2 })],
})
const S3void = mkSale({
  id: 'S3',
  boothId: 'b1',
  dayKey: '2026-09-02',
  createdAt: at(2, 11),
  status: 'void',
  voidReason: 'กดผิด',
  items: [mkItem({ tierId: 't39', price: 59, qty: 1 })],
})
const S4deleted = mkSale({ id: 'S4', boothId: 'b1', dayKey: '2026-09-02', deleted: 1, items: [mkItem({ price: 1000, qty: 1 })] })
const S5outside = mkSale({ id: 'S5', boothId: 'b1', dayKey: '2026-09-05', items: [mkItem({ tierId: 't39', price: 39, qty: 1 })] })
const S6 = mkSale({
  id: 'S6',
  boothId: 'b1',
  staffId: 's1',
  dayKey: '2026-09-02',
  createdAt: at(2, 10, 15),
  method: 'halfhalf',
  manualDiscount: 1,
  items: [mkItem({ tierId: 't39', name: 'เสื้อยืด', price: 39, qty: 3, promoQty: 3, promoPrice: 100 })], // 100 − 1
})

const base: ReportInput = {
  from: '2026-09-01',
  to: '2026-09-04',
  boothId: null,
  sales: [S1, S2, S3void, S4deleted, S5outside, S6],
  shifts: [
    mkShift({ id: 'sh1', boothId: 'b1', staffId: 's1', dayKey: '2026-09-01', status: 'closed', closedBy: 's2', closedAt: at(1, 20), cashDiff: -20 }),
    mkShift({ id: 'sh2', boothId: 'b2', staffId: 's2', dayKey: '2026-09-03', status: 'closed', closedBy: null, closedAt: at(3, 20), cashDiff: 0 }),
    mkShift({ id: 'sh3', boothId: 'b1', staffId: 's1', dayKey: '2026-09-04', status: 'open', openedAt: at(4, 9) }),
    mkShift({ id: 'sh4', boothId: 'b1', staffId: 's1', dayKey: '2026-09-02', status: 'closed', closedAt: at(2, 20), cashDiff: 100, deleted: 1 }),
    mkShift({ id: 'sh5', boothId: 'b2', staffId: 's2', dayKey: '2026-08-31', status: 'closed', closedAt: at(31, 20), cashDiff: 55 }),
  ],
  cashMoves: [
    mkMove({ boothId: 'b1', dayKey: '2026-09-01', type: 'out', amount: 40, category: 'food' }),
    mkMove({ boothId: 'b1', dayKey: '2026-09-01', type: 'out', amount: 500, category: null }),
    mkMove({ boothId: 'b1', dayKey: '2026-09-01', type: 'in', amount: 100, category: null }),
    mkMove({ boothId: 'b2', dayKey: '2026-09-03', type: 'out', amount: 30, category: 'travel' }),
    mkMove({ boothId: 'b2', dayKey: '2026-09-03', type: 'out', amount: 70, category: 'travel', deleted: 1 }),
  ],
  expenses: [
    mkExpense({ boothId: null, dayKey: '2026-09-01', category: 'rent', amount: 1000 }),
    mkExpense({ boothId: 'b1', dayKey: '2026-09-02', category: 'food', amount: 50 }),
    mkExpense({ boothId: 'b1', dayKey: '2026-09-02', category: 'food', amount: 999, deleted: 1 }),
    mkExpense({ boothId: 'b1', dayKey: '2026-09-10', category: 'wage', amount: 400 }),
  ],
  lots: [
    mkLot({ tierId: 't39', boothId: 'b1', dayKey: '2026-09-02', qty: 10, unitCost: 20 }),
    mkLot({ tierId: 't39', boothId: 'b1', dayKey: '2026-08-15', qty: 10, unitCost: 30 }), // outside range, still in avg
  ],
  adjustments: [],
  tiers: [t39, t100],
  booths: [b1, b2, b3],
  staff: [s1, s2],
}

describe('allocateSaleNet', () => {
  it('takes the manual discount off proportionally', () => {
    expect(allocateSaleNet(S1)).toEqual([132.38, 47.62])
  })
  it('puts rounding on the largest line so shares add up to the total', () => {
    const sale = mkSale({
      manualDiscount: 10,
      items: [mkItem({ price: 10, qty: 1 }), mkItem({ price: 10, qty: 1 }), mkItem({ price: 10, qty: 1 })],
    })
    const nets = allocateSaleNet(sale)
    expect(round2(nets.reduce((a, b) => a + b, 0))).toBe(20)
    expect(nets).toEqual([6.66, 6.67, 6.67])
  })
  it('no discount → line totals', () => {
    expect(allocateSaleNet(S2)).toEqual([200])
    expect(allocateSaleNet(mkSale({ items: [] }))).toEqual([])
  })
})

describe('buildReport — all booths', () => {
  const r = buildReport(base)

  it('totals', () => {
    expect(r.days).toBe(4)
    expect(r.totals).toEqual({
      sales: 479,
      bills: 3,
      pieces: 10,
      avgBill: 159.67,
      promoDiscount: 34,
      manualDiscount: 10,
      voidBills: 1,
      voidTotal: 59,
    })
    expect(r.byMethod).toEqual({ cash: 180, transfer: 200, halfhalf: 99, other: 0 })
  })

  it('byBooth lists active booths with activity first, inactive booths without activity are left out', () => {
    expect(r.byBooth).toEqual([
      { boothId: 'b1', name: 'แผงเสื้อยืด', sales: 279, bills: 2, pieces: 8 },
      { boothId: 'b2', name: 'แผงกางเกง', sales: 200, bills: 1, pieces: 2 },
    ])
  })

  it('byTier sales are net of manual discount and add up to total sales', () => {
    const sum = round2(r.byTier.reduce((a, t) => a + t.sales, 0))
    expect(sum).toBe(r.totals.sales)
    const row39 = r.byTier.find((t) => t.tierId === 't39')!
    expect(row39).toMatchObject({ boothId: 'b1', boothName: 'แผงเสื้อยืด', name: 'เสื้อยืด', price: 39, qty: 7, sales: 231.38 })
    // avg cost over ALL lots = (10×20 + 10×30) / 20 = 25
    expect(row39.cogs).toBe(175)
    expect(row39.profit).toBe(56.38)
    const custom = r.byTier.find((t) => t.tierId === null)!
    expect(custom).toMatchObject({ name: 'ราคาอื่น', price: 50, qty: 1, sales: 47.62, cogs: null, profit: null })
    const row100 = r.byTier.find((t) => t.tierId === 't100')!
    expect(row100).toMatchObject({ boothId: 'b2', qty: 2, sales: 200, cogs: null })
    expect(r.byTier.map((t) => t.sales)).toEqual([231.38, 200, 47.62]) // sorted by sales
  })

  it('cost of goods and profit', () => {
    expect(r.knownCostSales).toBe(231.38)
    expect(r.cogs).toBe(175)
    expect(r.grossProfit).toBe(56.38)
    expect(r.cogsUnknownSales).toBe(247.62)
    expect(round2(r.knownCostSales + r.cogsUnknownSales)).toBe(r.totals.sales)
  })

  it('byCategory groups by name', () => {
    expect(r.byCategory).toEqual([
      { name: 'เสื้อยืด', qty: 7, sales: 231.38 },
      { name: 'ขาสั้น', qty: 2, sales: 200 },
      { name: 'ราคาอื่น', qty: 1, sales: 47.62 },
    ])
  })

  it('byHour uses local hour of the bill', () => {
    expect(r.byHour).toHaveLength(24)
    expect(r.byHour[10]).toBe(279)
    expect(r.byHour[14]).toBe(200)
    expect(round2(r.byHour.reduce((a, b) => a + b, 0))).toBe(479)
  })

  it('byDay has every day, zeros included', () => {
    expect(r.byDay).toEqual([
      { dayKey: '2026-09-01', sales: 180, bills: 1 },
      { dayKey: '2026-09-02', sales: 99, bills: 1 },
      { dayKey: '2026-09-03', sales: 200, bills: 1 },
      { dayKey: '2026-09-04', sales: 0, bills: 0 },
    ])
  })

  it('expenses = expense records + categorised cash-outs', () => {
    expect(r.expenses.total).toBe(1000 + 50 + 40 + 30)
    expect(r.expenses.fromDrawer).toBe(70)
    expect(r.expenses.byCategory).toEqual({ rent: 1000, electric: 0, wage: 0, supplies: 0, travel: 30, food: 90, other: 0 })
    expect(r.netProfit).toBe(round2(56.38 - 1120))
  })

  it('cash differences, staff and open shifts', () => {
    expect(r.cashDiffs).toEqual([
      { shiftId: 'sh1', dayKey: '2026-09-01', boothId: 'b1', boothName: 'แผงเสื้อยืด', staffId: 's2', staffName: 'แดง', diff: -20 },
    ])
    expect(r.byStaff).toEqual([
      { staffId: 's1', name: 'น้อย', sales: 279, bills: 2, shiftsClosed: 0, cashDiffTotal: 0 },
      { staffId: 's2', name: 'แดง', sales: 200, bills: 1, shiftsClosed: 2, cashDiffTotal: -20 },
    ])
    expect(r.openShifts.map((s) => s.shiftId)).toEqual(['sh3'])
  })

  it('voids and goods received', () => {
    expect(r.voids.map((s) => s.id)).toEqual(['S3'])
    expect(r.stockIn).toEqual({ lots: 1, qty: 10, cost: 200 })
  })
})

describe('buildReport — booth filter', () => {
  it('b1: own sales, own + drawer expenses, no whole-shop expenses', () => {
    const r = buildReport({ ...base, boothId: 'b1' })
    expect(r.totals.sales).toBe(279)
    expect(r.totals.bills).toBe(2)
    expect(r.byBooth).toEqual([{ boothId: 'b1', name: 'แผงเสื้อยืด', sales: 279, bills: 2, pieces: 8 }])
    expect(r.expenses.total).toBe(50 + 40)
    expect(r.expenses.fromDrawer).toBe(40)
    expect(r.expenses.byCategory.rent).toBe(0)
    expect(r.cashDiffs).toHaveLength(1)
    expect(r.voids).toHaveLength(1)
    expect(round2(r.byTier.reduce((a, t) => a + t.sales, 0))).toBe(279)
    // COGS still uses all lots of the tier
    expect(r.cogs).toBe(175)
  })

  it('b2: nothing from b1', () => {
    const r = buildReport({ ...base, boothId: 'b2' })
    expect(r.totals.sales).toBe(200)
    expect(r.byBooth.map((b) => b.boothId)).toEqual(['b2'])
    expect(r.expenses.total).toBe(30)
    expect(r.cashDiffs).toEqual([])
    expect(r.voids).toEqual([])
    expect(r.openShifts).toEqual([])
    expect(r.stockIn.lots).toBe(0)
  })
})

describe('buildReport — edge cases', () => {
  it('empty range still lists active booths and every day', () => {
    const r = buildReport({ ...base, from: '2026-10-01', to: '2026-10-03' })
    expect(r.totals.sales).toBe(0)
    expect(r.totals.avgBill).toBe(0)
    expect(r.byBooth.map((b) => [b.boothId, b.sales])).toEqual([
      ['b1', 0],
      ['b2', 0],
    ])
    expect(r.byDay.map((d) => d.sales)).toEqual([0, 0, 0])
    expect(r.byTier).toEqual([])
    expect(r.netProfit).toBe(0)
  })

  it('shows sales of a booth that is no longer active', () => {
    const r = buildReport({ ...base, sales: [mkSale({ boothId: 'b3', dayKey: '2026-09-02', items: [mkItem({ price: 10, qty: 1 })] })] })
    expect(r.byBooth.find((b) => b.boothId === 'b3')).toMatchObject({ name: 'แผงปิด', sales: 10 })
  })

  it('Σ byTier.sales == totals.sales for many random bills', () => {
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const sales = Array.from({ length: 300 }, (_, i) => {
      const items = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => {
        const price = [39, 59, 100, 129, 139, 259, 399][Math.floor(rand() * 7)]
        const promo = price === 39 ? { promoQty: 3, promoPrice: 100 } : price === 59 ? { promoQty: 2, promoPrice: 100 } : {}
        return mkItem({ tierId: rand() < 0.8 ? `t${price}` : null, name: `n${price}`, price, qty: 1 + Math.floor(rand() * 5), ...promo })
      })
      const lines = items.reduce((a, it) => a + it.lineTotal, 0)
      return mkSale({
        dayKey: `2026-09-0${1 + (i % 4)}`,
        boothId: rand() < 0.5 ? 'b1' : 'b2',
        manualDiscount: Math.min(lines, Math.floor(rand() * 37)),
        items,
      })
    })
    const r = buildReport({ ...base, sales })
    expect(round2(r.byTier.reduce((a, t) => a + t.sales, 0))).toBe(r.totals.sales)
    expect(round2(r.byCategory.reduce((a, t) => a + t.sales, 0))).toBe(r.totals.sales)
    expect(round2(r.byBooth.reduce((a, t) => a + t.sales, 0))).toBe(r.totals.sales)
    expect(round2(r.byDay.reduce((a, t) => a + t.sales, 0))).toBe(r.totals.sales)
    for (const s of sales) {
      expect(round2(allocateSaleNet(s).reduce((a, b) => a + b, 0))).toBe(round2(s.total))
    }
  })

  it('reversed range is empty', () => {
    const r = buildReport({ ...base, from: '2026-09-04', to: '2026-09-01' })
    expect(r.days).toBe(0)
    expect(r.byDay).toEqual([])
    expect(r.totals.bills).toBe(0)
  })
})

describe('slowMovers / lowStockList', () => {
  const tiers = [
    mkTier({ id: 'old', name: 'เก่า', sort: 1, lowStock: 3 }),
    mkTier({ id: 'recent', name: 'ขายอยู่', sort: 2, lowStock: 3 }),
    mkTier({ id: 'never', name: 'ไม่เคยขาย', sort: 3 }),
    mkTier({ id: 'untracked', name: 'ไม่นับ', sort: 4, trackStock: 0 }),
    mkTier({ id: 'empty', name: 'หมด', sort: 5, lowStock: 2 }),
    mkTier({ id: 'inactive', name: 'เลิกขาย', sort: 6, lowStock: 50, active: 0 }),
  ]
  const lots = [
    mkLot({ tierId: 'old', qty: 5 }),
    mkLot({ tierId: 'recent', qty: 2 }),
    mkLot({ tierId: 'never', qty: 12 }),
    mkLot({ tierId: 'untracked', qty: 30 }),
    mkLot({ tierId: 'empty', qty: 1 }),
    mkLot({ tierId: 'inactive', qty: 4 }),
  ]
  const sales = [
    mkSale({ dayKey: '2026-08-20', items: [mkItem({ tierId: 'old', price: 39, qty: 1 })] }),
    mkSale({ dayKey: '2026-09-20', items: [mkItem({ tierId: 'recent', price: 39, qty: 1 })] }),
    mkSale({ dayKey: '2026-09-20', items: [mkItem({ tierId: 'empty', price: 39, qty: 1 })] }),
  ]
  const stock = computeStock(tiers, lots, [], sales)

  it('slowMovers: stock on hand and no sale in the last N days, most stock first', () => {
    const s = slowMovers(tiers, stock, '2026-09-29', 30)
    expect(s.map((x) => [x.tier.id, x.daysSinceLastSale])).toEqual([
      ['never', null],
      ['inactive', null],
      ['old', 40],
    ])
    expect(slowMovers(tiers, stock, '2026-09-29', 41).map((x) => x.tier.id)).toEqual(['never', 'inactive'])
    expect(slowMovers(tiers, stock, '2026-09-29', 5).map((x) => x.tier.id)).toEqual(['never', 'inactive', 'old', 'recent'])
  })

  it('lowStockList: active tiers at or below alert, lowest first', () => {
    expect(lowStockList(tiers, stock).map((x) => [x.tier.id, x.stock.onHand])).toEqual([
      ['empty', 0],
      ['recent', 1],
    ])
  })

  it('lowStockList: a tier whose stock was never recorded is not flagged, even after sales', () => {
    const fresh = [mkTier({ id: 'new', name: 'ปุ่มใหม่', lowStock: 5 }), mkTier({ id: 'counted', name: 'นับแล้ว', lowStock: 5 })]
    const sold = [mkSale({ dayKey: '2026-09-29', items: [mkItem({ tierId: 'new', price: 39, qty: 3 }), mkItem({ tierId: 'counted', price: 39, qty: 1 })] })]
    const adj = [mkAdj({ tierId: 'counted', qtyChange: 3, reason: 'count', countedQty: 2 })]
    const st = computeStock(fresh, [], adj, sold)
    expect(st.get('new')?.onHand).toBe(-3)
    expect(lowStockList(fresh, st).map((x) => [x.tier.id, x.stock.onHand])).toEqual([['counted', 2]])
  })
})
