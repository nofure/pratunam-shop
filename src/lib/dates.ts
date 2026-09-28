// Business-day helpers. A DayKey is 'YYYY-MM-DD' in the device's local time zone.
import type { DayKey } from '../types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toDayKey(d: Date): DayKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse a DayKey to a local Date at 00:00. */
export function fromDayKey(k: DayKey): Date {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayKey(now: Date = new Date()): DayKey {
  return toDayKey(now)
}

export function dayKeyOf(ts: number): DayKey {
  return toDayKey(new Date(ts))
}

export function addDays(k: DayKey, n: number): DayKey {
  const d = fromDayKey(k)
  d.setDate(d.getDate() + n)
  return toDayKey(d)
}

/** Every day from `from` to `to` inclusive (empty if from > to). */
export function eachDay(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = []
  for (let k = from; k <= to; k = addDays(k, 1)) {
    out.push(k)
    if (out.length > 3700) break
  }
  return out
}

export function startOfMonth(k: DayKey): DayKey {
  return k.slice(0, 8) + '01'
}

export function endOfMonth(k: DayKey): DayKey {
  const d = fromDayKey(startOfMonth(k))
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  return toDayKey(d)
}

export function addMonths(k: DayKey, n: number): DayKey {
  const d = fromDayKey(startOfMonth(k))
  d.setMonth(d.getMonth() + n)
  return toDayKey(d)
}

/** Number of days between two keys (b - a). */
export function diffDays(a: DayKey, b: DayKey): number {
  return Math.round((fromDayKey(b).getTime() - fromDayKey(a).getTime()) / 86_400_000)
}

export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'thisMonth' | 'lastMonth'

export const PRESET_LABEL: Record<RangePreset, string> = {
  today: 'วันนี้',
  yesterday: 'เมื่อวาน',
  '7d': '7 วัน',
  '30d': '30 วัน',
  thisMonth: 'เดือนนี้',
  lastMonth: 'เดือนก่อน',
}

export interface DayRange {
  from: DayKey
  to: DayKey
}

export function presetRange(p: RangePreset, today: DayKey = todayKey()): DayRange {
  switch (p) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const y = addDays(today, -1)
      return { from: y, to: y }
    }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '30d':
      return { from: addDays(today, -29), to: today }
    case 'thisMonth':
      return { from: startOfMonth(today), to: today }
    case 'lastMonth': {
      const s = addMonths(today, -1)
      return { from: s, to: endOfMonth(s) }
    }
  }
}

export function inRange(k: DayKey, r: DayRange): boolean {
  return k >= r.from && k <= r.to
}
