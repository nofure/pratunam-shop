// Pure helpers for the owner reports page (unit-tested in logic.test.ts).
import type { DayKey, ID, PayMethod, Sale } from '../../types'
import type { ReportDayRow, ReportTierRow } from '../../domain/reports'
import { addDays, diffDays, fromDayKey, presetRange, todayKey, type DayRange } from '../../lib/dates'
import { baht, num, round2, thaiDate, thaiDateShort, timeHM, TH_MONTHS_SHORT } from '../../lib/format'

// ---------- range from the URL ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function validDay(k: string | null): k is DayKey {
  if (!k || !DAY_RE.test(k)) return false
  const d = fromDayKey(k)
  return !Number.isNaN(d.getTime()) && k === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Range from ?from=&to= (default: today). Swaps a reversed range. */
export function rangeFromParams(from: string | null, to: string | null, today: DayKey = todayKey()): DayRange {
  if (!validDay(from) || !validDay(to)) return presetRange('today', today)
  return from <= to ? { from, to } : { from: to, to: from }
}

export function rangeDays(r: DayRange): number {
  return diffDays(r.from, r.to) + 1
}

/** Ranges up to this many days are compared with the period just before. */
export const COMPARE_MAX_DAYS = 31

/** The period of equal length that ends the day before `r.from`. */
export function previousRange(r: DayRange): DayRange {
  const days = rangeDays(r)
  return { from: addDays(r.from, -days), to: addDays(r.from, -1) }
}

/** '29 ก.ย. 69' or '1 ก.ย. 69 – 29 ก.ย. 69'. */
export function rangeLabel(r: DayRange): string {
  return r.from === r.to ? thaiDate(r.from) : `${thaiDate(r.from)} – ${thaiDate(r.to)}`
}

// ---------- percentages ----------

/** Change from `prev` to `cur` in percent (1 decimal). null when there is nothing to compare with. */
export function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null
  return Math.round(((cur - prev) / prev) * 1000) / 10
}

function pctNumber(abs: number): string {
  return abs >= 10 ? num(Math.round(abs)) : num(abs, 1)
}

/** +12% / −3.5% / เท่าเดิม */
export function formatPct(p: number): string {
  if (p === 0) return 'เท่าเดิม'
  return `${p > 0 ? '+' : '−'}${pctNumber(Math.abs(p))}%`
}

/** Share of a total as '42%' ('0%' when the total is 0). */
export function sharePct(value: number, total: number): string {
  if (!(total > 0) || !Number.isFinite(value)) return '0%'
  const p = (value / total) * 100
  if (p > 0 && p < 1) return '<1%'
  return `${num(Math.round(p))}%`
}

/** Gross margin in percent (1 decimal), null when nothing with a known cost was sold. */
export function marginPct(grossProfit: number, knownCostSales: number): number | null {
  if (!(knownCostSales > 0)) return null
  return Math.round((grossProfit / knownCostSales) * 1000) / 10
}

// ---------- charts ----------

export interface ChartDatum {
  label: string
  value: number
  highlight?: boolean
}

/** Highlight the single highest positive value. */
function markBest(data: ChartDatum[]): ChartDatum[] {
  let best = -1
  data.forEach((d, i) => {
    if (d.value > 0 && (best < 0 || d.value > data[best].value)) best = i
  })
  return data.map((d, i) => (i === best ? { ...d, highlight: true } : d))
}

/** Ranges longer than this are charted per month instead of per day. */
export const DAILY_CHART_MAX_DAYS = 62

export function salesChartData(byDay: ReportDayRow[]): { mode: 'day' | 'month'; data: ChartDatum[] } {
  if (byDay.length > DAILY_CHART_MAX_DAYS) {
    const months = new Map<string, number>()
    for (const d of byDay) {
      const m = d.dayKey.slice(0, 7)
      months.set(m, (months.get(m) ?? 0) + d.sales)
    }
    const data = [...months.entries()].map(([m, v]) => {
      const [y, mo] = m.split('-').map(Number)
      return { label: `${TH_MONTHS_SHORT[mo - 1]} ${String(y + 543).slice(-2)}`, value: round2(v) }
    })
    return { mode: 'month', data: markBest(data) }
  }
  const short = byDay.length <= 7
  const data = byDay.map((d) => {
    const date = fromDayKey(d.dayKey)
    return {
      label: short ? thaiDateShort(d.dayKey) : `${date.getDate()} ${TH_MONTHS_SHORT[date.getMonth()]}`,
      value: d.sales,
    }
  })
  return { mode: 'day', data: markBest(data) }
}

/** Hour slots from the first to the last hour with sales ('9:00' … '20:00'). */
export function hourChartData(byHour: number[]): ChartDatum[] {
  let first = -1
  let last = -1
  byHour.forEach((v, h) => {
    if (v > 0) {
      if (first < 0) first = h
      last = h
    }
  })
  if (first < 0) return []
  const data: ChartDatum[] = []
  for (let h = first; h <= last; h++) data.push({ label: `${h}:00`, value: byHour[h] ?? 0 })
  return markBest(data)
}

/** Hour (0–23) with the highest sales, null if nothing sold. */
export function peakHour(byHour: number[]): number | null {
  let best: number | null = null
  byHour.forEach((v, h) => {
    if (v > 0 && (best === null || v > byHour[best])) best = h
  })
  return best
}

export function hourSpanLabel(h: number): string {
  return `${h}:00–${h + 1}:00`
}

/** Best day and the average over days that had sales. */
export function dayStats(byDay: ReportDayRow[]): { best: ReportDayRow | null; sellingDays: number; avgPerSellingDay: number } {
  let best: ReportDayRow | null = null
  let sellingDays = 0
  let total = 0
  for (const d of byDay) {
    if (d.bills > 0 || d.sales > 0) sellingDays += 1
    total += d.sales
    if (d.sales > 0 && (!best || d.sales > best.sales)) best = d
  }
  return { best, sellingDays, avgPerSellingDay: sellingDays > 0 ? round2(total / sellingDays) : 0 }
}

// ---------- tier table ----------

export type TierSort = 'sales' | 'qty' | 'profit'

export function sortTierRows(rows: ReportTierRow[], by: TierSort): ReportTierRow[] {
  const out = [...rows]
  const tie = (a: ReportTierRow, b: ReportTierRow) =>
    b.sales - a.sales || b.qty - a.qty || a.name.localeCompare(b.name, 'th') || a.price - b.price
  if (by === 'qty') out.sort((a, b) => b.qty - a.qty || tie(a, b))
  else if (by === 'profit')
    out.sort((a, b) => {
      if (a.profit == null && b.profit == null) return tie(a, b)
      if (a.profit == null) return 1
      if (b.profit == null) return -1
      return b.profit - a.profit || tie(a, b)
    })
  else out.sort(tie)
  return out
}

/** The unit of a category when all its rows share one ('ตัว'), else 'ชิ้น'. */
export function categoryUnit(byTier: ReportTierRow[], name: string): string {
  const units = new Set(byTier.filter((r) => r.name === name).map((r) => r.unit))
  return units.size === 1 ? [...units][0] || 'ชิ้น' : 'ชิ้น'
}

// ---------- CSV ----------

type Cell = string | number | null | undefined

export const BILLS_CSV_HEADER = [
  'วันที่',
  'เวลา',
  'แผง',
  'เลขบิล',
  'คนขาย',
  'รายการ',
  'ชิ้น',
  'ราคาเต็ม',
  'ส่วนลดโปร',
  'ลดให้ลูกค้า',
  'ยอดสุทธิ',
  'วิธีจ่าย',
  'สถานะ',
  'เหตุผลยกเลิก',
]

export function saleItemsText(s: Pick<Sale, 'items'>): string {
  return s.items
    .map((it) => {
      let t = `${it.name} ${baht(it.price)}×${num(it.qty, 2)}`
      if (round2(it.lineTotal) !== round2(it.fullTotal)) t += `=${baht(it.lineTotal)}`
      return t
    })
    .join('; ')
}

/** One row per bill (paid and voided), oldest first. Deleted bills are skipped. */
export function billsCsvRows(
  sales: Sale[],
  boothName: (id: ID) => string,
  staffName: (id: ID) => string,
  methodLabel: (m: PayMethod) => string,
): Cell[][] {
  const rows = sales
    .filter((s) => s.deleted !== 1)
    .sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : a.createdAt - b.createdAt))
    .map((s): Cell[] => [
      s.dayKey,
      timeHM(s.createdAt),
      boothName(s.boothId),
      s.billNo,
      staffName(s.staffId),
      saleItemsText(s),
      round2(s.pieces),
      round2(s.subtotal),
      round2(s.promoDiscount),
      round2(s.manualDiscount),
      round2(s.total),
      methodLabel(s.method),
      s.status === 'void' ? 'ยกเลิก' : 'จ่ายแล้ว',
      s.status === 'void' ? (s.voidReason ?? '') : '',
    ])
  return [BILLS_CSV_HEADER, ...rows]
}

export const TIERS_CSV_HEADER = ['แผง', 'ปุ่มราคา', 'ราคา', 'หน่วย', 'จำนวน', 'ยอดขาย', 'ทุน', 'กำไร']

export function tiersCsvRows(byTier: ReportTierRow[]): Cell[][] {
  return [
    TIERS_CSV_HEADER,
    ...byTier.map((r): Cell[] => [r.boothName, r.name, r.price, r.unit, r.qty, r.sales, r.cogs, r.profit]),
  ]
}

/** Safe piece of a file name (no path characters or spaces). */
export function fileNamePart(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/** 'บิล_2026-09-29.csv' / 'บิล_2026-09-01_ถึง_2026-09-29_แผง-A.csv' */
export function csvFileName(prefix: string, r: DayRange, boothName?: string | null): string {
  let name = `${prefix}_${r.from}`
  if (r.to !== r.from) name += `_ถึง_${r.to}`
  const booth = boothName ? fileNamePart(boothName) : ''
  if (booth) name += `_${booth}`
  return `${name}.csv`
}
