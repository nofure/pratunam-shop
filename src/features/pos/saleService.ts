// Writing bills: record a sale into the booth's open shift, and void a bill.
import { alive, db, patch, save } from '../../db'
import { cashChange, computeCart, type CartLine } from '../../domain/pricing'
import { nextBillNo } from '../../domain/shift'
import type { ID, PayMethod, Sale, Shift } from '../../types'

export type PosErrorCode = 'empty' | 'no-shift' | 'short' | 'not-found' | 'not-paid' | 'no-staff'

export class PosError extends Error {
  readonly code: PosErrorCode
  constructor(code: PosErrorCode) {
    super(code)
    this.code = code
    this.name = 'PosError'
  }
}

/** Thai message for a failed save / void. */
export function posErrorText(e: unknown): string {
  if (e instanceof PosError) {
    switch (e.code) {
      case 'empty':
        return 'ยังไม่มีของในตะกร้า'
      case 'no-shift':
        return 'ยังไม่ได้เปิดร้าน เปิดร้านก่อนแล้วค่อยขาย'
      case 'short':
        return 'เงินที่รับมายังไม่พอ'
      case 'not-found':
        return 'ไม่พบบิลนี้'
      case 'not-paid':
        return 'บิลนี้ถูกยกเลิกไปแล้ว'
      case 'no-staff':
        return 'ยังไม่ได้เข้าสู่ระบบ'
    }
  }
  return 'บันทึกไม่สำเร็จ ลองอีกครั้ง'
}

/** Latest open shift of a booth (read inside a transaction). */
async function openShiftOf(boothId: ID): Promise<Shift | null> {
  const rows = alive(await db.shifts.where('[boothId+status]').equals([boothId, 'open']).toArray())
  rows.sort((a, b) => b.openedAt - a.openedAt)
  return rows[0] ?? null
}

export interface RecordSaleInput {
  boothId: ID
  staffId: ID
  lines: CartLine[]
  manualDiscount: number
  method: PayMethod
  /** Cash only: amount handed over. null = exact amount (no change). Ignored for other methods. */
  cashReceived: number | null
}

/**
 * Save a paid bill into the booth's open shift. The shift and the next bill number are read inside
 * the same transaction so two quick sales can never get the same number.
 */
export async function recordSale(input: RecordSaleInput): Promise<Sale> {
  if (!input.staffId) throw new PosError('no-staff')
  const totals = computeCart(input.lines, input.manualDiscount)
  if (totals.items.length === 0 || totals.pieces <= 0) throw new PosError('empty')

  let cashReceived: number | null = null
  let change: number | null = null
  if (input.method === 'cash') {
    const received = input.cashReceived ?? totals.total
    if (!Number.isFinite(received)) throw new PosError('short')
    change = cashChange(totals.total, received)
    if (change < 0) throw new PosError('short')
    cashReceived = received
  }

  return db.transaction('rw', [db.sales, db.shifts], async () => {
    const shift = await openShiftOf(input.boothId)
    if (!shift) throw new PosError('no-shift')
    // Deleted rows are included on purpose: bill numbers are never reused.
    const inShift = await db.sales.where('shiftId').equals(shift.id).toArray()
    return save<Sale>(db.sales, {
      boothId: input.boothId,
      shiftId: shift.id,
      staffId: input.staffId,
      dayKey: shift.dayKey,
      billNo: nextBillNo(inShift),
      items: totals.items,
      pieces: totals.pieces,
      subtotal: totals.subtotal,
      promoDiscount: totals.promoDiscount,
      manualDiscount: totals.manualDiscount,
      total: totals.total,
      method: input.method,
      cashReceived,
      change,
      status: 'paid',
      voidReason: null,
      voidedAt: null,
      voidedBy: null,
      note: null,
    })
  })
}

/** Void a paid bill. The bill is re-read inside the transaction so it is voided only once. */
export async function voidSale(saleId: ID, reason: string, approverId: ID): Promise<Sale> {
  if (!approverId) throw new PosError('no-staff')
  return db.transaction('rw', [db.sales], async () => {
    const cur = await db.sales.get(saleId)
    if (!cur || cur.deleted === 1) throw new PosError('not-found')
    if (cur.status !== 'paid') throw new PosError('not-paid')
    const updated = await patch(db.sales, saleId, {
      status: 'void',
      voidReason: reason.trim() || 'อื่นๆ',
      voidedAt: Date.now(),
      voidedBy: approverId,
    })
    if (!updated) throw new PosError('not-found')
    return updated
  })
}
