// Record factories for unit tests only (not imported by the app).
import type {
  Adjustment,
  Booth,
  CashMove,
  Expense,
  Lot,
  Sale,
  SaleItem,
  Shift,
  Staff,
  SyncMeta,
  Tier,
} from '../types'
import { promoLineTotal } from './pricing'

let seq = 0
export function meta(p: Partial<SyncMeta> = {}): SyncMeta {
  seq += 1
  return { id: `id${seq}`, createdAt: 1_000 + seq, updatedAt: 1_000 + seq, deviceId: 'test', deleted: 0, synced: 0, ...p }
}

export function mkBooth(p: Partial<Booth> = {}): Booth {
  return { ...meta(), name: 'แผง', openingFloat: 500, sort: 1, active: 1, ...p }
}

export function mkStaff(p: Partial<Staff> = {}): Staff {
  return { ...meta(), name: 'คนขาย', pin: '1234', role: 'staff', boothId: null, active: 1, ...p }
}

export function mkTier(p: Partial<Tier> = {}): Tier {
  return {
    ...meta(),
    boothId: 'b1',
    name: 'เสื้อยืด',
    price: 39,
    promoQty: null,
    promoPrice: null,
    unit: 'ตัว',
    color: 'yellow',
    sort: 1,
    active: 1,
    trackStock: 1,
    lowStock: null,
    ...p,
  }
}

/** SaleItem for a tier-like line with promo math applied. */
export function mkItem(p: {
  tierId?: string | null
  name?: string
  unit?: string
  price: number
  qty: number
  promoQty?: number | null
  promoPrice?: number | null
}): SaleItem {
  const promoQty = p.promoQty ?? null
  const promoPrice = p.promoPrice ?? null
  return {
    tierId: p.tierId === undefined ? null : p.tierId,
    name: p.name ?? 'ของ',
    unit: p.unit ?? 'ตัว',
    price: p.price,
    qty: p.qty,
    promoQty,
    promoPrice,
    fullTotal: p.price * p.qty,
    lineTotal: promoLineTotal(p.price, p.qty, promoQty, promoPrice),
  }
}

/** Sale whose totals are derived from its items (subtotal − promo − manual). */
export function mkSale(p: Partial<Sale> & { items?: SaleItem[] } = {}): Sale {
  const items = p.items ?? []
  const subtotal = items.reduce((a, i) => a + i.fullTotal, 0)
  const lines = items.reduce((a, i) => a + i.lineTotal, 0)
  const manual = p.manualDiscount ?? 0
  return {
    ...meta(),
    boothId: 'b1',
    shiftId: 'sh1',
    staffId: 's1',
    dayKey: '2026-09-29',
    billNo: 1,
    items,
    pieces: items.reduce((a, i) => a + i.qty, 0),
    subtotal,
    promoDiscount: subtotal - lines,
    manualDiscount: manual,
    total: Math.max(0, lines - manual),
    method: 'cash',
    cashReceived: null,
    change: null,
    status: 'paid',
    voidReason: null,
    voidedAt: null,
    voidedBy: null,
    note: null,
    ...p,
  }
}

export function mkShift(p: Partial<Shift> = {}): Shift {
  return {
    ...meta(),
    boothId: 'b1',
    staffId: 's1',
    dayKey: '2026-09-29',
    openedAt: new Date(2026, 8, 29, 9, 5).getTime(),
    openingFloat: 500,
    status: 'open',
    closedAt: null,
    closedBy: null,
    countedCash: null,
    denominations: null,
    expectedCash: null,
    cashDiff: null,
    transferChecked: 0,
    halfhalfChecked: 0,
    note: null,
    snapshot: null,
    ...p,
  }
}

export function mkMove(p: Partial<CashMove> = {}): CashMove {
  return {
    ...meta(),
    shiftId: 'sh1',
    boothId: 'b1',
    staffId: 's1',
    dayKey: '2026-09-29',
    type: 'out',
    amount: 0,
    reason: '',
    category: null,
    ...p,
  }
}

export function mkLot(p: Partial<Lot> = {}): Lot {
  const qty = p.qty ?? 10
  const unitCost = p.unitCost ?? 20
  return {
    ...meta(),
    boothId: 'b1',
    tierId: 't1',
    dayKey: '2026-09-01',
    qty,
    unitCost,
    totalCost: qty * unitCost,
    supplierId: null,
    note: null,
    staffId: null,
    ...p,
  }
}

export function mkAdj(p: Partial<Adjustment> = {}): Adjustment {
  return {
    ...meta(),
    boothId: 'b1',
    tierId: 't1',
    dayKey: '2026-09-01',
    qtyChange: 0,
    reason: 'other',
    countedQty: null,
    linkId: null,
    note: null,
    staffId: null,
    ...p,
  }
}

export function mkExpense(p: Partial<Expense> = {}): Expense {
  return {
    ...meta(),
    boothId: null,
    dayKey: '2026-09-29',
    category: 'other',
    amount: 0,
    note: null,
    staffId: null,
    ...p,
  }
}
