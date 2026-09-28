// Number and Thai date formatting.
import type { DayKey } from '../types'
import { fromDayKey } from './dates'

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Round to satang (2 decimals) to avoid float artifacts. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** 1234 → "1,234"; 25.5 → "25.50". No currency sign. */
export function baht(n: number): string {
  const r = round2(n)
  return Number.isInteger(r) ? nf0.format(r) : nf2.format(r)
}

/** 1234 → "฿1,234"; -20 → "−฿20". */
export function bahtSign(n: number): string {
  return (n < 0 ? '−' : '') + '฿' + baht(Math.abs(n))
}

/** Signed amount for differences: +20 / −20 / 0. */
export function signed(n: number): string {
  const r = round2(n)
  if (r === 0) return '0'
  return (r > 0 ? '+' : '−') + baht(Math.abs(r))
}

export function num(n: number, digits = 0): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n)
}

export const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
export const TH_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
]
export const TH_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์']
export const TH_WEEKDAYS_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.']

/** '2026-09-29' → '29 ก.ย. 69' (Buddhist year, 2 digits). */
export function thaiDate(k: DayKey): string {
  const d = fromDayKey(k)
  return `${d.getDate()} ${TH_MONTHS_SHORT[d.getMonth()]} ${String(d.getFullYear() + 543).slice(-2)}`
}

/** '2026-09-29' → 'จ. 29 ก.ย.' (for charts / compact lists). */
export function thaiDateShort(k: DayKey): string {
  const d = fromDayKey(k)
  return `${TH_WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()} ${TH_MONTHS_SHORT[d.getMonth()]}`
}

/** '2026-09-29' → 'วันจันทร์ที่ 29 กันยายน 2569'. */
export function thaiDateLong(k: DayKey): string {
  const d = fromDayKey(k)
  return `วัน${TH_WEEKDAYS[d.getDay()]}ที่ ${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`
}

/** '2026-09' style month label → 'กันยายน 2569'. Accepts a DayKey. */
export function thaiMonth(k: DayKey): string {
  const d = fromDayKey(k)
  return `${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`
}

/** epoch ms → '14:05'. */
export function timeHM(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** epoch ms → '29 ก.ย. 69 14:05'. */
export function dateTime(ts: number): string {
  const d = new Date(ts)
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${thaiDate(k)} ${timeHM(ts)}`
}
