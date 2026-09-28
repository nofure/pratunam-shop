// Owner reports: sales, profit, expenses, staff and cash differences over a date range.
import type {
  Adjustment,
  Booth,
  CashMove,
  DayKey,
  Expense,
  ExpenseCategory,
  ID,
  Lot,
  PayMethod,
  Sale,
  Shift,
  Staff,
  Tier,
} from '../types'
import { round2 } from '../lib/format'
import { diffDays, eachDay } from '../lib/dates'
import { avgCostByTier, isLowStock, type TierStock } from './stock'
import { emptyByMethod, PAY_METHODS } from './shift'

export interface ReportInput {
  from: DayKey
  to: DayKey
  boothId: ID | null
  sales: Sale[]
  shifts: Shift[]
  cashMoves: CashMove[]
  expenses: Expense[]
  lots: Lot[]
  adjustments: Adjustment[]
  tiers: Tier[]
  booths: Booth[]
  staff: Staff[]
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['rent', 'electric', 'wage', 'supplies', 'travel', 'food', 'other']

export const UNKNOWN_BOOTH_NAME = 'ไม่ทราบแผง'
export const UNKNOWN_STAFF_NAME = 'ไม่ทราบชื่อ'

export interface ReportTotals {
  sales: number
  bills: number
  pieces: number
  avgBill: number
  promoDiscount: number
  manualDiscount: number
  voidBills: number
  voidTotal: number
}

export interface ReportBoothRow {
  boothId: ID
  name: string
  sales: number
  bills: number
  pieces: number
}

export interface ReportTierRow {
  key: string
  tierId: ID | null
  boothId: ID
  boothName: string
  name: string
  price: number
  unit: string
  qty: number
  /** line totals net of the bill's manual discount (Σ over rows == totals.sales) */
  sales: number
  cogs: number | null
  profit: number | null
}

export interface ReportCategoryRow {
  name: string
  qty: number
  sales: number
}

export interface ReportStaffRow {
  staffId: ID
  name: string
  sales: number
  bills: number
  shiftsClosed: number
  cashDiffTotal: number
}

export interface ReportDayRow {
  dayKey: DayKey
  sales: number
  bills: number
}

export interface ReportCashDiff {
  shiftId: ID
  dayKey: DayKey
  boothId: ID
  boothName: string
  staffId: ID
  staffName: string
  diff: number
}

export interface ReportOpenShift {
  shiftId: ID
  dayKey: DayKey
  boothId: ID
  boothName: string
  staffId: ID
  staffName: string
  openedAt: number
}

export interface ReportExpenses {
  total: number
  byCategory: Record<ExpenseCategory, number>
  /** part of `total` paid from a drawer (cash-out with a category) */
  fromDrawer: number
}

export interface Report {
  from: DayKey
  to: DayKey
  boothId: ID | null
  days: number
  totals: ReportTotals
  byMethod: Record<PayMethod, number>
  byBooth: ReportBoothRow[]
  byTier: ReportTierRow[]
  byCategory: ReportCategoryRow[]
  byStaff: ReportStaffRow[]
  /** 24 slots: sales by local hour of the bill */
  byHour: number[]
  /** every day in the range, zero days included */
  byDay: ReportDayRow[]
  /** sales of items whose cost is known (tier with lots) */
  knownCostSales: number
  cogs: number
  /** knownCostSales − cogs */
  grossProfit: number
  /** sales of items without a known cost (hand-typed prices, tiers without lots) */
  cogsUnknownSales: number
  expenses: ReportExpenses
  /** grossProfit − expenses.total */
  netProfit: number
  cashDiffs: ReportCashDiff[]
  voids: Sale[]
  /** goods received (lots) in the range */
  stockIn: { lots: number; qty: number; cost: number }
  /** shifts in the range that are still open */
  openShifts: ReportOpenShift[]
}

export function emptyExpenseByCategory(): Record<ExpenseCategory, number> {
  return { rent: 0, electric: 0, wage: 0, supplies: 0, travel: 0, food: 0, other: 0 }
}

/**
 * Split a bill's total over its items proportionally to lineTotal, so each item's share already has the
 * bill's manual discount taken off. The shares always add up to the bill total (rounding goes to the
 * largest line).
 */
export function allocateSaleNet(sale: Pick<Sale, 'items' | 'total'>): number[] {
  const items = sale.items
  if (items.length === 0) return []
  const target = round2(sale.total)
  const sumLines = items.reduce((a, it) => a + Math.max(0, it.lineTotal), 0)
  const nets = items.map((it) => (sumLines > 0 ? round2((target * Math.max(0, it.lineTotal)) / sumLines) : 0))
  const diff = round2(target - nets.reduce((a, b) => a + b, 0))
  if (diff !== 0) {
    let idx = 0
    for (let i = 1; i < items.length; i++) if (items[i].lineTotal > items[idx].lineTotal) idx = i
    nets[idx] = round2(nets[idx] + diff)
  }
  return nets
}

const inRangeKey = (k: DayKey, from: DayKey, to: DayKey) => k >= from && k <= to

export function buildReport(input: ReportInput): Report {
  const { from, to, boothId } = input
  const days = eachDay(from, to)
  const boothOk = (id: ID | null | undefined) => boothId == null || id === boothId
  const pick = <T extends { deleted: 0 | 1; dayKey: DayKey; boothId: ID }>(rows: T[]) =>
    rows.filter((r) => r.deleted !== 1 && inRangeKey(r.dayKey, from, to) && boothOk(r.boothId))

  const sales = pick(input.sales)
  const paid = sales.filter((s) => s.status === 'paid')
  const voids = sales.filter((s) => s.status === 'void').sort((a, b) => b.createdAt - a.createdAt)
  const shifts = pick(input.shifts)
  const moves = pick(input.cashMoves)
  const lots = pick(input.lots)
  const expenseRows = input.expenses.filter(
    (e) => e.deleted !== 1 && inRangeKey(e.dayKey, from, to) && (boothId == null || e.boothId === boothId),
  )

  const boothById = new Map(input.booths.map((b) => [b.id, b]))
  const staffById = new Map(input.staff.map((s) => [s.id, s]))
  const tierById = new Map(input.tiers.map((t) => [t.id, t]))
  const boothName = (id: ID) => boothById.get(id)?.name ?? UNKNOWN_BOOTH_NAME
  const staffName = (id: ID) => staffById.get(id)?.name ?? UNKNOWN_STAFF_NAME

  // ---- totals, methods, booths, staff sales, hours, days
  const totals: ReportTotals = {
    sales: 0,
    bills: 0,
    pieces: 0,
    avgBill: 0,
    promoDiscount: 0,
    manualDiscount: 0,
    voidBills: voids.length,
    voidTotal: round2(voids.reduce((a, s) => a + s.total, 0)),
  }
  const byMethod = emptyByMethod()
  const boothRows = new Map<ID, ReportBoothRow>()
  for (const b of input.booths) {
    if (b.deleted === 1 || b.active !== 1 || !boothOk(b.id)) continue
    boothRows.set(b.id, { boothId: b.id, name: b.name, sales: 0, bills: 0, pieces: 0 })
  }
  const staffRows = new Map<ID, ReportStaffRow>()
  const staffRow = (id: ID) => {
    let r = staffRows.get(id)
    if (!r) {
      r = { staffId: id, name: staffName(id), sales: 0, bills: 0, shiftsClosed: 0, cashDiffTotal: 0 }
      staffRows.set(id, r)
    }
    return r
  }
  const byHour = new Array<number>(24).fill(0)
  const dayRows = new Map<DayKey, ReportDayRow>(days.map((d) => [d, { dayKey: d, sales: 0, bills: 0 }]))

  // ---- per item
  const avgCost = avgCostByTier(input.lots)
  const tierRows = new Map<string, ReportTierRow & { lastAt: number }>()

  for (const s of paid) {
    totals.sales += s.total
    totals.bills += 1
    totals.pieces += s.pieces
    totals.promoDiscount += s.promoDiscount
    totals.manualDiscount += s.manualDiscount
    const m: PayMethod = s.method in byMethod ? s.method : 'other'
    byMethod[m] += s.total

    let br = boothRows.get(s.boothId)
    if (!br) {
      br = { boothId: s.boothId, name: boothName(s.boothId), sales: 0, bills: 0, pieces: 0 }
      boothRows.set(s.boothId, br)
    }
    br.sales += s.total
    br.bills += 1
    br.pieces += s.pieces

    const sr = staffRow(s.staffId)
    sr.sales += s.total
    sr.bills += 1

    const h = new Date(s.createdAt).getHours()
    if (h >= 0 && h < 24) byHour[h] += s.total

    const dr = dayRows.get(s.dayKey)
    if (dr) {
      dr.sales += s.total
      dr.bills += 1
    }

    const nets = allocateSaleNet(s)
    s.items.forEach((it, i) => {
      const tier = it.tierId ? tierById.get(it.tierId) : undefined
      const rowBooth = tier ? tier.boothId : s.boothId
      const key = it.tierId ? `t:${it.tierId}` : `c:${s.boothId}:${it.name}:${it.price}`
      let row = tierRows.get(key)
      if (!row) {
        row = {
          key,
          tierId: it.tierId,
          boothId: rowBooth,
          boothName: boothName(rowBooth),
          name: tier ? tier.name : it.name,
          price: tier ? tier.price : it.price,
          unit: tier ? tier.unit : it.unit,
          qty: 0,
          sales: 0,
          cogs: null,
          profit: null,
          lastAt: s.createdAt,
        }
        tierRows.set(key, row)
      } else if (!tier && s.createdAt >= row.lastAt) {
        // unknown tier: show what the latest bill said
        row.name = it.name
        row.price = it.price
        row.unit = it.unit
        row.lastAt = s.createdAt
      }
      row.qty += it.qty
      row.sales += nets[i] ?? 0
    })
    if (s.items.length === 0 && s.total !== 0) {
      // malformed bill without items: keep Σ byTier.sales == totals.sales
      const key = `x:${s.boothId}`
      let row = tierRows.get(key)
      if (!row) {
        row = {
          key,
          tierId: null,
          boothId: s.boothId,
          boothName: boothName(s.boothId),
          name: 'ไม่ระบุสินค้า',
          price: 0,
          unit: 'ชิ้น',
          qty: 0,
          sales: 0,
          cogs: null,
          profit: null,
          lastAt: s.createdAt,
        }
        tierRows.set(key, row)
      }
      row.sales += s.total
    }
  }

  totals.sales = round2(totals.sales)
  totals.pieces = round2(totals.pieces)
  totals.promoDiscount = round2(totals.promoDiscount)
  totals.manualDiscount = round2(totals.manualDiscount)
  totals.avgBill = totals.bills > 0 ? round2(totals.sales / totals.bills) : 0
  for (const m of PAY_METHODS) byMethod[m] = round2(byMethod[m])

  const byBooth = [...boothRows.values()]
    .map((r) => ({ ...r, sales: round2(r.sales), pieces: round2(r.pieces) }))
    .sort(
      (a, b) =>
        b.sales - a.sales ||
        (boothById.get(a.boothId)?.sort ?? 1e9) - (boothById.get(b.boothId)?.sort ?? 1e9) ||
        a.name.localeCompare(b.name, 'th'),
    )

  // ---- cost of goods
  let knownCostSales = 0
  let cogs = 0
  let cogsUnknownSales = 0
  const byTier: ReportTierRow[] = [...tierRows.values()].map(({ lastAt: _lastAt, ...r }) => {
    const sales = round2(r.sales)
    const cost = r.tierId != null ? avgCost.get(r.tierId) : undefined
    const rowCogs = cost != null ? round2(r.qty * cost) : null
    if (rowCogs != null) {
      knownCostSales += sales
      cogs += rowCogs
    } else {
      cogsUnknownSales += sales
    }
    return {
      ...r,
      qty: round2(r.qty),
      sales,
      cogs: rowCogs,
      profit: rowCogs != null ? round2(sales - rowCogs) : null,
    }
  })
  byTier.sort((a, b) => b.sales - a.sales || b.qty - a.qty || a.name.localeCompare(b.name, 'th') || a.price - b.price)
  knownCostSales = round2(knownCostSales)
  cogs = round2(cogs)
  cogsUnknownSales = round2(cogsUnknownSales)
  const grossProfit = round2(knownCostSales - cogs)

  const catMap = new Map<string, ReportCategoryRow>()
  for (const r of byTier) {
    const c = catMap.get(r.name) ?? { name: r.name, qty: 0, sales: 0 }
    c.qty += r.qty
    c.sales += r.sales
    catMap.set(r.name, c)
  }
  const byCategory = [...catMap.values()]
    .map((c) => ({ ...c, qty: round2(c.qty), sales: round2(c.sales) }))
    .sort((a, b) => b.sales - a.sales || b.qty - a.qty || a.name.localeCompare(b.name, 'th'))

  // ---- shifts: cash differences, staff closes, still-open shifts
  const cashDiffs: ReportCashDiff[] = []
  const openShifts: ReportOpenShift[] = []
  const closedSorted = shifts
    .filter((sh) => sh.status === 'closed')
    .sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : (a.closedAt ?? 0) - (b.closedAt ?? 0)))
  for (const sh of closedSorted) {
    const who = sh.closedBy ?? sh.staffId
    const diff = round2(sh.cashDiff ?? 0)
    const sr = staffRow(who)
    sr.shiftsClosed += 1
    sr.cashDiffTotal += diff
    if (diff !== 0) {
      cashDiffs.push({
        shiftId: sh.id,
        dayKey: sh.dayKey,
        boothId: sh.boothId,
        boothName: boothName(sh.boothId),
        staffId: who,
        staffName: staffName(who),
        diff,
      })
    }
  }
  for (const sh of shifts) {
    if (sh.status !== 'open') continue
    openShifts.push({
      shiftId: sh.id,
      dayKey: sh.dayKey,
      boothId: sh.boothId,
      boothName: boothName(sh.boothId),
      staffId: sh.staffId,
      staffName: staffName(sh.staffId),
      openedAt: sh.openedAt,
    })
  }
  openShifts.sort((a, b) => a.openedAt - b.openedAt)

  const byStaff = [...staffRows.values()]
    .map((r) => ({ ...r, sales: round2(r.sales), cashDiffTotal: round2(r.cashDiffTotal) }))
    .sort((a, b) => b.sales - a.sales || b.shiftsClosed - a.shiftsClosed || a.name.localeCompare(b.name, 'th'))

  // ---- expenses = Expense records + categorised cash-outs from the drawer
  const expByCat = emptyExpenseByCategory()
  let expTotal = 0
  let fromDrawer = 0
  const catOf = (c: ExpenseCategory): ExpenseCategory => (c in expByCat ? c : 'other')
  for (const e of expenseRows) {
    expByCat[catOf(e.category)] += e.amount
    expTotal += e.amount
  }
  for (const mv of moves) {
    if (mv.type !== 'out' || mv.category == null) continue
    expByCat[catOf(mv.category)] += mv.amount
    expTotal += mv.amount
    fromDrawer += mv.amount
  }
  for (const c of EXPENSE_CATEGORIES) expByCat[c] = round2(expByCat[c])
  const expenses: ReportExpenses = { total: round2(expTotal), byCategory: expByCat, fromDrawer: round2(fromDrawer) }

  // ---- goods received
  const stockIn = { lots: lots.length, qty: 0, cost: 0 }
  for (const l of lots) {
    stockIn.qty += l.qty
    stockIn.cost += Number.isFinite(l.totalCost) ? l.totalCost : l.qty * l.unitCost
  }
  stockIn.qty = round2(stockIn.qty)
  stockIn.cost = round2(stockIn.cost)

  return {
    from,
    to,
    boothId,
    days: days.length,
    totals,
    byMethod,
    byBooth,
    byTier,
    byCategory,
    byStaff,
    byHour: byHour.map(round2),
    byDay: days.map((d) => {
      const r = dayRows.get(d)!
      return { dayKey: d, sales: round2(r.sales), bills: r.bills }
    }),
    knownCostSales,
    cogs,
    grossProfit,
    cogsUnknownSales,
    expenses,
    netProfit: round2(grossProfit - expenses.total),
    cashDiffs,
    voids,
    stockIn,
    openShifts,
  }
}

export interface SlowMover {
  tier: Tier
  stock: TierStock
  /** null = never sold */
  daysSinceLastSale: number | null
}

/** Tracked tiers with stock on hand and no sale in the last `days` days (or never sold). Most stock first. */
export function slowMovers(tiers: Tier[], stock: Map<ID, TierStock>, today: DayKey, days = 30): SlowMover[] {
  const out: SlowMover[] = []
  for (const t of tiers) {
    if (t.deleted === 1 || t.trackStock !== 1) continue
    const s = stock.get(t.id)
    if (!s || !(s.onHand > 0)) continue
    const since = s.lastSold ? Math.max(0, diffDays(s.lastSold, today)) : null
    if (since != null && since < days) continue
    out.push({ tier: t, stock: s, daysSinceLastSale: since })
  }
  out.sort(
    (a, b) =>
      b.stock.onHand - a.stock.onHand ||
      (b.daysSinceLastSale ?? Infinity) - (a.daysSinceLastSale ?? Infinity) ||
      a.tier.sort - b.tier.sort,
  )
  return out
}

/**
 * Active tiers at or below their low-stock alert, lowest stock first. Only tiers whose stock has been
 * recorded (goods received or a count / correction) count: a new price button that tracks stock but was
 * never stocked has no known on-hand yet, and must not show up as "หมด" in reports and LINE summaries.
 */
export function lowStockList(tiers: Tier[], stock: Map<ID, TierStock>): { tier: Tier; stock: TierStock }[] {
  const out: { tier: Tier; stock: TierStock }[] = []
  for (const t of tiers) {
    if (t.deleted === 1 || t.active !== 1) continue
    const s = stock.get(t.id)
    if (!s || (s.received === 0 && s.adjusted === 0)) continue
    if (isLowStock(t, s)) out.push({ tier: t, stock: s })
  }
  out.sort((a, b) => a.stock.onHand - b.stock.onHand || a.tier.sort - b.tier.sort)
  return out
}
