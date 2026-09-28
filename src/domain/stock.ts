// Stock per price button: received (lots) + adjustments − sold (paid bills).
import type { Adjustment, DayKey, ID, Lot, Sale, Tier } from '../types'
import { round2 } from '../lib/format'

export interface TierStock {
  tierId: ID
  received: number
  sold: number
  adjusted: number
  onHand: number
  avgCost: number | null
  stockValue: number | null
  lastReceived: DayKey | null
  lastSold: DayKey | null
}

/** Weighted-average unit cost per tier over all non-deleted lots with a positive quantity. */
export function avgCostByTier(lots: Lot[]): Map<ID, number> {
  const acc = new Map<ID, { qty: number; cost: number }>()
  for (const l of lots) {
    if (l.deleted === 1 || !(l.qty > 0) || !Number.isFinite(l.unitCost)) continue
    const a = acc.get(l.tierId) ?? { qty: 0, cost: 0 }
    a.qty += l.qty
    a.cost += l.qty * l.unitCost
    acc.set(l.tierId, a)
  }
  const out = new Map<ID, number>()
  for (const [id, a] of acc) if (a.qty > 0) out.set(id, round2(a.cost / a.qty))
  return out
}

function emptyStock(tierId: ID): TierStock {
  return {
    tierId,
    received: 0,
    sold: 0,
    adjusted: 0,
    onHand: 0,
    avgCost: null,
    stockValue: null,
    lastReceived: null,
    lastSold: null,
  }
}

const maxKey = (a: DayKey | null, b: DayKey): DayKey => (a == null || b > a ? b : a)

/**
 * Stock of every (non-deleted) tier given. Tiers without any activity still get an entry.
 * onHand = Σ lot.qty + Σ adjustment.qtyChange − Σ qty sold in paid bills.
 */
export function computeStock(tiers: Tier[], lots: Lot[], adjustments: Adjustment[], sales: Sale[]): Map<ID, TierStock> {
  const map = new Map<ID, TierStock>()
  for (const t of tiers) if (t.deleted !== 1) map.set(t.id, emptyStock(t.id))

  for (const l of lots) {
    if (l.deleted === 1) continue
    const s = map.get(l.tierId)
    if (!s) continue
    s.received += l.qty
    s.lastReceived = maxKey(s.lastReceived, l.dayKey)
  }
  for (const a of adjustments) {
    if (a.deleted === 1) continue
    const s = map.get(a.tierId)
    if (!s) continue
    s.adjusted += a.qtyChange
  }
  for (const sale of sales) {
    if (sale.deleted === 1 || sale.status !== 'paid') continue
    for (const it of sale.items) {
      if (!it.tierId) continue
      const s = map.get(it.tierId)
      if (!s) continue
      s.sold += it.qty
      s.lastSold = maxKey(s.lastSold, sale.dayKey)
    }
  }

  const avg = avgCostByTier(lots)
  for (const s of map.values()) {
    s.received = round2(s.received)
    s.adjusted = round2(s.adjusted)
    s.sold = round2(s.sold)
    s.onHand = round2(s.received + s.adjusted - s.sold)
    s.avgCost = avg.get(s.tierId) ?? null
    s.stockValue = s.avgCost == null ? null : s.onHand > 0 ? round2(s.onHand * s.avgCost) : 0
  }
  return map
}

/** trackStock && lowStock set && onHand <= lowStock. No stock entry → not flagged. */
export function isLowStock(t: Tier, s: TierStock | undefined): boolean {
  if (t.trackStock !== 1 || t.lowStock == null || !s) return false
  return s.onHand <= t.lowStock
}
