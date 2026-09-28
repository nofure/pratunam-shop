import { describe, expect, it } from 'vitest'
import {
  addLine,
  cashChange,
  computeCart,
  customLine,
  lineFromTier,
  promoLineTotal,
  quickCashOptions,
  setLineQty,
  type CartLine,
} from './pricing'
import { mkTier } from './test-fixtures'

describe('promoLineTotal', () => {
  it('applies "39 · 3 ตัว 100"', () => {
    expect(promoLineTotal(39, 1, 3, 100)).toBe(39)
    expect(promoLineTotal(39, 2, 3, 100)).toBe(78)
    expect(promoLineTotal(39, 3, 3, 100)).toBe(100)
    expect(promoLineTotal(39, 4, 3, 100)).toBe(139)
    expect(promoLineTotal(39, 5, 3, 100)).toBe(178)
    expect(promoLineTotal(39, 6, 3, 100)).toBe(200)
    expect(promoLineTotal(39, 7, 3, 100)).toBe(239)
  })

  it('applies "59 · 2 ตัว 100"', () => {
    expect(promoLineTotal(59, 1, 2, 100)).toBe(59)
    expect(promoLineTotal(59, 2, 2, 100)).toBe(100)
    expect(promoLineTotal(59, 3, 2, 100)).toBe(159)
    expect(promoLineTotal(59, 4, 2, 100)).toBe(200)
  })

  it('uses the plain price without a usable promo', () => {
    expect(promoLineTotal(100, 3, null, null)).toBe(300)
    expect(promoLineTotal(100, 3, 3, null)).toBe(300)
    expect(promoLineTotal(100, 3, null, 250)).toBe(300)
    expect(promoLineTotal(100, 3, 1, 50)).toBe(300) // promoQty must be >= 2
    expect(promoLineTotal(100, 3, 3, 0)).toBe(300) // promoPrice must be > 0
  })

  it('never charges more than the plain price for a misconfigured promo', () => {
    expect(promoLineTotal(39, 3, 3, 150)).toBe(117)
  })

  it('returns 0 for no quantity', () => {
    expect(promoLineTotal(39, 0, 3, 100)).toBe(0)
    expect(promoLineTotal(39, -2, 3, 100)).toBe(0)
  })

  it('handles non-integer prices without float noise', () => {
    expect(promoLineTotal(0.1, 3, null, null)).toBe(0.3)
  })
})

describe('cart lines', () => {
  const tier = mkTier({ id: 't39', name: 'เสื้อยืด', price: 39, promoQty: 3, promoPrice: 100, unit: 'ตัว' })

  it('lineFromTier copies the tier with qty 1', () => {
    expect(lineFromTier(tier)).toEqual({
      key: 't39',
      tierId: 't39',
      name: 'เสื้อยืด',
      unit: 'ตัว',
      price: 39,
      qty: 1,
      promoQty: 3,
      promoPrice: 100,
    })
  })

  it('lineFromTier drops an unusable promo', () => {
    const l = lineFromTier(mkTier({ price: 50, promoQty: 1, promoPrice: 40 }))
    expect(l.promoQty).toBeNull()
    expect(l.promoPrice).toBeNull()
  })

  it('customLine gets a unique key, no tier, default unit and name', () => {
    const a = customLine('', 250)
    const b = customLine('กระเป๋า', 250, 'ใบ')
    expect(a.key).not.toBe(b.key)
    expect(a.key.startsWith('custom-')).toBe(true)
    expect(a.tierId).toBeNull()
    expect(a.unit).toBe('ชิ้น')
    expect(a.name).toBe('ราคาอื่น')
    expect(a.qty).toBe(1)
    expect(b.unit).toBe('ใบ')
    expect(b.name).toBe('กระเป๋า')
    expect(customLine('x', -5).price).toBe(0)
  })

  it('addLine merges by key and appends new keys', () => {
    let lines: CartLine[] = []
    lines = addLine(lines, lineFromTier(tier))
    lines = addLine(lines, lineFromTier(tier))
    lines = addLine(lines, customLine('', 80))
    expect(lines).toHaveLength(2)
    expect(lines[0].qty).toBe(2)
    lines = addLine(lines, { ...lineFromTier(tier), qty: 3 })
    expect(lines[0].qty).toBe(5)
  })

  it('addLine does not mutate the input', () => {
    const start = [lineFromTier(tier)]
    const next = addLine(start, lineFromTier(tier))
    expect(start[0].qty).toBe(1)
    expect(next[0].qty).toBe(2)
  })

  it('setLineQty sets and removes', () => {
    const c = customLine('', 80)
    const lines = [lineFromTier(tier), c]
    expect(setLineQty(lines, 't39', 4)[0].qty).toBe(4)
    expect(setLineQty(lines, 't39', 0).map((l) => l.key)).toEqual([c.key])
    expect(setLineQty(lines, 't39', -1)).toHaveLength(1)
    expect(setLineQty(lines, 'nope', 3)).toEqual(lines)
  })
})

describe('computeCart', () => {
  const t39 = lineFromTier(mkTier({ id: 't39', price: 39, promoQty: 3, promoPrice: 100 }))
  const t59 = lineFromTier(mkTier({ id: 't59', price: 59, promoQty: 2, promoPrice: 100 }))
  const t100 = lineFromTier(mkTier({ id: 't100', price: 100 }))

  it('builds items, promo discount and total', () => {
    const c = computeCart([{ ...t39, qty: 4 }, { ...t59, qty: 3 }, t100], 0)
    expect(c.items).toHaveLength(3)
    expect(c.items[0]).toMatchObject({ tierId: 't39', qty: 4, fullTotal: 156, lineTotal: 139, promoQty: 3, promoPrice: 100 })
    expect(c.items[1]).toMatchObject({ fullTotal: 177, lineTotal: 159 })
    expect(c.items[2]).toMatchObject({ fullTotal: 100, lineTotal: 100 })
    expect(c.pieces).toBe(8)
    expect(c.subtotal).toBe(433)
    expect(c.promoDiscount).toBe(35)
    expect(c.manualDiscount).toBe(0)
    expect(c.total).toBe(398)
    expect(c.total).toBe(c.subtotal - c.promoDiscount - c.manualDiscount)
  })

  it('applies a manual discount (ลูกค้าต่อ)', () => {
    const c = computeCart([{ ...t39, qty: 4 }], 9)
    expect(c.total).toBe(130)
    expect(c.manualDiscount).toBe(9)
  })

  it('clamps the manual discount to [0, subtotal − promo]', () => {
    const big = computeCart([{ ...t39, qty: 3 }], 500)
    expect(big.manualDiscount).toBe(100)
    expect(big.total).toBe(0)
    const neg = computeCart([{ ...t39, qty: 3 }], -20)
    expect(neg.manualDiscount).toBe(0)
    expect(neg.total).toBe(100)
    const nan = computeCart([{ ...t39, qty: 3 }], Number.NaN)
    expect(nan.manualDiscount).toBe(0)
    expect(nan.total).toBe(100)
  })

  it('empty cart is all zeros', () => {
    expect(computeCart([], 50)).toEqual({ items: [], pieces: 0, subtotal: 0, promoDiscount: 0, manualDiscount: 0, total: 0 })
  })

  it('skips lines with no quantity', () => {
    const c = computeCart([{ ...t100, qty: 0 }, t39], 0)
    expect(c.items).toHaveLength(1)
    expect(c.total).toBe(39)
  })

  it('custom price lines have no tier', () => {
    const c = computeCart([customLine('', 250)], 0)
    expect(c.items[0].tierId).toBeNull()
    expect(c.total).toBe(250)
  })
})

describe('cashChange', () => {
  it('returns received − total', () => {
    expect(cashChange(139, 200)).toBe(61)
    expect(cashChange(139, 139)).toBe(0)
    expect(cashChange(139, 100)).toBe(-39)
    expect(cashChange(0.3, 1)).toBe(0.7)
  })
})

describe('quickCashOptions', () => {
  it('139 → exact, round-ups and banknotes', () => {
    expect(quickCashOptions(139)).toEqual([139, 140, 150, 200, 500, 1000])
  })

  it('exact multiples are not repeated', () => {
    expect(quickCashOptions(100)).toEqual([100, 500, 1000])
    expect(quickCashOptions(200)).toEqual([200, 500, 1000])
    expect(quickCashOptions(1000)).toEqual([1000])
  })

  it('other totals', () => {
    expect(quickCashOptions(39)).toEqual([39, 40, 50, 100, 500, 1000])
    expect(quickCashOptions(59)).toEqual([59, 60, 100, 500, 1000])
    expect(quickCashOptions(259)).toEqual([259, 260, 300, 500, 1000])
    expect(quickCashOptions(1234)).toEqual([1234, 1240, 1250, 1300, 1500, 2000])
    expect(quickCashOptions(45.5)).toEqual([45.5, 50, 60, 100, 500, 1000])
  })

  it('zero or negative → [0]', () => {
    expect(quickCashOptions(0)).toEqual([0])
    expect(quickCashOptions(-5)).toEqual([0])
    expect(quickCashOptions(Number.NaN)).toEqual([0])
  })

  it('always ascending, unique, >= total, at most 6, exact first', () => {
    for (let t = 1; t <= 3000; t += 7) {
      const o = quickCashOptions(t)
      expect(o[0]).toBe(t)
      expect(o.length).toBeLessThanOrEqual(6)
      expect(new Set(o).size).toBe(o.length)
      for (let i = 1; i < o.length; i++) expect(o[i]).toBeGreaterThan(o[i - 1])
      for (const v of o) expect(v).toBeGreaterThanOrEqual(t)
    }
  })
})
