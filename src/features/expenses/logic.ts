// Pure helpers for the expenses page (unit-tested in logic.test.ts).
import type { CashMove, DayKey, Expense, ExpenseCategory, ID } from '../../types'
import { EXPENSE_CATEGORIES } from '../../domain/reports'
import { addMonths, endOfMonth, fromDayKey, startOfMonth, toDayKey } from '../../lib/dates'
import { round2 } from '../../lib/format'

/** Categories that usually repeat every month (offered by "คัดลอกจากเดือนก่อน"). */
export const RECURRING_CATEGORIES: readonly ExpenseCategory[] = ['rent', 'electric', 'wage']

/** Earliest month the navigator goes back to. */
export const MIN_MONTH: DayKey = '2020-01-01'
export const NOTE_MAX = 120
export const AMOUNT_MAX = 9_999_999

/** 'all' = every booth plus whole-shop records; otherwise one booth id. */
export type BoothFilter = 'all' | ID

export function matchesBooth(filter: BoothFilter, boothId: ID | null): boolean {
  return filter === 'all' || boothId === filter
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** 'YYYY-MM-DD' that is a real calendar day (rejects '2026-02-30'). */
export function isValidDayKey(s: string): boolean {
  if (!DAY_RE.test(s)) return false
  return toDayKey(fromDayKey(s)) === s
}

/** Last month the navigator allows (next month, for rent paid in advance). */
export function maxMonth(today: DayKey): DayKey {
  return addMonths(today, 1)
}

/** Latest date an expense may be recorded for (end of next month). */
export function maxExpenseDay(today: DayKey): DayKey {
  return endOfMonth(addMonths(today, 1))
}

/** URL value '2026-08' → month start '2026-08-01', clamped to [MIN_MONTH, max]. Bad input → fallback. */
export function parseMonthParam(raw: string | null, fallback: DayKey, max: DayKey): DayKey {
  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) return fallback
  const k = `${raw}-01`
  if (!isValidDayKey(k)) return fallback
  if (k < MIN_MONTH) return MIN_MONTH
  if (k > max) return max
  return k
}

/** Month start '2026-08-01' → URL value '2026-08'. */
export function monthParam(month: DayKey): string {
  return month.slice(0, 7)
}

/** Same day number in another month, clamped to that month's last day (31 ม.ค. → 28 ก.พ.). */
export function moveDayToMonth(k: DayKey, targetMonth: DayKey): DayKey {
  const day = Number(k.slice(8, 10))
  const lastDay = Number(endOfMonth(targetMonth).slice(8, 10))
  const d = Math.min(Math.max(1, day), lastDay)
  return `${startOfMonth(targetMonth).slice(0, 8)}${String(d).padStart(2, '0')}`
}

/** Default date for a new expense while viewing `month`: today, the month's last day (past) or first day (future). */
export function defaultDayForMonth(month: DayKey, today: DayKey): DayKey {
  const m = startOfMonth(month)
  const t = startOfMonth(today)
  if (m === t) return today
  if (m < t) return endOfMonth(m)
  return m
}

export function sumAmount(rows: { amount: number }[]): number {
  return round2(rows.reduce((a, r) => a + (Number.isFinite(r.amount) ? r.amount : 0), 0))
}

/** Cash-outs from a drawer that were marked as a business expense (alive only). */
export function drawerExpenses(moves: CashMove[]): CashMove[] {
  return moves.filter((m) => m.deleted !== 1 && m.type === 'out' && m.category != null)
}

export interface DayGroup<T> {
  dayKey: DayKey
  rows: T[]
  total: number
}

/** Newest day first; inside a day, newest record first. */
export function groupByDay<T extends { dayKey: DayKey; amount: number; createdAt: number }>(rows: T[]): DayGroup<T>[] {
  const sorted = [...rows].sort((a, b) => (a.dayKey === b.dayKey ? b.createdAt - a.createdAt : a.dayKey < b.dayKey ? 1 : -1))
  const out: DayGroup<T>[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && last.dayKey === r.dayKey) last.rows.push(r)
    else out.push({ dayKey: r.dayKey, rows: [r], total: 0 })
  }
  for (const g of out) g.total = sumAmount(g.rows)
  return out
}

export interface CategoryRow {
  category: ExpenseCategory
  total: number
  count: number
  /** part of `total` paid from a drawer during a shift */
  fromDrawer: number
}

const knownCategory = (c: ExpenseCategory | null): ExpenseCategory =>
  c != null && (EXPENSE_CATEGORIES as string[]).includes(c) ? c : 'other'

/** Totals per category (records + drawer cash-outs), biggest first, zero categories left out. */
export function categoryTotals(
  expenses: Pick<Expense, 'category' | 'amount'>[],
  drawer: Pick<CashMove, 'category' | 'amount'>[],
): CategoryRow[] {
  const rows = new Map<ExpenseCategory, CategoryRow>()
  const row = (c: ExpenseCategory) => {
    let r = rows.get(c)
    if (!r) {
      r = { category: c, total: 0, count: 0, fromDrawer: 0 }
      rows.set(c, r)
    }
    return r
  }
  for (const e of expenses) {
    const r = row(knownCategory(e.category))
    r.total += e.amount
    r.count += 1
  }
  for (const m of drawer) {
    const r = row(knownCategory(m.category))
    r.total += m.amount
    r.fromDrawer += m.amount
    r.count += 1
  }
  return [...rows.values()]
    .map((r) => ({ ...r, total: round2(r.total), fromDrawer: round2(r.fromDrawer) }))
    .filter((r) => r.total !== 0)
    .sort((a, b) => b.total - a.total || EXPENSE_CATEGORIES.indexOf(a.category) - EXPENSE_CATEGORIES.indexOf(b.category))
}

export interface CopyCandidate {
  source: Expense
  /** same day number in the target month, clamped to its last day */
  targetDay: DayKey
  /** an identical entry (category, booth, amount, note) is already in the target month */
  exists: boolean
}

const copyKey = (e: Pick<Expense, 'category' | 'boothId' | 'amount' | 'note'>) =>
  `${e.category}|${e.boothId ?? ''}|${round2(e.amount)}|${(e.note ?? '').trim()}`

/**
 * Last month's recurring-looking entries (rent / electric / wage) to duplicate into `targetMonth`.
 * Entries already present in the target month are flagged `exists` (matched one-to-one, so three
 * copies of the same daily wage are only covered by three existing entries).
 */
export function copyCandidates(prev: Expense[], current: Expense[], targetMonth: DayKey): CopyCandidate[] {
  const from = startOfMonth(targetMonth)
  const to = endOfMonth(targetMonth)
  const have = new Map<string, number>()
  for (const e of current) {
    if (e.deleted === 1 || e.dayKey < from || e.dayKey > to) continue
    const k = copyKey(e)
    have.set(k, (have.get(k) ?? 0) + 1)
  }
  return prev
    .filter((e) => e.deleted !== 1 && RECURRING_CATEGORIES.includes(e.category) && e.amount > 0)
    .sort(
      (a, b) =>
        (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0) ||
        RECURRING_CATEGORIES.indexOf(a.category) - RECURRING_CATEGORIES.indexOf(b.category) ||
        a.createdAt - b.createdAt,
    )
    .map((source) => {
      const k = copyKey(source)
      const n = have.get(k) ?? 0
      if (n > 0) have.set(k, n - 1)
      return { source, targetDay: moveDayToMonth(source.dayKey, from), exists: n > 0 }
    })
}

// ---------- add / edit form ----------

export interface ExpenseDraft {
  dayKey: string
  category: ExpenseCategory | null
  amount: number | null
  boothId: ID | null
  note: string
}

export type DraftErrors = Partial<Record<'dayKey' | 'category' | 'amount' | 'note', string>>

export function validateDraft(d: ExpenseDraft, today: DayKey): DraftErrors {
  const errors: DraftErrors = {}
  if (!d.dayKey) errors.dayKey = 'เลือกวันที่'
  else if (!isValidDayKey(d.dayKey) || d.dayKey < MIN_MONTH) errors.dayKey = 'วันที่ไม่ถูกต้อง'
  else if (d.dayKey > maxExpenseDay(today)) errors.dayKey = 'เลือกได้ไม่เกินสิ้นเดือนหน้า'

  if (d.category == null) errors.category = 'เลือกประเภทค่าใช้จ่าย'

  if (d.amount == null || !Number.isFinite(d.amount) || d.amount === 0) errors.amount = 'ใส่จำนวนเงิน'
  else if (d.amount < 0) errors.amount = 'จำนวนเงินต้องมากกว่า 0'
  else if (d.amount > AMOUNT_MAX) errors.amount = 'จำนวนเงินมากเกินไป'

  if (d.note.trim().length > NOTE_MAX) errors.note = `หมายเหตุยาวเกิน ${NOTE_MAX} ตัวอักษร`
  return errors
}

export function hasErrors(e: DraftErrors): boolean {
  return Object.values(e).some(Boolean)
}

/** The stored fields a valid draft turns into. */
export function draftFields(d: ExpenseDraft): Pick<Expense, 'dayKey' | 'category' | 'amount' | 'boothId' | 'note'> {
  const note = d.note.trim()
  return {
    dayKey: d.dayKey,
    category: d.category ?? 'other',
    amount: round2(d.amount ?? 0),
    boothId: d.boothId,
    note: note === '' ? null : note,
  }
}

/** True when saving the draft would not change the record. */
export function sameAsRecord(d: ExpenseDraft, e: Expense): boolean {
  const f = draftFields(d)
  return (
    f.dayKey === e.dayKey &&
    f.category === e.category &&
    f.amount === round2(e.amount) &&
    f.boothId === e.boothId &&
    f.note === (e.note ?? null)
  )
}
