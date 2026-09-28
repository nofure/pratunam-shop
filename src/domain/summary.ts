// Plain-text summaries to send to the owner on LINE. Short lines, plain Thai, no emoji.
import type { DayKey, Shift, ShiftTotals, Tier } from '../types'
import { baht, num, round2, thaiDate, timeHM } from '../lib/format'
import { cashDiffText, type topItems } from './shift'
import type { Report } from './reports'
import type { TierStock } from './stock'

const MAX_TOP = 3
const MAX_LOW = 5
const MAX_DIFFS = 5

/** 'ประตูน้ำ' → 'ร้านประตูน้ำ'; keeps names that already start with ร้าน. */
export function shopTitle(name: string): string {
  const n = (name ?? '').trim()
  if (!n) return 'ร้าน'
  if (n.startsWith('ร้าน')) return n
  return /^[฀-๿]/.test(n) ? `ร้าน${n}` : `ร้าน ${n}`
}

function itemLabel(name: string, price: number, qty: number): string {
  return `${name} ${baht(price)} ×${num(qty, 2)}`
}

function methodsLine(m: ShiftTotals['byMethod'], otherLabel?: string): string {
  let s = `เงินสด ${baht(m.cash)} · โอน ${baht(m.transfer)} · คนละครึ่ง ${baht(m.halfhalf)}`
  if (round2(m.other) > 0) s += ` · ${otherLabel?.trim() || 'อื่นๆ'} ${baht(m.other)}`
  return s
}

function discountVoidLine(manualDiscount: number, voidBills: number, voidTotal: number): string | null {
  const parts: string[] = []
  if (round2(manualDiscount) > 0) parts.push(`ลดราคา ${baht(manualDiscount)}`)
  if (voidBills > 0) parts.push(`ยกเลิก ${voidBills} บิล (${baht(voidTotal)})`)
  return parts.length ? parts.join(' · ') : null
}

function profitLabel(kind: 'ขั้นต้น' | 'สุทธิ', n: number): string {
  const r = round2(n)
  return r < 0 ? `ขาดทุน${kind} ${baht(-r)}` : `กำไร${kind} ${baht(r)}`
}

export function shiftSummaryText(o: {
  shopName: string
  boothName: string
  staffName: string
  shift: Shift
  totals: ShiftTotals
  top: ReturnType<typeof topItems>
  /** label for the "other" payment method (shop setting) */
  otherLabel?: string
}): string {
  const { shift, totals: t } = o
  const closed = shift.status === 'closed' && shift.closedAt != null
  const lines: string[] = []

  lines.push(`${shopTitle(o.shopName)} · ${o.boothName}`)
  const date = thaiDate(shift.dayKey)
  lines.push(
    closed
      ? `ปิดยอด ${date} (${timeHM(shift.openedAt)}–${timeHM(shift.closedAt as number)}) โดย ${o.staffName}`
      : `ยังไม่ปิดยอด ${date} (เปิด ${timeHM(shift.openedAt)}) · ${o.staffName}`,
  )
  lines.push(`ยอดขาย ${baht(t.total)} บาท · ${t.bills} บิล · ${num(t.pieces, 2)} ชิ้น`)
  lines.push(methodsLine(t.byMethod, o.otherLabel))

  let floatLine = `เงินทอนตั้งต้น ${baht(shift.openingFloat)}`
  if (round2(t.cashIn) > 0) floatLine += ` · เงินเข้า ${baht(t.cashIn)}`
  if (round2(t.cashOut) > 0) floatLine += ` · เงินออก ${baht(t.cashOut)}`
  lines.push(floatLine)

  const expected = closed && shift.expectedCash != null ? shift.expectedCash : t.expectedCash
  if (shift.countedCash != null) {
    const diff = shift.cashDiff ?? round2(shift.countedCash - expected)
    lines.push(`เงินสดควรมี ${baht(expected)} นับได้ ${baht(shift.countedCash)} → ${cashDiffText(diff)}`)
  } else {
    lines.push(`เงินสดควรมี ${baht(expected)}`)
  }

  const dv = discountVoidLine(t.manualDiscount, t.voidBills, t.voidTotal)
  if (dv) lines.push(dv)

  if (closed) {
    const unchecked: string[] = []
    if (round2(t.byMethod.transfer) > 0 && shift.transferChecked !== 1) unchecked.push('ยอดโอน')
    if (round2(t.byMethod.halfhalf) > 0 && shift.halfhalfChecked !== 1) unchecked.push('คนละครึ่ง')
    if (unchecked.length) lines.push(`ยังไม่ได้เช็ก${unchecked.join(' และ ')}`)
  }

  if (o.top.length) {
    lines.push('ขายดี: ' + o.top.slice(0, MAX_TOP).map((i) => itemLabel(i.name, i.price, i.qty)).join(', '))
  }
  const note = shift.note?.trim()
  if (note) lines.push(`หมายเหตุ: ${note}`)
  return lines.join('\n')
}

export function daySummaryText(o: {
  shopName: string
  dayKey: DayKey
  report: Report
  low: { tier: Tier; stock: TierStock }[]
  otherLabel?: string
}): string {
  const r = o.report
  const isRange = r.from !== r.to
  const when = isRange ? `${thaiDate(r.from)} – ${thaiDate(r.to)}` : thaiDate(o.dayKey)
  const boothLabel = r.boothId ? (r.byBooth.find((b) => b.boothId === r.boothId)?.name ?? null) : null
  const lines: string[] = []

  lines.push([shopTitle(o.shopName), boothLabel, `สรุป ${when}`].filter(Boolean).join(' · '))

  const t = r.totals
  if (t.bills === 0) {
    lines.push('ยังไม่มียอดขาย')
  } else {
    if (!r.boothId && r.byBooth.length > 1) {
      for (const b of r.byBooth) lines.push(`${b.name} ${baht(b.sales)} บาท · ${b.bills} บิล`)
    }
    lines.push(`รวม ${baht(t.sales)} บาท · ${t.bills} บิล · ${num(t.pieces, 2)} ชิ้น`)
    lines.push(methodsLine(r.byMethod, o.otherLabel))
  }
  const dv = discountVoidLine(t.manualDiscount, t.voidBills, t.voidTotal)
  if (dv) lines.push(dv)

  const costKnown = r.knownCostSales > 0
  if (costKnown) {
    let g = profitLabel('ขั้นต้น', r.grossProfit)
    if (r.cogsUnknownSales > 0) g += ` (ไม่รวมยอด ${baht(r.cogsUnknownSales)} ที่ไม่มีต้นทุน)`
    lines.push(g)
  }
  if (r.expenses.total > 0) lines.push(`ค่าใช้จ่าย ${baht(r.expenses.total)}`)
  // Net profit only when every sale has a known cost; otherwise it would look like a loss.
  if (costKnown && round2(r.cogsUnknownSales) === 0) lines.push(profitLabel('สุทธิ', r.netProfit))

  const top = [...r.byTier].sort((a, b) => b.qty - a.qty || b.sales - a.sales).slice(0, MAX_TOP)
  if (top.length) lines.push('ขายดี: ' + top.map((i) => itemLabel(i.name, i.price, i.qty)).join(', '))

  if (r.cashDiffs.length) {
    lines.push('เงินสดไม่ตรง:')
    for (const d of r.cashDiffs.slice(0, MAX_DIFFS)) {
      lines.push(`- ${isRange ? thaiDate(d.dayKey) + ' ' : ''}${d.boothName} ${d.staffName} ${cashDiffText(d.diff)}`)
    }
    if (r.cashDiffs.length > MAX_DIFFS) lines.push(`- และอีก ${r.cashDiffs.length - MAX_DIFFS} ครั้ง`)
  }

  if (r.openShifts.length) {
    const names = [...new Set(r.openShifts.map((s) => s.boothName))]
    lines.push(`ยังไม่ปิดยอด: ${names.join(', ')}`)
  }

  if (o.low.length) {
    const shown = o.low
      .slice(0, MAX_LOW)
      .map((l) => `${l.tier.name} ${baht(l.tier.price)} เหลือ ${num(l.stock.onHand, 2)}`)
    let s = 'ของใกล้หมด: ' + shown.join(', ')
    if (o.low.length > MAX_LOW) s += ` และอีก ${o.low.length - MAX_LOW} รายการ`
    lines.push(s)
  }
  return lines.join('\n')
}

/** Opens LINE's share screen with the text (works in the LINE app and on the web). */
export function lineShareUrl(text: string): string {
  return 'https://line.me/R/share?text=' + encodeURIComponent(text)
}
