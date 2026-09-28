import { describe, expect, it } from 'vitest'
import { avgCostByTier, computeStock, isLowStock, type TierStock } from './stock'
import { mkAdj, mkItem, mkLot, mkSale, mkTier } from './test-fixtures'

const tA = mkTier({ id: 'A', price: 39, lowStock: 5 })
const tB = mkTier({ id: 'B', price: 100 })
const tDeleted = mkTier({ id: 'C', deleted: 1 })

const lots = [
  mkLot({ tierId: 'A', qty: 10, unitCost: 30, dayKey: '2026-09-01' }),
  mkLot({ tierId: 'A', qty: 20, unitCost: 36, dayKey: '2026-09-10' }),
  mkLot({ tierId: 'A', qty: 100, unitCost: 1, dayKey: '2026-09-20', deleted: 1 }),
  mkLot({ tierId: 'C', qty: 5, unitCost: 10 }),
]
const adjustments = [
  mkAdj({ tierId: 'A', qtyChange: -2, reason: 'damaged' }),
  mkAdj({ tierId: 'A', qtyChange: 50, deleted: 1 }),
]
const sales = [
  mkSale({ dayKey: '2026-09-15', items: [mkItem({ tierId: 'A', price: 39, qty: 4, promoQty: 3, promoPrice: 100 })] }),
  mkSale({
    dayKey: '2026-09-20',
    items: [mkItem({ tierId: 'A', price: 39, qty: 3 }), mkItem({ tierId: null, name: 'ราคาอื่น', price: 80, qty: 1 })],
  }),
  mkSale({ dayKey: '2026-09-25', status: 'void', items: [mkItem({ tierId: 'A', price: 39, qty: 5 })] }),
  mkSale({ dayKey: '2026-09-26', deleted: 1, items: [mkItem({ tierId: 'A', price: 39, qty: 5 })] }),
]

describe('avgCostByTier', () => {
  it('is the weighted average over non-deleted lots', () => {
    const m = avgCostByTier(lots)
    expect(m.get('A')).toBe(34) // (10×30 + 20×36) / 30
    expect(m.get('C')).toBe(10)
    expect(m.has('B')).toBe(false)
  })

  it('ignores lots with no quantity and rounds', () => {
    const m = avgCostByTier([
      mkLot({ tierId: 'X', qty: 0, unitCost: 999 }),
      mkLot({ tierId: 'X', qty: 3, unitCost: 10 }),
      mkLot({ tierId: 'X', qty: 1, unitCost: 11 }),
      mkLot({ tierId: 'Y', qty: 3, unitCost: 33.33 }),
      mkLot({ tierId: 'Y', qty: 1, unitCost: 10 }),
    ])
    expect(m.get('X')).toBe(10.25)
    expect(m.get('Y')).toBe(27.5) // (99.99 + 10) / 4 = 27.4975
  })
})

describe('computeStock', () => {
  const stock = computeStock([tA, tB, tDeleted], lots, adjustments, sales)

  it('computes received, adjusted, sold, on hand, cost and value', () => {
    expect(stock.get('A')).toEqual<TierStock>({
      tierId: 'A',
      received: 30,
      sold: 7,
      adjusted: -2,
      onHand: 21,
      avgCost: 34,
      stockValue: 714,
      lastReceived: '2026-09-10',
      lastSold: '2026-09-20',
    })
  })

  it('gives tiers without activity an empty entry', () => {
    expect(stock.get('B')).toEqual<TierStock>({
      tierId: 'B',
      received: 0,
      sold: 0,
      adjusted: 0,
      onHand: 0,
      avgCost: null,
      stockValue: null,
      lastReceived: null,
      lastSold: null,
    })
  })

  it('skips deleted tiers', () => {
    expect(stock.has('C')).toBe(false)
    expect(stock.size).toBe(2)
  })

  it('negative stock with a known cost has value 0', () => {
    const s = computeStock(
      [tA],
      [mkLot({ tierId: 'A', qty: 2, unitCost: 30 })],
      [],
      [mkSale({ items: [mkItem({ tierId: 'A', price: 39, qty: 5 })] })],
    )
    expect(s.get('A')!.onHand).toBe(-3)
    expect(s.get('A')!.stockValue).toBe(0)
  })

  it('stock count adjustments set on hand', () => {
    const s = computeStock([tB], [mkLot({ tierId: 'B', qty: 10, unitCost: 50 })], [mkAdj({ tierId: 'B', qtyChange: -3, reason: 'count', countedQty: 7 })], [])
    expect(s.get('B')!.onHand).toBe(7)
    expect(s.get('B')!.stockValue).toBe(350)
  })
})

describe('isLowStock', () => {
  const stock = computeStock([tA, tB], lots, adjustments, sales)
  it('flags tracked tiers at or below the alert level', () => {
    expect(isLowStock(tA, stock.get('A'))).toBe(false) // 21 > 5
    expect(isLowStock({ ...tA, lowStock: 21 }, stock.get('A'))).toBe(true)
    expect(isLowStock({ ...tA, lowStock: 25 }, stock.get('A'))).toBe(true)
  })
  it('does not flag untracked, unset or unknown stock', () => {
    expect(isLowStock({ ...tA, lowStock: 25, trackStock: 0 }, stock.get('A'))).toBe(false)
    expect(isLowStock({ ...tA, lowStock: null }, stock.get('A'))).toBe(false)
    expect(isLowStock({ ...tA, lowStock: 25 }, undefined)).toBe(false)
  })
  it('zero stock with alert 0 is low', () => {
    expect(isLowStock({ ...tB, lowStock: 0 }, stock.get('B'))).toBe(true)
  })
})
