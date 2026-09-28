// Pure helpers behind the UI kit (unit-tested in logic.test.ts).
import { num, round2 } from '../lib/format'

// ---------- money text ----------

/** '1,250' → 1250, '25.5' → 25.5, '' → null, 'abc' → null. Rounded to satang. */
export function parseMoney(s: string): number | null {
  const t = s.replace(/[,\s฿]/g, '')
  if (t === '' || t === '.') return null
  if (!/^\d*\.?\d*$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? round2(n) : null
}

/** Number → raw input text ('' for null). */
export function moneyToText(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return ''
  return String(round2(Math.abs(n)))
}

/** Adds thousands separators to a raw numeric string: '12500.5' → '12,500.5'. */
export function withCommas(raw: string): string {
  if (!raw) return raw
  const [int, dec] = raw.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dec === undefined ? grouped : `${grouped}.${dec}`
}

/** Normalise typed/pasted text for a money input; null = reject the change. */
export function normalizeMoneyText(input: string, allowDecimal: boolean, maxDigits: number): string | null {
  // Drop separators, currency and stray letters (e.g. pasted '฿1,250 บาท').
  let t = input.replace(/[^\d.]/g, '')
  if (t === '') return ''
  if (allowDecimal ? !/^\d*\.?\d{0,2}$/.test(t) : !/^\d*$/.test(t)) return null
  if (t.startsWith('.')) t = '0' + t
  // No leading zeros ('007' → '7') but keep '0' and '0.5'.
  t = t.replace(/^0+(?=\d)/, '')
  if (t.split('.')[0].length > maxDigits) return null
  return t
}

// ---------- keypad ----------

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | 'back' | 'clear'

/** Apply one keypad key to the current string. Returns the same string when the key is not allowed. */
export function applyPadKey(v: string, key: PadKey, allowDecimal: boolean, maxLength: number): string {
  if (key === 'back') return v.slice(0, -1)
  if (key === 'clear') return ''
  if (key === '.') {
    if (!allowDecimal || v.includes('.')) return v
    const next = (v === '' ? '0' : v) + '.'
    return next.length > maxLength ? v : next
  }
  let next: string
  if (v === '' || v === '0') next = key === '00' ? '0' : key // no leading zeros ('007')
  else next = v + key
  const dot = next.indexOf('.')
  if (dot >= 0 && next.length - dot - 1 > 2) return v // max 2 decimals
  if (next.length > maxLength) {
    // '00' near the limit: take a single 0 if it still fits.
    if (key === '00' && v !== '' && v !== '0' && v.length + 1 <= maxLength) return v + '0'
    return v
  }
  return next
}

// ---------- charts ----------

/** Short axis numbers in Thai units: 8,500 → '8,500'; 12,000 → '1.2หมื่น'; 250,000 → '2.5แสน'. */
export function compactNumber(v: number): string {
  const a = Math.abs(v)
  const s = v < 0 ? '−' : ''
  if (a >= 1e6) return s + num(a / 1e6, 1) + 'ล้าน'
  if (a >= 1e5) return s + num(a / 1e5, 1) + 'แสน'
  if (a >= 1e4) return s + num(a / 1e4, 1) + 'หมื่น'
  return s + num(a, a < 10 ? 1 : 0)
}

/** Round axis bounds and ~`count` gridline values covering [minV, maxV] (both include 0 in practice). */
export function niceScale(minV: number, maxV: number, integers: boolean, count = 4): { lo: number; hi: number; ticks: number[] } {
  if (minV === 0 && maxV === 0) return { lo: 0, hi: 1, ticks: [0] }
  const raw = (maxV - minV) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / mag
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag
  if (integers && step < 1) step = 1
  const lo = Math.floor(minV / step) * step
  const hi = Math.ceil(maxV / step) * step
  const ticks: number[] = []
  const steps = Math.round((hi - lo) / step)
  for (let i = 0; i <= steps && i <= 20; i++) ticks.push(Math.round((lo + i * step) * 1e6) / 1e6)
  return { lo, hi, ticks }
}
