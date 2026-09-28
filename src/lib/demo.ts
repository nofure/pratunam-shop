// Training data: realistic past days of shifts, bills, cash moves, stock lots and expenses,
// built from the shop's own booths / price buttons / staff. Deterministic for a given seed.
// Only past days are written — today's shift (open or not) is never touched.
import { alive, db as defaultDb, newId, saveMany, type ShopDB } from '../db'
import { DENOMINATIONS, VOID_REASONS } from '../constants'
import { addLine, computeCart, lineFromTier, quickCashOptions, type CartLine } from '../domain/pricing'
import { computeShiftTotals } from '../domain/shift'
import { computeStock } from '../domain/stock'
import type { Booth, CashMove, DayKey, Expense, ExpenseCategory, ID, Lot, PayMethod, Sale, Shift, Staff, Supplier, Tier } from '../types'
import { addDays, eachDay, fromDayKey, startOfMonth, todayKey } from './dates'
import { round2 } from './format'

export const DEMO_STAFF_NAME = 'น้องเอ (ทดลอง)'
export const DEMO_STAFF_PIN = '1111'
export const DEMO_NOTE = 'ข้อมูลทดลอง'
export const DEMO_SUPPLIERS: { name: string; location: string }[] = [
  { name: 'ร้านส่งโบ๊เบ๊', location: 'โบ๊เบ๊' },
  { name: 'ร้านส่งประตูน้ำ', location: 'ประตูน้ำ' },
]
export const DEMO_MAX_DAYS = 60

export interface DemoOptions {
  days?: number
  seed?: number
  /** Business day treated as "today" (default: the real today). Only days before it are filled. */
  today?: DayKey
  database?: ShopDB
}

export interface DemoResult {
  days: number
  shifts: number
  sales: number
  voids: number
  cashMoves: number
  lots: number
  expenses: number
  staffCreated: boolean
  /** booth-days skipped because a shift already existed on that day */
  skipped: number
}

export class DemoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DemoError'
  }
}

/** Small fast seeded PRNG (mulberry32), returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Rng {
  private readonly next: () => number
  constructor(seed: number) {
    this.next = mulberry32(seed)
  }
  float(): number {
    return this.next()
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)]
  }
  weighted<T>(list: readonly T[], weights: readonly number[]): T {
    let sum = 0
    for (const w of weights) sum += Math.max(0, w)
    let r = this.next() * sum
    for (let i = 0; i < list.length; i++) {
      r -= Math.max(0, weights[i])
      if (r < 0) return list[i]
    }
    return list[list.length - 1]
  }
  /** Approximately normal (sum of uniforms). */
  normal(mean: number, sd: number): number {
    const u = this.next() + this.next() + this.next() + this.next() - 2
    return mean + u * sd * 1.73
  }
}

const MIN = 60_000
const HOUR = 60 * MIN

function at(day: DayKey, hours: number): number {
  return fromDayKey(day).getTime() + Math.round(hours * HOUR)
}

/** Greedy note/coin breakdown of a cash amount. */
export function cashBreakdown(amount: number): Record<string, number> {
  let left = Math.max(0, Math.floor(amount))
  const out: Record<string, number> = {}
  for (const d of DENOMINATIONS) {
    const n = Math.floor(left / d)
    if (n > 0) {
      out[String(d)] = n
      left -= n * d
    }
  }
  return out
}

/** Bill times within the selling day: a spread plus a lunch and an evening rush. */
function billTimes(rng: Rng, day: DayKey, count: number): number[] {
  const start = 9.25
  const end = 18.85
  const hours: number[] = []
  for (let i = 0; i < count; i++) {
    const r = rng.float()
    let h = r < 0.45 ? start + rng.float() * (end - start) : r < 0.75 ? rng.normal(12.6, 1.0) : rng.normal(17.0, 1.1)
    h = Math.min(end, Math.max(start, h))
    hours.push(h)
  }
  hours.sort((a, b) => a - b)
  const out: number[] = []
  const latest = at(day, 18.98)
  let last = 0
  for (const h of hours) {
    const ts = Math.min(latest, Math.max(at(day, h) + rng.int(0, 59) * 1000, last + 20_000))
    out.push(ts)
    last = ts
  }
  return out
}

function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step
}

/** Quantity 1–4; a promo tier often sells exactly the promo quantity. */
function pickQty(rng: Rng, t: Tier): number {
  if (t.promoQty != null && t.promoPrice != null && t.promoQty >= 2 && t.promoQty <= 4) {
    const weights = [1, 2, 3, 4].map((q) => (q === t.promoQty ? 0.5 : q === 1 ? 0.3 : 0.1))
    return rng.weighted([1, 2, 3, 4], weights)
  }
  return rng.weighted([1, 2, 3, 4], [0.64, 0.24, 0.08, 0.04])
}

/**
 * Fill the past `days` days (before today) with training data for every active booth that has
 * active price buttons. Booth-days that already have a shift are left alone, so running it twice
 * does not double the data.
 */
export async function generateDemoData(opts: DemoOptions = {}): Promise<DemoResult> {
  const database = opts.database ?? defaultDb
  const days = Math.min(DEMO_MAX_DAYS, Math.max(1, Math.floor(opts.days ?? 14)))
  const today = opts.today ?? todayKey()
  const rng = new Rng(opts.seed ?? 20260929)

  const [shop, boothRows, tierRows, staffRows, shiftRows, lotRows, adjRows, saleRows, expenseRows, supplierRows] = await Promise.all([
    database.shop.get('shop'),
    database.booths.toArray(),
    database.tiers.toArray(),
    database.staff.toArray(),
    database.shifts.toArray(),
    database.lots.toArray(),
    database.adjustments.toArray(),
    database.sales.toArray(),
    database.expenses.toArray(),
    database.suppliers.toArray(),
  ])
  if (!shop || shop.deleted === 1 || shop.setupDone !== 1) throw new DemoError('ยังไม่ได้ตั้งค่าร้าน')

  const allTiers = alive(tierRows)
  const activeTiers = allTiers.filter((t) => t.active === 1 && t.price > 0)
  const booths = alive(boothRows)
    .filter((b) => b.active === 1)
    .sort((a, b) => a.sort - b.sort)
    .filter((b) => activeTiers.some((t) => t.boothId === b.id))
  if (booths.length === 0) throw new DemoError('ยังไม่มีแผงที่มีปุ่มราคา เพิ่มปุ่มราคาก่อน')
  const tiersOf = new Map<ID, Tier[]>(booths.map((b) => [b.id, activeTiers.filter((t) => t.boothId === b.id).sort((a, c) => a.sort - c.sort)]))

  // ---- people
  const staff = alive(staffRows).filter((s) => s.active === 1)
  const owner = staff.find((s) => s.role === 'owner')
  if (!owner) throw new DemoError('ไม่พบเจ้าของร้าน')
  const newStaff: Staff[] = []
  let sellers = staff.filter((s) => s.role === 'staff')
  if (sellers.length === 0) {
    const demo: Staff = {
      id: newId(),
      createdAt: Date.now(),
      updatedAt: 0,
      deviceId: '',
      deleted: 0,
      synced: 0,
      name: DEMO_STAFF_NAME,
      pin: DEMO_STAFF_PIN,
      role: 'staff',
      boothId: null,
      active: 1,
    }
    newStaff.push(demo)
    sellers = [demo]
  }
  const sellerOf = new Map<ID, Staff>()
  booths.forEach((b, i) => {
    sellerOf.set(b.id, sellers.find((s) => s.boothId === b.id) ?? sellers[i % sellers.length])
  })

  // ---- suppliers
  const suppliers = alive(supplierRows)
  const newSuppliers: Supplier[] = []
  const demoSupplierIds: ID[] = []
  for (const d of DEMO_SUPPLIERS) {
    const found = suppliers.find((s) => s.name.trim() === d.name)
    if (found) {
      demoSupplierIds.push(found.id)
      continue
    }
    const s: Supplier = {
      id: newId(),
      createdAt: Date.now(),
      updatedAt: 0,
      deviceId: '',
      deleted: 0,
      synced: 0,
      name: d.name,
      phone: null,
      location: d.location,
      note: DEMO_NOTE,
    }
    newSuppliers.push(s)
    demoSupplierIds.push(s.id)
  }

  // ---- which booth-days to fill
  const first = addDays(today, -days)
  const last = addDays(today, -1)
  const dayList = eachDay(first, last)
  const taken = new Set(alive(shiftRows).map((s) => `${s.boothId}|${s.dayKey}`))
  const plan: { day: DayKey; booth: Booth }[] = []
  let skipped = 0
  for (const day of dayList) {
    for (const booth of booths) {
      if (taken.has(`${booth.id}|${day}`)) skipped++
      else plan.push({ day, booth })
    }
  }
  const result: DemoResult = { days, shifts: 0, sales: 0, voids: 0, cashMoves: 0, lots: 0, expenses: 0, staffCreated: false, skipped }
  if (plan.length === 0) return result

  const usedBoothIds = new Set(plan.map((p) => p.booth.id))
  const usedTiers = activeTiers.filter((t) => usedBoothIds.has(t.boothId))

  // ---- stock: start from what is on hand now, add an opening lot where it is low
  const stock = computeStock(allTiers, alive(lotRows), alive(adjRows), alive(saleRows))
  const onHand = new Map<ID, number>(usedTiers.map((t) => [t.id, stock.get(t.id)?.onHand ?? 0]))
  const baseCost = new Map<ID, number>()
  const lots: Lot[] = []
  const makeLot = (t: Tier, day: DayKey, hour: number, qty: number): void => {
    let unit = baseCost.get(t.id)
    if (unit === undefined) {
      unit = Math.max(1, Math.round(t.price * (0.45 + rng.float() * 0.2)))
      baseCost.set(t.id, unit)
    }
    const unitCost = Math.max(1, Math.round(unit * (0.95 + rng.float() * 0.1)))
    lots.push({
      id: newId(),
      createdAt: at(day, hour),
      updatedAt: 0,
      deviceId: '',
      deleted: 0,
      synced: 0,
      boothId: t.boothId,
      tierId: t.id,
      dayKey: day,
      qty,
      unitCost,
      totalCost: round2(qty * unitCost),
      supplierId: rng.chance(0.7) ? rng.pick(demoSupplierIds) : null,
      note: DEMO_NOTE,
      staffId: owner.id,
    })
    onHand.set(t.id, (onHand.get(t.id) ?? 0) + qty)
  }
  const openingDay = addDays(first, -1)
  for (const t of usedTiers) {
    if ((onHand.get(t.id) ?? 0) >= 40) continue
    makeLot(t, openingDay, 8 + rng.float(), t.price < 100 ? rng.int(150, 300) : rng.int(60, 180))
  }

  // ---- selling days
  const shifts: Shift[] = []
  const sales: Sale[] = []
  const moves: CashMove[] = []
  const methodsOn: PayMethod[] = ['cash', 'transfer', 'halfhalf', 'other']
  const methodWeights = [
    0.6,
    shop.halfHalfEnabled === 1 ? 0.3 : 0.38,
    shop.halfHalfEnabled === 1 ? 0.1 : 0,
    shop.otherPayEnabled === 1 ? 0.02 : 0,
  ]

  for (const { day, booth } of plan) {
    const tiers = tiersOf.get(booth.id) ?? []
    const primary = sellerOf.get(booth.id) ?? sellers[0]
    const seller = rng.chance(0.12) ? owner : primary
    const weekend = [0, 6].includes(fromDayKey(day).getDay())
    const billCount = Math.min(80, rng.int(25, 65) + (weekend ? rng.int(5, 15) : 0))
    const openedAt = at(day, 9) + rng.int(0, 10) * MIN
    const openingFloat = round2(Math.max(0, booth.openingFloat || 0))
    const shiftId = newId()
    const daySales: Sale[] = []
    const weights = tiers.map((t) => 1 / Math.pow(Math.max(1, t.price), 1.1))

    billTimes(rng, day, billCount).forEach((ts, i) => {
      let lines: CartLine[] = []
      const lineCount = rng.weighted([1, 2, 3], [0.7, 0.24, 0.06])
      for (let l = 0; l < lineCount; l++) {
        let tier = rng.weighted(tiers, weights)
        for (let tries = 0; tries < 4 && tier.trackStock === 1 && (onHand.get(tier.id) ?? 0) < 1; tries++) {
          tier = rng.weighted(tiers, weights)
        }
        lines = addLine(lines, { ...lineFromTier(tier), qty: pickQty(rng, tier) })
      }
      let cart = computeCart(lines, 0)
      if (cart.total >= 100 && rng.chance(0.08)) {
        const tail = cart.total % 10
        cart = computeCart(lines, tail > 0 && rng.chance(0.6) ? tail : rng.pick([10, 20]))
      }
      const method = rng.weighted(methodsOn, methodWeights)
      let cashReceived: number | null = null
      let change: number | null = null
      if (method === 'cash') {
        const opts = quickCashOptions(cart.total)
        cashReceived = rng.chance(0.35) ? opts[0] : rng.pick(opts.slice(0, Math.min(opts.length, 4)))
        change = round2(cashReceived - cart.total)
      }
      const isVoid = rng.chance(0.02)
      const sale: Sale = {
        id: newId(),
        createdAt: ts,
        updatedAt: 0,
        deviceId: '',
        deleted: 0,
        synced: 0,
        boothId: booth.id,
        shiftId,
        staffId: seller.id,
        dayKey: day,
        billNo: i + 1,
        items: cart.items,
        pieces: cart.pieces,
        subtotal: cart.subtotal,
        promoDiscount: cart.promoDiscount,
        manualDiscount: cart.manualDiscount,
        total: cart.total,
        method,
        cashReceived,
        change,
        status: isVoid ? 'void' : 'paid',
        voidReason: isVoid ? rng.pick(VOID_REASONS.slice(0, 3)) : null,
        voidedAt: isVoid ? ts + rng.int(1, 6) * MIN : null,
        voidedBy: isVoid ? seller.id : null,
        note: null,
      }
      if (!isVoid) {
        for (const it of cart.items) if (it.tierId) onHand.set(it.tierId, (onHand.get(it.tierId) ?? 0) - it.qty)
      }
      daySales.push(sale)
    })

    // Cash out: lunch for the seller, sometimes the owner collects cash in the afternoon.
    const dayMoves: CashMove[] = []
    const move = (ts: number, amount: number, reason: string, category: ExpenseCategory | null): void => {
      dayMoves.push({
        id: newId(),
        createdAt: ts,
        updatedAt: 0,
        deviceId: '',
        deleted: 0,
        synced: 0,
        shiftId,
        boothId: booth.id,
        staffId: seller.id,
        dayKey: day,
        type: 'out',
        amount,
        reason,
        category,
      })
    }
    move(at(day, 12 + rng.float()), rng.pick([40, 50, 50, 60, 60, 70, 80]), 'ค่าข้าวคนขาย', 'food')
    const collectAt = at(day, 15 + rng.float() * 0.5)
    const cashBefore = daySales
      .filter((s) => s.status === 'paid' && s.method === 'cash' && s.createdAt < collectAt)
      .reduce((sum, s) => sum + s.total, 0)
    if (cashBefore >= 2500 && rng.chance(0.3)) move(collectAt, roundTo(cashBefore * 0.5, 500), 'เจ้าของเก็บเงิน', null)

    // Close the shift: counted cash mostly matches, sometimes a little short or over.
    const totals = computeShiftTotals(openingFloat, daySales, dayMoves)
    const diff = rng.weighted([0, -20, -50, 10], [0.78, 0.1, 0.06, 0.06])
    const counted = round2(Math.max(0, totals.expectedCash + diff))
    shifts.push({
      id: shiftId,
      createdAt: openedAt,
      updatedAt: 0,
      deviceId: '',
      deleted: 0,
      synced: 0,
      boothId: booth.id,
      staffId: seller.id,
      dayKey: day,
      openedAt,
      openingFloat,
      status: 'closed',
      closedAt: at(day, 19) + rng.int(0, 15) * MIN,
      closedBy: seller.id,
      countedCash: counted,
      denominations: cashBreakdown(counted),
      expectedCash: totals.expectedCash,
      cashDiff: round2(counted - totals.expectedCash),
      transferChecked: 1,
      halfhalfChecked: shop.halfHalfEnabled === 1 ? 1 : 0,
      note: DEMO_NOTE,
      snapshot: totals,
    })
    sales.push(...daySales)
    moves.push(...dayMoves)
    result.voids += daySales.filter((s) => s.status === 'void').length

    // Restock tomorrow morning when a price button runs low (still in the past).
    const next = addDays(day, 1)
    if (next < today) {
      for (const t of tiers) {
        if (t.trackStock === 1 && (onHand.get(t.id) ?? 0) < 20) makeLot(t, next, 8 + rng.float() * 0.5, t.price < 100 ? rng.int(100, 200) : rng.int(40, 120))
      }
    }
  }

  // ---- monthly expenses (rent + electric per booth, wage per seller), once per month
  const liveExpenses = alive(expenseRows)
  const hasExpense = (category: ExpenseCategory, boothId: ID | null, month: string) =>
    liveExpenses.some((e) => e.category === category && e.boothId === boothId && e.dayKey.startsWith(month))
  const expenses: Expense[] = []
  const addExpense = (dayKey: DayKey, boothId: ID | null, category: ExpenseCategory, amount: number, note: string) => {
    if (hasExpense(category, boothId, dayKey.slice(0, 7))) return
    if (expenses.some((e) => e.category === category && e.boothId === boothId && e.dayKey.slice(0, 7) === dayKey.slice(0, 7))) return
    expenses.push({
      id: newId(),
      createdAt: at(dayKey, 10),
      updatedAt: 0,
      deviceId: '',
      deleted: 0,
      synced: 0,
      boothId,
      dayKey,
      category,
      amount,
      note,
      staffId: owner.id,
    })
  }
  const months = [...new Set(dayList.map((d) => d.slice(0, 7)))]
  for (const month of months) {
    const monthStart = startOfMonth(`${month}-01`)
    const dayKey = monthStart < first ? first : monthStart
    for (const booth of booths) {
      if (!usedBoothIds.has(booth.id)) continue
      addExpense(dayKey, booth.id, 'rent', roundTo(rng.int(3000, 6000), 500), `ค่าเช่าแผง · ${DEMO_NOTE}`)
      addExpense(dayKey, booth.id, 'electric', roundTo(rng.int(300, 800), 50), `ค่าไฟ · ${DEMO_NOTE}`)
    }
    for (const s of sellers) {
      const boothId = s.boothId && usedBoothIds.has(s.boothId) ? s.boothId : (booths.find((b) => sellerOf.get(b.id)?.id === s.id)?.id ?? null)
      addExpense(dayKey, boothId, 'wage', roundTo(rng.int(9000, 12000), 500), `ค่าจ้าง ${s.name} · ${DEMO_NOTE}`)
    }
  }

  // ---- write everything in one transaction (saveMany stamps updatedAt/deviceId/synced, keeps id + createdAt)
  await database.transaction(
    'rw',
    [database.staff, database.suppliers, database.shifts, database.sales, database.cashMoves, database.lots, database.expenses],
    async () => {
      if (newStaff.length) await saveMany(database.staff, newStaff)
      if (newSuppliers.length) await saveMany(database.suppliers, newSuppliers)
      await saveMany(database.lots, lots)
      await saveMany(database.shifts, shifts)
      await saveMany(database.sales, sales)
      await saveMany(database.cashMoves, moves)
      if (expenses.length) await saveMany(database.expenses, expenses)
    },
  )

  result.shifts = shifts.length
  result.sales = sales.length
  result.cashMoves = moves.length
  result.lots = lots.length
  result.expenses = expenses.length
  result.staffCreated = newStaff.length > 0
  return result
}
