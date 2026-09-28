// Pure helpers for the stock pages (unit-tested in logic.test.ts).
import type { AdjustReason, DayKey, ID, Lot, Tier } from '../../types'
import { isLowStock, type TierStock } from '../../domain/stock'
import { hasPromo } from '../../domain/pricing'
import { addMonths } from '../../lib/dates'
import { baht, num, round2 } from '../../lib/format'

export const DOZEN = 12

/** Pieces from what the user typed: plain pieces, or dozens × 12. null = empty / not positive. */
export function piecesFromInput(value: number | null, dozen: boolean): number | null {
  if (value == null || !Number.isFinite(value) || !(value > 0)) return null
  return round2(dozen ? value * DOZEN : value)
}

/** Quantity for display with a real minus sign: -2 → "−2", 1.5 → "1.5". */
export function qtyText(n: number): string {
  const r = round2(n)
  return (r < 0 ? '−' : '') + num(Math.abs(r), 2)
}

export function isWholeNumber(n: number): boolean {
  return Number.isInteger(round2(n))
}

export type CostMode = 'unit' | 'total'

export interface LotCosts {
  unitCost: number
  totalCost: number
}

/**
 * Unit and total cost of a lot from one typed amount.
 * 'unit' = the amount is the cost per piece; 'total' = the amount paid for the whole lot.
 */
export function lotCosts(mode: CostMode, qty: number | null, amount: number | null): LotCosts | null {
  if (qty == null || !(qty > 0) || amount == null || !Number.isFinite(amount) || amount < 0) return null
  return mode === 'unit'
    ? { unitCost: round2(amount), totalCost: round2(amount * qty) }
    : { unitCost: round2(amount / qty), totalCost: round2(amount) }
}

export interface Margin {
  profit: number
  /** Profit as % of the sale price (1 decimal). null when the price is 0. */
  pct: number | null
}

export function margin(salePrice: number, unitCost: number): Margin {
  const profit = round2(salePrice - unitCost)
  return { profit, pct: salePrice > 0 ? Math.round((profit / salePrice) * 1000) / 10 : null }
}

/** Price per piece when sold with the quantity promo (3 for 100 → 33.33). null = no promo. */
export function promoUnitPrice(t: Pick<Tier, 'promoQty' | 'promoPrice'>): number | null {
  if (!hasPromo(t.promoQty, t.promoPrice)) return null
  return round2((t.promoPrice as number) / (t.promoQty as number))
}

/** Promo label like "3 ตัว 100". null = no promo. */
export function promoText(t: Pick<Tier, 'promoQty' | 'promoPrice' | 'unit'>): string | null {
  if (!hasPromo(t.promoQty, t.promoPrice)) return null
  return `${t.promoQty} ${t.unit} ${baht(t.promoPrice as number)}`
}

export function tierLabel(t: Pick<Tier, 'name' | 'price'>): string {
  return `${t.name} ${baht(t.price)}`
}

/** Weighted-average unit cost of a tier after adding one more lot (same rule as avgCostByTier). */
export function avgCostAfter(lots: Lot[], tierId: ID, qty: number, unitCost: number): number | null {
  let q = 0
  let c = 0
  for (const l of lots) {
    if (l.deleted === 1 || l.tierId !== tierId || !(l.qty > 0) || !Number.isFinite(l.unitCost)) continue
    q += l.qty
    c += l.qty * l.unitCost
  }
  if (qty > 0 && Number.isFinite(unitCost)) {
    q += qty
    c += qty * unitCost
  }
  return q > 0 ? round2(c / q) : null
}

// ---------- adjustments ----------

/** Reasons the owner can pick on the adjust page (counting has its own page). */
export const ADJUST_REASONS: AdjustReason[] = ['damaged', 'lost', 'return_supplier', 'transfer_out', 'transfer_in', 'other']

export function isTransferReason(r: AdjustReason): r is 'transfer_in' | 'transfer_out' {
  return r === 'transfer_in' || r === 'transfer_out'
}

/** +1 adds stock, −1 removes it. 'other' and 'count' follow the direction the user chose. */
export function reasonSign(r: AdjustReason, direction: 1 | -1): 1 | -1 {
  switch (r) {
    case 'transfer_in':
      return 1
    case 'other':
    case 'count':
      return direction
    default:
      return -1
  }
}

function normName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The tier in another booth with the same name and price (active ones first). */
export function suggestTargetTier(source: Pick<Tier, 'name' | 'price'>, candidates: Tier[]): Tier | null {
  const n = normName(source.name)
  const matches = candidates.filter((t) => t.deleted !== 1 && t.price === source.price && normName(t.name) === n)
  matches.sort((a, b) => b.active - a.active || a.sort - b.sort)
  return matches[0] ?? null
}

// ---------- stock count ----------

export interface CountChange {
  tierId: ID
  onHand: number
  counted: number
  /** counted − onHand, the adjustment to save */
  diff: number
}

/** Rows where a counted quantity was entered and differs from what the system has. */
export function countChanges(
  tierIds: ID[],
  stock: Map<ID, TierStock>,
  counts: Record<string, number | null | undefined>,
): CountChange[] {
  const out: CountChange[] = []
  for (const id of tierIds) {
    const counted = counts[id]
    if (counted == null || !Number.isFinite(counted) || counted < 0) continue
    const onHand = stock.get(id)?.onHand ?? 0
    const diff = round2(counted - onHand)
    if (diff === 0) continue
    out.push({ tierId: id, onHand, counted, diff })
  }
  return out
}

/** Saved draft of a stock count ({ tierId: counted }). Bad data → empty. */
export function parseCountDraft(raw: string | null): Record<string, number> {
  if (!raw) return {}
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: Record<string, number> = {}
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[k] = n
    }
    return out
  } catch {
    return {}
  }
}

// ---------- on-hand list ----------

/**
 * none = nothing received or counted yet (on-hand unknown), negative = sold more than recorded,
 * out = 0 left, low = at or below the tier's alert level.
 */
export type StockStatus = 'none' | 'negative' | 'out' | 'low' | 'ok'

export function stockStatus(t: Tier, s: TierStock | undefined): StockStatus {
  if (!s || (s.received === 0 && s.adjusted === 0)) return 'none'
  if (s.onHand < 0) return 'negative'
  if (s.onHand === 0) return 'out'
  if (isLowStock(t, s)) return 'low'
  return 'ok'
}

const STATUS_RANK: Record<StockStatus, number> = { negative: 0, out: 0, low: 0, ok: 1, none: 2 }

export function needsAttention(s: StockStatus): boolean {
  return STATUS_RANK[s] === 0
}

export function compareTierName(a: Tier, b: Tier): number {
  return a.name.localeCompare(b.name, 'th') || a.price - b.price || a.sort - b.sort
}

/** Low / out / negative first, then the rest, then tiers with no stock data; by name inside each group. */
export function compareStockRows(a: { tier: Tier; status: StockStatus }, b: { tier: Tier; status: StockStatus }): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || compareTierName(a.tier, b.tier)
}

/** Every word must match the name, or the start of the price ("เสื้อ 39"). */
export function matchesQuery(t: Pick<Tier, 'name' | 'price'>, q: string): boolean {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const name = t.name.toLowerCase()
  const price = String(t.price)
  return tokens.every((tok) => {
    if (name.includes(tok)) return true
    const digits = tok.replace(/[฿,]/g, '')
    return digits !== '' && /^\d+(\.\d*)?$/.test(digits) && price.startsWith(digits)
  })
}

// ---------- lots & suppliers ----------

export interface LotTotals {
  count: number
  qty: number
  cost: number
}

export function lotTotals(lots: Lot[]): LotTotals {
  let qty = 0
  let cost = 0
  let count = 0
  for (const l of lots) {
    if (l.deleted === 1) continue
    count += 1
    qty += l.qty
    cost += l.totalCost
  }
  return { count, qty: round2(qty), cost: round2(cost) }
}

export interface SupplierStat {
  total: number
  count: number
  qty: number
  last: DayKey | null
}

export function supplierStats(lots: Lot[]): Map<ID, SupplierStat> {
  const out = new Map<ID, SupplierStat>()
  for (const l of lots) {
    if (l.deleted === 1 || !l.supplierId) continue
    const s = out.get(l.supplierId) ?? { total: 0, count: 0, qty: 0, last: null }
    s.total = round2(s.total + l.totalCost)
    s.qty = round2(s.qty + l.qty)
    s.count += 1
    if (s.last == null || l.dayKey > s.last) s.last = l.dayKey
    out.set(l.supplierId, s)
  }
  return out
}

/** 'YYYY-MM' of a DayKey. */
export function monthOf(k: DayKey): string {
  return k.slice(0, 7)
}

/** 'YYYY-MM' moved by n months. */
export function shiftMonth(month: string, n: number): string {
  return monthOf(addMonths(`${month}-01`, n))
}

/** Newest first: by business day, then by time entered. */
export function compareNewest(a: { dayKey: DayKey; createdAt: number }, b: { dayKey: DayKey; createdAt: number }): number {
  return a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : b.createdAt - a.createdAt
}
