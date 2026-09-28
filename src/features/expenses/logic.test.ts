import { describe, expect, it } from 'vitest'
import type { CashMove, Expense } from '../../types'
import {
  categoryTotals,
  copyCandidates,
  defaultDayForMonth,
  draftFields,
  drawerExpenses,
  groupByDay,
  hasErrors,
  isValidDayKey,
  matchesBooth,
  maxExpenseDay,
  monthParam,
  moveDayToMonth,
  parseMonthParam,
  sameAsRecord,
  sumAmount,
  validateDraft,
  type ExpenseDraft,
} from './logic'

let seq = 0
function exp(p: Partial<Expense> = {}): Expense {
  seq += 1
  return {
    id: `e${seq}`,
    createdAt: 1_000 + seq,
    updatedAt: 1_000 + seq,
    deviceId: 'test',
    deleted: 0,
    synced: 0,
    boothId: null,
    dayKey: '2026-08-01',
    category: 'rent',
    amount: 3000,
    note: null,
    staffId: null,
    ...p,
  }
}

function move(p: Partial<CashMove> = {}): CashMove {
  seq += 1
  return {
    id: `m${seq}`,
    createdAt: 1_000 + seq,
    updatedAt: 1_000 + seq,
    deviceId: 'test',
    deleted: 0,
    synced: 0,
    shiftId: 's1',
    boothId: 'b1',
    staffId: 'st1',
    dayKey: '2026-09-10',
    type: 'out',
    amount: 60,
    reason: 'ค่าข้าวคนขาย',
    category: 'food',
    ...p,
  }
}

describe('dates', () => {
  it('validates real calendar days', () => {
    expect(isValidDayKey('2026-09-29')).toBe(true)
    expect(isValidDayKey('2024-02-29')).toBe(true)
    expect(isValidDayKey('2026-02-29')).toBe(false)
    expect(isValidDayKey('2026-13-01')).toBe(false)
    expect(isValidDayKey('2026-9-1')).toBe(false)
    expect(isValidDayKey('')).toBe(false)
  })

  it('moves a day into another month, clamped to month end', () => {
    expect(moveDayToMonth('2026-01-31', '2026-02-01')).toBe('2026-02-28')
    expect(moveDayToMonth('2024-01-31', '2024-02-01')).toBe('2024-02-29')
    expect(moveDayToMonth('2026-08-31', '2026-09-01')).toBe('2026-09-30')
    expect(moveDayToMonth('2026-08-05', '2026-09-01')).toBe('2026-09-05')
    expect(moveDayToMonth('2026-11-30', '2026-12-01')).toBe('2026-12-30')
    expect(moveDayToMonth('2026-12-15', '2027-01-01')).toBe('2027-01-15')
  })

  it('picks the default date for the viewed month', () => {
    expect(defaultDayForMonth('2026-09-01', '2026-09-29')).toBe('2026-09-29')
    expect(defaultDayForMonth('2026-08-01', '2026-09-29')).toBe('2026-08-31')
    expect(defaultDayForMonth('2026-02-01', '2026-09-29')).toBe('2026-02-28')
    expect(defaultDayForMonth('2026-10-01', '2026-09-29')).toBe('2026-10-01')
  })

  it('parses the month URL value', () => {
    const fallback = '2026-09-01'
    const max = '2026-10-01'
    expect(parseMonthParam('2026-08', fallback, max)).toBe('2026-08-01')
    expect(parseMonthParam(null, fallback, max)).toBe(fallback)
    expect(parseMonthParam('abc', fallback, max)).toBe(fallback)
    expect(parseMonthParam('2026-13', fallback, max)).toBe(fallback)
    expect(parseMonthParam('2027-05', fallback, max)).toBe(max)
    expect(parseMonthParam('2001-05', fallback, max)).toBe('2020-01-01')
    expect(monthParam('2026-08-01')).toBe('2026-08')
  })

  it('limits expense dates to the end of next month', () => {
    expect(maxExpenseDay('2026-09-29')).toBe('2026-10-31')
    expect(maxExpenseDay('2026-12-10')).toBe('2027-01-31')
  })
})

describe('filters and totals', () => {
  it('matches booths', () => {
    expect(matchesBooth('all', null)).toBe(true)
    expect(matchesBooth('all', 'b1')).toBe(true)
    expect(matchesBooth('b1', 'b1')).toBe(true)
    expect(matchesBooth('b1', null)).toBe(false)
    expect(matchesBooth('b1', 'b2')).toBe(false)
  })

  it('sums without float artifacts', () => {
    expect(sumAmount([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3)
    expect(sumAmount([])).toBe(0)
  })

  it('keeps only categorised, alive cash-outs', () => {
    const rows = [
      move({ id: 'a' }),
      move({ id: 'b', category: null }),
      move({ id: 'c', type: 'in', category: null }),
      move({ id: 'd', deleted: 1 }),
    ]
    expect(drawerExpenses(rows).map((m) => m.id)).toEqual(['a'])
  })

  it('groups by day, newest first', () => {
    const a = exp({ dayKey: '2026-09-01', amount: 100, createdAt: 1 })
    const b = exp({ dayKey: '2026-09-03', amount: 50.5, createdAt: 2 })
    const c = exp({ dayKey: '2026-09-01', amount: 20, createdAt: 3 })
    const g = groupByDay([a, b, c])
    expect(g.map((x) => x.dayKey)).toEqual(['2026-09-03', '2026-09-01'])
    expect(g[1].rows.map((r) => r.id)).toEqual([c.id, a.id])
    expect(g[1].total).toBe(120)
    expect(g[0].total).toBe(50.5)
  })

  it('totals by category including drawer cash-outs', () => {
    const rows = categoryTotals(
      [exp({ category: 'rent', amount: 3000 }), exp({ category: 'food', amount: 40 })],
      [move({ category: 'food', amount: 60 }), move({ category: 'supplies', amount: 0 })],
    )
    expect(rows).toEqual([
      { category: 'rent', total: 3000, count: 1, fromDrawer: 0 },
      { category: 'food', total: 100, count: 2, fromDrawer: 60 },
    ])
  })
})

describe('copy from last month', () => {
  it('offers rent / electric / wage with dates moved and clamped', () => {
    const prev = [
      exp({ id: 'rent', category: 'rent', dayKey: '2026-08-31', amount: 4500 }),
      exp({ id: 'elec', category: 'electric', dayKey: '2026-08-05', amount: 320.5 }),
      exp({ id: 'food', category: 'food', dayKey: '2026-08-02', amount: 50 }),
      exp({ id: 'gone', category: 'wage', dayKey: '2026-08-10', amount: 400, deleted: 1 }),
    ]
    const c = copyCandidates(prev, [], '2026-09-01')
    expect(c.map((x) => [x.source.id, x.targetDay, x.exists])).toEqual([
      ['elec', '2026-09-05', false],
      ['rent', '2026-09-30', false],
    ])
  })

  it('flags entries already in the target month one-to-one', () => {
    const prev = [
      exp({ category: 'wage', dayKey: '2026-08-01', amount: 400, boothId: 'b1', createdAt: 1 }),
      exp({ category: 'wage', dayKey: '2026-08-02', amount: 400, boothId: 'b1', createdAt: 2 }),
      exp({ category: 'rent', dayKey: '2026-08-01', amount: 3000, boothId: 'b1', note: 'แผง A' }),
    ]
    const current = [
      exp({ category: 'wage', dayKey: '2026-09-01', amount: 400, boothId: 'b1' }),
      exp({ category: 'rent', dayKey: '2026-09-01', amount: 3000, boothId: 'b2', note: 'แผง A' }),
      exp({ category: 'wage', dayKey: '2026-08-15', amount: 400, boothId: 'b1' }),
    ]
    const c = copyCandidates(prev, current, '2026-09-01')
    expect(c.map((x) => [x.source.category, x.targetDay, x.exists])).toEqual([
      ['rent', '2026-09-01', false],
      ['wage', '2026-09-01', true],
      ['wage', '2026-09-02', false],
    ])
  })
})

describe('form', () => {
  const today = '2026-09-29'
  const ok: ExpenseDraft = { dayKey: '2026-09-29', category: 'rent', amount: 3000, boothId: null, note: '  เดือน ก.ย. ' }

  it('accepts a valid draft', () => {
    expect(hasErrors(validateDraft(ok, today))).toBe(false)
    expect(draftFields(ok)).toEqual({ dayKey: '2026-09-29', category: 'rent', amount: 3000, boothId: null, note: 'เดือน ก.ย.' })
  })

  it('reports each missing or bad field', () => {
    const e = validateDraft({ dayKey: '', category: null, amount: null, boothId: null, note: '' }, today)
    expect(Object.keys(e).sort()).toEqual(['amount', 'category', 'dayKey'])
    expect(validateDraft({ ...ok, amount: 0 }, today).amount).toBeTruthy()
    expect(validateDraft({ ...ok, amount: -5 }, today).amount).toBeTruthy()
    expect(validateDraft({ ...ok, amount: 10_000_000 }, today).amount).toBeTruthy()
    expect(validateDraft({ ...ok, dayKey: '2026-11-01' }, today).dayKey).toBeTruthy()
    expect(validateDraft({ ...ok, dayKey: '2026-10-31' }, today).dayKey).toBeUndefined()
    expect(validateDraft({ ...ok, dayKey: '2019-12-31' }, today).dayKey).toBeTruthy()
    expect(validateDraft({ ...ok, note: 'ก'.repeat(121) }, today).note).toBeTruthy()
  })

  it('detects an unchanged edit', () => {
    const rec = exp({ dayKey: '2026-09-29', category: 'rent', amount: 3000, boothId: null, note: 'เดือน ก.ย.' })
    expect(sameAsRecord(ok, rec)).toBe(true)
    expect(sameAsRecord({ ...ok, amount: 3001 }, rec)).toBe(false)
    expect(sameAsRecord({ ...ok, note: '' }, rec)).toBe(false)
  })
})
