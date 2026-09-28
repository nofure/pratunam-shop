// Live data for one month of the expenses page (plus the month before, for comparison and copying).
import { useLiveQuery } from 'dexie-react-hooks'
import type { Booth, CashMove, DayKey, Expense, Staff } from '../../types'
import { alive, db } from '../../db'
import { addMonths, endOfMonth } from '../../lib/dates'
import { drawerExpenses } from './logic'

export interface ExpenseMonthData {
  month: DayKey
  /** alive Expense records of the month, every booth */
  expenses: Expense[]
  prevExpenses: Expense[]
  /** alive categorised drawer cash-outs of the month, every booth */
  drawer: CashMove[]
  prevDrawer: CashMove[]
  staff: Staff[]
}

export type ExpenseMonthState = { status: 'loading' } | { status: 'error' } | ({ status: 'ready' } & ExpenseMonthData)

type QueryResult = { month: DayKey; ok: false } | ({ ok: true } & ExpenseMonthData)

export function useExpenseMonth(month: DayKey): ExpenseMonthState {
  const res = useLiveQuery<QueryResult>(async () => {
    try {
      const to = endOfMonth(month)
      const prev = addMonths(month, -1)
      const [expenses, moves, staff] = await Promise.all([
        db.expenses.where('dayKey').between(prev, to, true, true).toArray(),
        db.cashMoves.where('dayKey').between(prev, to, true, true).toArray(),
        db.staff.toArray(),
      ])
      const exp = alive(expenses)
      const drawer = drawerExpenses(moves)
      const inMonth = (k: DayKey) => k >= month && k <= to
      return {
        ok: true,
        month,
        expenses: exp.filter((e) => inMonth(e.dayKey)),
        prevExpenses: exp.filter((e) => !inMonth(e.dayKey)),
        drawer: drawer.filter((m) => inMonth(m.dayKey)),
        prevDrawer: drawer.filter((m) => !inMonth(m.dayKey)),
        staff,
      }
    } catch (err) {
      console.error('expenses: load failed', err)
      return { ok: false, month }
    }
  }, [month])

  // While a newly picked month loads, don't show the previous month's rows under the new label.
  if (!res || res.month !== month) return { status: 'loading' }
  if (!res.ok) return { status: 'error' }
  return {
    status: 'ready',
    month: res.month,
    expenses: res.expenses,
    prevExpenses: res.prevExpenses,
    drawer: res.drawer,
    prevDrawer: res.prevDrawer,
    staff: res.staff,
  }
}

/** Every booth row, inactive and deleted included (to name old records). `undefined` while loading. */
export function useAllBooths(): Booth[] | undefined {
  return useLiveQuery(async () => {
    try {
      const rows = await db.booths.toArray()
      return rows.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'th'))
    } catch (err) {
      console.error('expenses: booths load failed', err)
      return []
    }
  }, [])
}
