// Shift (เปิดร้าน → ปิดยอด) math: totals, expected cash, bill numbers, best sellers.
import type { CashMove, ID, PayMethod, Sale, ShiftTotals } from '../types'
import { baht, round2 } from '../lib/format'

export const PAY_METHODS: PayMethod[] = ['cash', 'transfer', 'halfhalf', 'other']

export function emptyByMethod(): Record<PayMethod, number> {
  return { cash: 0, transfer: 0, halfhalf: 0, other: 0 }
}

export function emptyShiftTotals(openingFloat = 0): ShiftTotals {
  return {
    bills: 0,
    pieces: 0,
    byMethod: emptyByMethod(),
    total: 0,
    promoDiscount: 0,
    manualDiscount: 0,
    voidBills: 0,
    voidTotal: 0,
    cashIn: 0,
    cashOut: 0,
    expectedCash: round2(openingFloat || 0),
  }
}

/**
 * Totals of one shift. Deleted rows are ignored; voided bills only count in voidBills/voidTotal.
 * expectedCash = openingFloat + cash sales + cashIn − cashOut.
 */
export function computeShiftTotals(openingFloat: number, sales: Sale[], moves: CashMove[]): ShiftTotals {
  const t = emptyShiftTotals(openingFloat)
  for (const s of sales) {
    if (s.deleted === 1) continue
    if (s.status === 'void') {
      t.voidBills += 1
      t.voidTotal += s.total
      continue
    }
    if (s.status !== 'paid') continue
    t.bills += 1
    t.pieces += s.pieces
    t.total += s.total
    t.promoDiscount += s.promoDiscount
    t.manualDiscount += s.manualDiscount
    const m: PayMethod = s.method in t.byMethod ? s.method : 'other'
    t.byMethod[m] += s.total
  }
  for (const mv of moves) {
    if (mv.deleted === 1) continue
    if (mv.type === 'in') t.cashIn += mv.amount
    else if (mv.type === 'out') t.cashOut += mv.amount
  }
  for (const m of PAY_METHODS) t.byMethod[m] = round2(t.byMethod[m])
  t.total = round2(t.total)
  t.promoDiscount = round2(t.promoDiscount)
  t.manualDiscount = round2(t.manualDiscount)
  t.voidTotal = round2(t.voidTotal)
  t.cashIn = round2(t.cashIn)
  t.cashOut = round2(t.cashOut)
  t.expectedCash = round2((openingFloat || 0) + t.byMethod.cash + t.cashIn - t.cashOut)
  return t
}

/** Total of a cash count, e.g. {'1000': 2, '100': 5} → 2500. Invalid entries are ignored. */
export function denominationTotal(d: Record<string, number>): number {
  let sum = 0
  for (const [k, count] of Object.entries(d ?? {})) {
    const value = Number(k)
    if (!Number.isFinite(value) || value <= 0) continue
    if (!Number.isFinite(count) || count <= 0) continue
    sum += value * count
  }
  return round2(sum)
}

/** Next running bill number in a shift (voided and deleted bills keep their numbers). */
export function nextBillNo(salesInShift: Sale[]): number {
  let max = 0
  for (const s of salesInShift) if (Number.isFinite(s.billNo) && s.billNo > max) max = s.billNo
  return Math.floor(max) + 1
}

export function cashDiffTone(diff: number): 'ok' | 'short' | 'over' {
  const r = round2(diff || 0)
  if (r === 0) return 'ok'
  return r < 0 ? 'short' : 'over'
}

/** 'ตรง' / 'ขาด 20' / 'เกิน 15' for counted − expected cash. */
export function cashDiffText(diff: number): string {
  const tone = cashDiffTone(diff)
  if (tone === 'ok') return 'ตรง'
  return `${tone === 'short' ? 'ขาด' : 'เกิน'} ${baht(Math.abs(diff))}`
}

export interface TopItem {
  tierId: ID | null
  name: string
  price: number
  unit: string
  qty: number
  total: number
}

/**
 * Best sellers of paid, non-deleted bills grouped by price button (hand-typed prices are grouped by
 * name + price). Sorted by quantity, then amount. `total` is after quantity promos.
 */
export function topItems(sales: Sale[], limit?: number): TopItem[] {
  const map = new Map<string, TopItem>()
  const ordered = sales
    .filter((s) => s.deleted !== 1 && s.status === 'paid')
    .sort((a, b) => a.createdAt - b.createdAt)
  for (const s of ordered) {
    for (const it of s.items) {
      const key = it.tierId ? `t:${it.tierId}` : `c:${it.name}|${it.price}`
      const cur = map.get(key)
      if (cur) {
        cur.qty += it.qty
        cur.total += it.lineTotal
        // latest bill wins for display fields (a tier may have been renamed)
        cur.name = it.name
        cur.price = it.price
        cur.unit = it.unit
      } else {
        map.set(key, { tierId: it.tierId, name: it.name, price: it.price, unit: it.unit, qty: it.qty, total: it.lineTotal })
      }
    }
  }
  const rows = [...map.values()].map((r) => ({ ...r, total: round2(r.total) }))
  rows.sort((a, b) => b.qty - a.qty || b.total - a.total || a.price - b.price)
  return limit != null && limit >= 0 ? rows.slice(0, limit) : rows
}
