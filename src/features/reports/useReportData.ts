// Live IndexedDB queries behind the reports page. Each result carries the key it was loaded for,
// because useLiveQuery keeps returning the previous result while new deps are loading.
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import type { Adjustment, Booth, CashMove, Expense, Lot, Sale, Shift, ShopConfig, Staff, Tier } from '../../types'
import type { DayRange } from '../../lib/dates'

export interface BaseData {
  shop: ShopConfig | null
  /** every row, deleted ones included (names of old bills must still resolve) */
  booths: Booth[]
  staff: Staff[]
  tiers: Tier[]
  lots: Lot[]
  adjustments: Adjustment[]
}

export interface RangeData {
  key: string
  /** the range these rows were loaded for */
  range: DayRange
  prev: DayRange | null
  sales: Sale[]
  shifts: Shift[]
  cashMoves: CashMove[]
  expenses: Expense[]
  /** sales of the previous period (null = no comparison for this range) */
  prevSales: Sale[] | null
}

/** Small all-time tables: shop, booths, staff, price buttons, goods received, stock corrections. */
export function useBaseData(): BaseData | undefined {
  return useLiveQuery(async () => {
    const [shop, booths, staff, tiers, lots, adjustments] = await Promise.all([
      db.shop.get('shop'),
      db.booths.toArray(),
      db.staff.toArray(),
      db.tiers.toArray(),
      db.lots.toArray(),
      db.adjustments.toArray(),
    ])
    return { shop: shop ?? null, booths, staff, tiers, lots, adjustments }
  }, [])
}

export function rangeKey(r: DayRange, prev: DayRange | null): string {
  return `${r.from}|${r.to}|${prev ? `${prev.from}|${prev.to}` : '-'}`
}

/** Bills, shifts, cash moves and expenses of the range (by the dayKey index). */
export function useRangeData(r: DayRange, prev: DayRange | null): RangeData | undefined {
  const key = rangeKey(r, prev)
  const { from, to } = r
  const prevFrom = prev?.from ?? null
  const prevTo = prev?.to ?? null
  return useLiveQuery(async () => {
    const [sales, shifts, cashMoves, expenses, prevSales] = await Promise.all([
      db.sales.where('dayKey').between(from, to, true, true).toArray(),
      db.shifts.where('dayKey').between(from, to, true, true).toArray(),
      db.cashMoves.where('dayKey').between(from, to, true, true).toArray(),
      db.expenses.where('dayKey').between(from, to, true, true).toArray(),
      prevFrom && prevTo ? db.sales.where('dayKey').between(prevFrom, prevTo, true, true).toArray() : Promise.resolve(null),
    ])
    const prevRange: DayRange | null = prevFrom && prevTo ? { from: prevFrom, to: prevTo } : null
    return { key, range: { from, to }, prev: prevRange, sales, shifts, cashMoves, expenses, prevSales }
  }, [key])
}

/**
 * Every bill ever — stock on hand needs all-time sales. Only loaded when some price button tracks stock.
 * `null` = not needed.
 */
export function useAllSalesForStock(needed: boolean | undefined): { needed: boolean; sales: Sale[] | null } | undefined {
  return useLiveQuery(async () => {
    if (!needed) return { needed: false, sales: null }
    return { needed: true, sales: await db.sales.toArray() }
  }, [needed])
}
