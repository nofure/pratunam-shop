import { describe, expect, it } from 'vitest'
import { computeStock } from '../../domain/stock'
import { mkAdj, mkItem, mkLot, mkSale, mkTier } from '../../domain/test-fixtures'
import {
  avgCostAfter,
  compareNewest,
  compareStockRows,
  countChanges,
  isWholeNumber,
  lotCosts,
  lotTotals,
  margin,
  matchesQuery,
  parseCountDraft,
  piecesFromInput,
  promoText,
  promoUnitPrice,
  qtyText,
  reasonSign,
  shiftMonth,
  stockStatus,
  suggestTargetTier,
  supplierStats,
} from './logic'

describe('piecesFromInput', () => {
  it('passes pieces through and multiplies dozens by 12', () => {
    expect(piecesFromInput(30, false)).toBe(30)
    expect(piecesFromInput(3, true)).toBe(36)
    expect(piecesFromInput(1.5, true)).toBe(18)
  })
  it('rejects empty, zero and negative', () => {
    expect(piecesFromInput(null, false)).toBeNull()
    expect(piecesFromInput(0, true)).toBeNull()
    expect(piecesFromInput(-2, false)).toBeNull()
  })
  it('flags part pieces', () => {
    expect(isWholeNumber(piecesFromInput(1.33, true) as number)).toBe(false)
    expect(isWholeNumber(piecesFromInput(1.25, true) as number)).toBe(true)
  })
})

describe('qtyText', () => {
  it('uses a real minus sign and trims decimals', () => {
    expect(qtyText(-2)).toBe('−2')
    expect(qtyText(1250)).toBe('1,250')
    expect(qtyText(1.5)).toBe('1.5')
    expect(qtyText(0)).toBe('0')
  })
})

describe('lotCosts', () => {
  it('per-piece cost → total', () => {
    expect(lotCosts('unit', 36, 22.5)).toEqual({ unitCost: 22.5, totalCost: 810 })
  })
  it('lot total → per piece, rounded to satang', () => {
    expect(lotCosts('total', 3, 100)).toEqual({ unitCost: 33.33, totalCost: 100 })
  })
  it('needs a quantity and an amount', () => {
    expect(lotCosts('unit', null, 20)).toBeNull()
    expect(lotCosts('total', 0, 20)).toBeNull()
    expect(lotCosts('unit', 10, null)).toBeNull()
    expect(lotCosts('unit', 10, -1)).toBeNull()
  })
})

describe('margin / promo', () => {
  it('profit per piece and % of price', () => {
    expect(margin(39, 20)).toEqual({ profit: 19, pct: 48.7 })
    expect(margin(100, 120)).toEqual({ profit: -20, pct: -20 })
    expect(margin(0, 10).pct).toBeNull()
  })
  it('promo unit price', () => {
    expect(promoUnitPrice({ promoQty: 3, promoPrice: 100 })).toBe(33.33)
    expect(promoUnitPrice({ promoQty: null, promoPrice: null })).toBeNull()
    expect(promoText({ promoQty: 2, promoPrice: 100, unit: 'ตัว' })).toBe('2 ตัว 100')
  })
  it('weighted average after a new lot', () => {
    const lots = [mkLot({ tierId: 't1', qty: 10, unitCost: 20 }), mkLot({ tierId: 't2', qty: 5, unitCost: 99 })]
    expect(avgCostAfter(lots, 't1', 10, 30)).toBe(25)
    expect(avgCostAfter([], 't1', 4, 12.5)).toBe(12.5)
    expect(avgCostAfter([mkLot({ tierId: 't1', qty: 10, unitCost: 20, deleted: 1 })], 't1', 10, 30)).toBe(30)
  })
})

describe('adjustments', () => {
  it('sign by reason', () => {
    expect(reasonSign('damaged', 1)).toBe(-1)
    expect(reasonSign('transfer_out', 1)).toBe(-1)
    expect(reasonSign('transfer_in', -1)).toBe(1)
    expect(reasonSign('other', 1)).toBe(1)
    expect(reasonSign('other', -1)).toBe(-1)
  })
  it('suggests the same name + price in the other booth', () => {
    const a = mkTier({ name: 'เสื้อยืด', price: 39, boothId: 'b2', sort: 2 })
    const b = mkTier({ name: ' เสื้อยืด ', price: 39, boothId: 'b2', sort: 1, active: 0 })
    const c = mkTier({ name: 'เสื้อยืด', price: 59, boothId: 'b2' })
    expect(suggestTargetTier({ name: 'เสื้อยืด', price: 39 }, [c, b, a])?.id).toBe(a.id)
    expect(suggestTargetTier({ name: 'ยีนส์', price: 399 }, [a, b, c])).toBeNull()
  })
})

describe('stock count', () => {
  const t1 = mkTier({ id: 'c1' })
  const t2 = mkTier({ id: 'c2' })
  const t3 = mkTier({ id: 'c3' })
  const stock = computeStock(
    [t1, t2, t3],
    [mkLot({ tierId: 'c1', qty: 10 }), mkLot({ tierId: 'c2', qty: 5 })],
    [],
    [mkSale({ items: [mkItem({ tierId: 'c1', price: 39, qty: 2 })] })],
  )
  it('keeps only entered rows that differ', () => {
    const rows = countChanges(['c1', 'c2', 'c3'], stock, { c1: 7, c2: 5, c3: 0 })
    expect(rows).toEqual([{ tierId: 'c1', onHand: 8, counted: 7, diff: -1 }])
  })
  it('counts stock for a tier with nothing in the system', () => {
    expect(countChanges(['c3'], stock, { c3: 4 })).toEqual([{ tierId: 'c3', onHand: 0, counted: 4, diff: 4 }])
  })
  it('parses drafts defensively', () => {
    expect(parseCountDraft('{"a":3,"b":-1,"c":"x","d":0}')).toEqual({ a: 3, d: 0 })
    expect(parseCountDraft('[1,2]')).toEqual({})
    expect(parseCountDraft('nope')).toEqual({})
    expect(parseCountDraft(null)).toEqual({})
  })
})

describe('on-hand list', () => {
  const low = mkTier({ id: 'l', name: 'ข', lowStock: 5 })
  const ok = mkTier({ id: 'o', name: 'ก', lowStock: 5 })
  const none = mkTier({ id: 'n', name: 'ก' })
  const neg = mkTier({ id: 'g', name: 'ค' })
  const stock = computeStock(
    [low, ok, none, neg],
    [mkLot({ tierId: 'l', qty: 3 }), mkLot({ tierId: 'o', qty: 30 }), mkLot({ tierId: 'g', qty: 1 })],
    [mkAdj({ tierId: 'g', qtyChange: -2 })],
    [mkSale({ items: [mkItem({ tierId: 'n', price: 39, qty: 1 })] })],
  )
  it('classifies status', () => {
    expect(stockStatus(low, stock.get('l'))).toBe('low')
    expect(stockStatus(ok, stock.get('o'))).toBe('ok')
    expect(stockStatus(none, stock.get('n'))).toBe('none')
    expect(stockStatus(neg, stock.get('g'))).toBe('negative')
    expect(stockStatus(ok, undefined)).toBe('none')
  })
  it('sorts attention first then by name', () => {
    const rows = [low, ok, none, neg].map((tier) => ({ tier, status: stockStatus(tier, stock.get(tier.id)) }))
    rows.sort(compareStockRows)
    expect(rows.map((r) => r.tier.id)).toEqual(['l', 'g', 'o', 'n'])
  })
  it('search by name words and price', () => {
    const t = { name: 'เสื้อยืด', price: 39 }
    expect(matchesQuery(t, '')).toBe(true)
    expect(matchesQuery(t, 'เสื้อ')).toBe(true)
    expect(matchesQuery(t, 'เสื้อ 39')).toBe(true)
    expect(matchesQuery(t, '3')).toBe(true)
    expect(matchesQuery(t, '59')).toBe(false)
    expect(matchesQuery(t, 'กางเกง')).toBe(false)
  })
})

describe('lots & suppliers', () => {
  const lots = [
    mkLot({ supplierId: 's1', qty: 10, unitCost: 20, totalCost: 200, dayKey: '2026-09-01' }),
    mkLot({ supplierId: 's1', qty: 12, unitCost: 25, totalCost: 300, dayKey: '2026-09-15' }),
    mkLot({ supplierId: 's2', qty: 6, unitCost: 50, totalCost: 300, dayKey: '2026-08-20' }),
    mkLot({ supplierId: null, qty: 1, unitCost: 10, totalCost: 10 }),
    mkLot({ supplierId: 's2', qty: 99, totalCost: 999, deleted: 1 }),
  ]
  it('totals skip deleted rows', () => {
    expect(lotTotals(lots)).toEqual({ count: 4, qty: 29, cost: 810 })
  })
  it('per supplier', () => {
    const s = supplierStats(lots)
    expect(s.get('s1')).toEqual({ total: 500, count: 2, qty: 22, last: '2026-09-15' })
    expect(s.get('s2')).toEqual({ total: 300, count: 1, qty: 6, last: '2026-08-20' })
  })
  it('month navigation', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
  it('newest first', () => {
    const rows = [
      { dayKey: '2026-09-01', createdAt: 5 },
      { dayKey: '2026-09-02', createdAt: 1 },
      { dayKey: '2026-09-02', createdAt: 3 },
    ]
    rows.sort(compareNewest)
    expect(rows.map((r) => r.createdAt)).toEqual([3, 1, 5])
  })
})
