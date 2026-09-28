// Shift writes (open / close / cash moves) and helpers shared by the shift pages.
// Every write re-checks the shift inside a Dexie transaction so two devices (or a
// double tap) can't open two shifts for a booth or add money to a closed shift.
import { alive, db as defaultDb, patch, remove, save, type ShopDB } from '../../db'
import { DENOMINATIONS } from '../../constants'
import { computeShiftTotals, topItems } from '../../domain/shift'
import { shiftSummaryText } from '../../domain/summary'
import { todayKey } from '../../lib/dates'
import { round2 } from '../../lib/format'
import type { CashMove, ExpenseCategory, ID, Sale, Shift, ShiftTotals, ShopConfig } from '../../types'

export type ShiftErrorCode = 'already_open' | 'not_open' | 'changed' | 'not_allowed' | 'invalid'

export class ShiftError extends Error {
  readonly code: ShiftErrorCode
  readonly shift: Shift | undefined
  constructor(code: ShiftErrorCode, shift?: Shift) {
    super(`shift:${code}`)
    this.name = 'ShiftError'
    this.code = code
    this.shift = shift
  }
}

export function isShiftError(e: unknown, code?: ShiftErrorCode): e is ShiftError {
  return e instanceof ShiftError && (code === undefined || e.code === code)
}

/** Open shifts of a booth, newest first (normally 0 or 1; 2+ only after a sync conflict). */
export async function findOpenShifts(boothId: ID, database: ShopDB = defaultDb): Promise<Shift[]> {
  const rows = alive(await database.shifts.where('[boothId+status]').equals([boothId, 'open']).toArray())
  return rows.sort((a, b) => b.openedAt - a.openedAt)
}

// ---------------------------------------------------------------- open

export interface OpenShiftInput {
  boothId: ID
  staffId: ID
  openingFloat: number
  now?: number
}

/** Start a shift for a booth. Throws ShiftError('already_open') if the booth already has one. */
export async function openShift(i: OpenShiftInput, database: ShopDB = defaultDb): Promise<Shift> {
  const float = round2(i.openingFloat)
  if (!i.boothId || !i.staffId || !Number.isFinite(float) || float < 0) throw new ShiftError('invalid')
  const now = i.now ?? Date.now()
  return database.transaction('rw', database.shifts, async () => {
    const open = await findOpenShifts(i.boothId, database)
    if (open.length > 0) throw new ShiftError('already_open', open[0])
    return save(database.shifts, {
      boothId: i.boothId,
      staffId: i.staffId,
      dayKey: todayKey(new Date(now)),
      openedAt: now,
      openingFloat: float,
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
    })
  })
}

// ---------------------------------------------------------------- close

/** Numbers the person saw on screen; closing is refused if they changed meanwhile. */
export interface SeenTotals {
  expectedCash: number
  transfer: number
  halfhalf: number
}

export interface CloseShiftInput {
  shiftId: ID
  staffId: ID
  countedCash: number
  /** null = the total was typed in, not counted note by note */
  denominations: Record<string, number> | null
  seen: SeenTotals
  transferChecked: boolean
  halfhalfChecked: boolean
  note: string
  now?: number
}

export interface ClosedShift {
  shift: Shift
  sales: Sale[]
  moves: CashMove[]
}

/** Keep only known denominations with a positive whole count. null when nothing is left. */
export function cleanDenominations(d: Record<string, number> | null | undefined): Record<string, number> | null {
  if (!d) return null
  const out: Record<string, number> = {}
  for (const value of DENOMINATIONS) {
    const count = Math.floor(Number(d[String(value)] ?? 0))
    if (Number.isFinite(count) && count > 0) out[String(value)] = count
  }
  return Object.keys(out).length ? out : null
}

/**
 * Close a shift: re-read its bills and cash moves, freeze the totals in `snapshot`, store the
 * cash count and difference. Throws ShiftError('not_open') if it was closed already and
 * ShiftError('changed') if new bills / cash moves arrived after the person checked the numbers.
 */
export async function closeShift(i: CloseShiftInput, database: ShopDB = defaultDb): Promise<ClosedShift> {
  const counted = round2(i.countedCash)
  if (!i.shiftId || !i.staffId || !Number.isFinite(counted) || counted < 0) throw new ShiftError('invalid')
  const now = i.now ?? Date.now()
  return database.transaction('rw', [database.shifts, database.sales, database.cashMoves], async () => {
    const cur = await database.shifts.get(i.shiftId)
    if (!cur || cur.deleted === 1 || cur.status !== 'open') throw new ShiftError('not_open', cur)
    const sales = alive(await database.sales.where('shiftId').equals(cur.id).toArray())
    const moves = alive(await database.cashMoves.where('shiftId').equals(cur.id).toArray())
    const totals = computeShiftTotals(cur.openingFloat, sales, moves)
    if (
      round2(totals.expectedCash) !== round2(i.seen.expectedCash) ||
      round2(totals.byMethod.transfer) !== round2(i.seen.transfer) ||
      round2(totals.byMethod.halfhalf) !== round2(i.seen.halfhalf)
    ) {
      throw new ShiftError('changed', cur)
    }
    const note = i.note.trim()
    const updated = await patch(database.shifts, cur.id, {
      status: 'closed',
      closedAt: Math.max(now, cur.openedAt),
      closedBy: i.staffId,
      countedCash: counted,
      denominations: i.denominations ? cleanDenominations(i.denominations) : null,
      expectedCash: totals.expectedCash,
      cashDiff: round2(counted - totals.expectedCash),
      transferChecked: i.transferChecked && totals.byMethod.transfer > 0 ? 1 : 0,
      halfhalfChecked: i.halfhalfChecked && totals.byMethod.halfhalf > 0 ? 1 : 0,
      note: note ? note : null,
      snapshot: totals,
    })
    if (!updated) throw new ShiftError('not_open', cur)
    return { shift: updated, sales, moves }
  })
}

// ---------------------------------------------------------------- cash moves

export interface CashMoveInput {
  shiftId: ID
  staffId: ID
  type: 'in' | 'out'
  amount: number
  reason: string
  category: ExpenseCategory | null
}

/** Record money put into / taken out of the drawer of an open shift. */
export async function addCashMove(i: CashMoveInput, database: ShopDB = defaultDb): Promise<CashMove> {
  const amount = round2(i.amount)
  const reason = i.reason.trim()
  if (!i.shiftId || !i.staffId || !Number.isFinite(amount) || amount <= 0 || !reason) throw new ShiftError('invalid')
  if (i.type !== 'in' && i.type !== 'out') throw new ShiftError('invalid')
  return database.transaction('rw', [database.shifts, database.cashMoves], async () => {
    const shift = await database.shifts.get(i.shiftId)
    if (!shift || shift.deleted === 1 || shift.status !== 'open') throw new ShiftError('not_open', shift)
    return save(database.cashMoves, {
      shiftId: shift.id,
      boothId: shift.boothId,
      staffId: i.staffId,
      dayKey: shift.dayKey,
      type: i.type,
      amount,
      reason,
      category: i.type === 'out' ? i.category : null,
    })
  })
}

export interface Actor {
  id: ID
  isOwner: boolean
}

/**
 * Who may delete a cash move: the owner at any time (a closed shift keeps its frozen totals),
 * the person who recorded it only while the shift is still open.
 */
export function canDeleteMove(move: Pick<CashMove, 'staffId'>, shiftOpen: boolean, actor: Actor | null | undefined): boolean {
  if (!actor) return false
  if (actor.isOwner) return true
  return shiftOpen && move.staffId === actor.id
}

export async function deleteCashMove(moveId: ID, actor: Actor, database: ShopDB = defaultDb): Promise<void> {
  await database.transaction('rw', [database.shifts, database.cashMoves], async () => {
    const mv = await database.cashMoves.get(moveId)
    if (!mv || mv.deleted === 1) return
    const shift = await database.shifts.get(mv.shiftId)
    const open = !!shift && shift.deleted !== 1 && shift.status === 'open'
    if (!canDeleteMove(mv, open, actor)) throw new ShiftError('not_allowed', shift)
    await remove(database.cashMoves, moveId)
  })
}

// ---------------------------------------------------------------- read helpers

/** Frozen totals of a closed shift, live totals of an open one. */
export function shiftTotalsOf(shift: Shift, sales: Sale[], moves: CashMove[]): ShiftTotals {
  if (shift.status === 'closed' && shift.snapshot) return shift.snapshot
  return computeShiftTotals(shift.openingFloat, sales, moves)
}

/** LINE / share text for a shift (closer's name for closed shifts, opener's for open ones). */
export function buildShiftText(o: {
  shop: ShopConfig | null | undefined
  boothName: string
  staffName: (id: ID | null) => string
  shift: Shift
  sales: Sale[]
  moves: CashMove[]
}): string {
  const { shift } = o
  const closed = shift.status === 'closed'
  return shiftSummaryText({
    shopName: o.shop?.name ?? '',
    boothName: o.boothName,
    staffName: o.staffName(closed ? (shift.closedBy ?? shift.staffId) : shift.staffId),
    shift,
    totals: shiftTotalsOf(shift, o.sales, o.moves),
    top: topItems(o.sales, 3),
    otherLabel: o.shop?.otherPayEnabled === 1 ? o.shop.otherPayLabel : undefined,
  })
}

/** 'แบงก์' for notes, 'เหรียญ' for coins. */
export function denominationKind(value: number): string {
  return value >= 20 ? 'แบงก์' : 'เหรียญ'
}

// ---------------------------------------------------------------- close draft
// Counting a drawer takes minutes; keep the count if the sheet is closed or the page reloads.

export interface CloseDraft {
  mode: 'count' | 'total'
  counts: Record<string, number>
  totalText: string
  note: string
  transferChecked: boolean
  halfhalfChecked: boolean
}

export function emptyCloseDraft(): CloseDraft {
  return { mode: 'count', counts: {}, totalText: '', note: '', transferChecked: false, halfhalfChecked: false }
}

const DRAFT_PREFIX = 'pratunam.shift.closeDraft.'

export function loadCloseDraft(shiftId: ID): CloseDraft {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + shiftId)
    if (!raw) return emptyCloseDraft()
    const p = JSON.parse(raw) as Partial<CloseDraft>
    const base = emptyCloseDraft()
    return {
      mode: p.mode === 'total' ? 'total' : 'count',
      counts: cleanDenominations(p.counts ?? null) ?? {},
      totalText: typeof p.totalText === 'string' && /^\d{0,9}$/.test(p.totalText) ? p.totalText : base.totalText,
      note: typeof p.note === 'string' ? p.note : base.note,
      transferChecked: p.transferChecked === true,
      halfhalfChecked: p.halfhalfChecked === true,
    }
  } catch {
    return emptyCloseDraft()
  }
}

export function saveCloseDraft(shiftId: ID, d: CloseDraft): void {
  try {
    sessionStorage.setItem(DRAFT_PREFIX + shiftId, JSON.stringify(d))
  } catch {
    /* storage unavailable — the draft just lives in memory */
  }
}

export function clearCloseDraft(shiftId: ID): void {
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + shiftId)
  } catch {
    /* ignore */
  }
}
