// Cart math for the POS: quantity promos, manual discount, change and quick cash buttons.
import type { ID, SaleItem, Tier } from '../types'
import { round2 } from '../lib/format'

/** True when a tier's quantity promo is usable (e.g. 3 for 100). */
export function hasPromo(promoQty: number | null | undefined, promoPrice: number | null | undefined): boolean {
  return promoQty != null && promoPrice != null && promoQty >= 2 && promoPrice > 0
}

/**
 * Line total after a quantity promo: every full group of `promoQty` pieces costs `promoPrice`,
 * the rest pay the unit price. 39 × 4 with "3 for 100" → 100 + 39 = 139.
 * A promo never makes the line more expensive than the plain price.
 */
export function promoLineTotal(price: number, qty: number, promoQty: number | null, promoPrice: number | null): number {
  if (!(qty > 0) || !Number.isFinite(price)) return 0
  const plain = round2(price * qty)
  if (!hasPromo(promoQty, promoPrice)) return plain
  const pq = promoQty as number
  const groups = Math.floor(qty / pq)
  const rest = qty - groups * pq
  const withPromo = round2(groups * (promoPrice as number) + rest * price)
  return Math.min(plain, withPromo)
}

export interface CartLine {
  key: string
  tierId: ID | null
  name: string
  unit: string
  price: number
  qty: number
  promoQty: number | null
  promoPrice: number | null
}

export interface CartTotals {
  items: SaleItem[]
  pieces: number
  subtotal: number
  promoDiscount: number
  manualDiscount: number
  total: number
}

export const CUSTOM_ITEM_NAME = 'ราคาอื่น'
export const CUSTOM_ITEM_UNIT = 'ชิ้น'

export function lineFromTier(t: Tier): CartLine {
  const promo = hasPromo(t.promoQty, t.promoPrice)
  return {
    key: t.id,
    tierId: t.id,
    name: t.name,
    unit: t.unit,
    price: t.price,
    qty: 1,
    promoQty: promo ? t.promoQty : null,
    promoPrice: promo ? t.promoPrice : null,
  }
}

let customSeq = 0

/** A hand-typed price (ราคาอื่น). Each call gets its own key so it never merges with another line. */
export function customLine(name: string, price: number, unit?: string): CartLine {
  customSeq += 1
  const rand = Math.random().toString(36).slice(2, 8)
  return {
    key: `custom-${Date.now().toString(36)}-${customSeq}-${rand}`,
    tierId: null,
    name: name.trim() || CUSTOM_ITEM_NAME,
    unit: unit?.trim() || CUSTOM_ITEM_UNIT,
    price: round2(Math.max(0, Number.isFinite(price) ? price : 0)),
    qty: 1,
    promoQty: null,
    promoPrice: null,
  }
}

/** Add a line, merging with an existing line of the same key (qty adds up). */
export function addLine(lines: CartLine[], line: CartLine): CartLine[] {
  const idx = lines.findIndex((l) => l.key === line.key)
  if (idx < 0) return [...lines, line]
  return lines.map((l, i) => (i === idx ? { ...l, qty: l.qty + line.qty } : l))
}

/** Set the quantity of one line; 0 or less removes it. */
export function setLineQty(lines: CartLine[], key: string, qty: number): CartLine[] {
  if (!(qty > 0)) return lines.filter((l) => l.key !== key)
  return lines.map((l) => (l.key === key ? { ...l, qty } : l))
}

/** Totals for the cart. The manual discount is clamped to [0, subtotal − promoDiscount]. */
export function computeCart(lines: CartLine[], manualDiscount: number): CartTotals {
  const items: SaleItem[] = []
  let pieces = 0
  let subtotal = 0
  let sumLines = 0
  for (const l of lines) {
    if (!(l.qty > 0)) continue
    const fullTotal = round2(l.price * l.qty)
    const lineTotal = promoLineTotal(l.price, l.qty, l.promoQty, l.promoPrice)
    items.push({
      tierId: l.tierId,
      name: l.name,
      unit: l.unit,
      price: l.price,
      qty: l.qty,
      promoQty: l.promoQty,
      promoPrice: l.promoPrice,
      fullTotal,
      lineTotal,
    })
    pieces += l.qty
    subtotal += fullTotal
    sumLines += lineTotal
  }
  subtotal = round2(subtotal)
  const promoDiscount = round2(subtotal - sumLines)
  const maxDiscount = round2(subtotal - promoDiscount)
  const wanted = Number.isFinite(manualDiscount) ? round2(manualDiscount) : 0
  const manual = Math.min(Math.max(0, wanted), Math.max(0, maxDiscount))
  const total = Math.max(0, round2(subtotal - promoDiscount - manual))
  return { items, pieces, subtotal, promoDiscount, manualDiscount: manual, total }
}

/** Change to give back (negative = customer has not paid enough yet). */
export function cashChange(total: number, received: number): number {
  return round2(received - total)
}

const ROUND_STEPS = [10, 20, 50, 100, 500, 1000]

/**
 * Quick "received" buttons for cash payment: the exact amount first, then the amounts a customer
 * is likely to hand over. 139 → [139, 140, 150, 200, 500, 1000].
 */
export function quickCashOptions(total: number): number[] {
  const t = Number.isFinite(total) ? round2(total) : 0
  if (t <= 0) return [0]
  const set = new Set<number>([t])
  for (const step of ROUND_STEPS) set.add(Math.ceil(t / step - 1e-9) * step)
  return [...set]
    .filter((v) => v >= t && v > 0)
    .sort((a, b) => a - b)
    .slice(0, 6)
}
