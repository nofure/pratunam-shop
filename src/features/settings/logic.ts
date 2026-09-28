// Pure helpers for the settings / setup / login screens (unit-tested in logic.test.ts).
import { hasPromo } from '../../domain/pricing'
import { isValidPromptPayTarget, promptPayTargetType } from '../../lib/promptpay'
import { baht, round2 } from '../../lib/format'
import type { ID, Staff, Tier } from '../../types'

// ---------------------------------------------------------------- ordering

/** Move one item up (delta −1) or down (+1). Returns the same array when the move is impossible. */
export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta
  if (index < 0 || index >= list.length || to < 0 || to >= list.length || delta === 0) return list
  const next = list.slice()
  const [item] = next.splice(index, 1)
  next.splice(to, 0, item)
  return next
}

/** New `sort` values (0, 1, 2 …) for the rows whose position changed. */
export function resequence<T extends { id: ID; sort: number }>(ordered: T[]): { id: ID; sort: number }[] {
  const out: { id: ID; sort: number }[] = []
  ordered.forEach((row, i) => {
    if (row.sort !== i) out.push({ id: row.id, sort: i })
  })
  return out
}

/** Next sort value after the given rows. */
export function nextSort(rows: { sort: number }[]): number {
  let max = -1
  for (const r of rows) if (Number.isFinite(r.sort) && r.sort > max) max = r.sort
  return Math.floor(max) + 1
}

// ---------------------------------------------------------------- price buttons

export interface TierForm {
  name: string
  price: number | null
  promoOn: boolean
  promoQty: number | null
  promoPrice: number | null
  unit?: string
}

export interface TierFormErrors {
  name?: string
  price?: string
  promoQty?: string
  promoPrice?: string
}

export function validateTierForm(f: TierForm): TierFormErrors {
  const e: TierFormErrors = {}
  if (!f.name.trim()) e.name = 'ใส่ชื่อสินค้า'
  else if (f.name.trim().length > 40) e.name = 'ชื่อยาวเกินไป'
  if (f.price == null || !Number.isFinite(f.price) || f.price <= 0) e.price = 'ใส่ราคา'
  if (f.promoOn) {
    const q = f.promoQty
    if (q == null || !Number.isInteger(q) || q < 2) e.promoQty = 'โปรต้องตั้งแต่ 2 ชิ้นขึ้นไป'
    else if (q > 99) e.promoQty = 'จำนวนมากเกินไป'
    const p = f.promoPrice
    if (p == null || !Number.isFinite(p) || p <= 0) e.promoPrice = 'ใส่ราคาโปร'
    else if (!e.promoQty && !e.price && f.price != null && q != null && p >= round2(f.price * q)) {
      e.promoPrice = `ราคาโปรต้องน้อยกว่า ${baht(round2(f.price * q))} (ราคาปกติ ${q} ${f.unit?.trim() || 'ชิ้น'})`
    }
  }
  return e
}

/** Baht saved when buying exactly promoQty pieces (0 when there is no usable promo). */
export function promoSaving(price: number | null, promoQty: number | null, promoPrice: number | null): number {
  if (price == null || !hasPromo(promoQty, promoPrice)) return 0
  return Math.max(0, round2(price * (promoQty as number) - (promoPrice as number)))
}

/** Names for the datalist: existing names first (most used), then template names, unique. */
export function tierNameSuggestions(tiers: Pick<Tier, 'name'>[], extra: string[] = []): string[] {
  const count = new Map<string, number>()
  for (const t of tiers) {
    const n = t.name.trim()
    if (n) count.set(n, (count.get(n) ?? 0) + 1)
  }
  const fromTiers = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'th')).map(([n]) => n)
  const seen = new Set(fromTiers)
  const rest = extra.map((n) => n.trim()).filter((n) => n && !seen.has(n) && (seen.add(n), true))
  return [...fromTiers, ...rest]
}

/** Another live price button in the same booth with the same name and price. */
export function findDuplicateTier(tiers: Tier[], boothId: ID, name: string, price: number | null, exceptId: ID | null): Tier | null {
  if (price == null) return null
  const n = name.trim()
  return (
    tiers.find((t) => t.deleted !== 1 && t.boothId === boothId && t.id !== exceptId && t.name.trim() === n && t.price === price) ??
    null
  )
}

// ---------------------------------------------------------------- staff / PIN

export const PIN_LENGTHS = [4, 6] as const

export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin)
}

/** PIN length for the login keypad (4–6). */
export function pinLengthOf(pin: string | null | undefined): number {
  const n = (pin ?? '').length
  return n >= 4 && n <= 6 ? n : 4
}

/** Easy-to-guess PINs worth a gentle warning. */
export function isWeakPin(pin: string): boolean {
  if (!isValidPin(pin)) return false
  if (/^(\d)\1+$/.test(pin)) return true
  const asc = '0123456789012345'
  const desc = '9876543210987654'
  return asc.includes(pin) || desc.includes(pin)
}

/** Other active people using the same PIN. */
export function pinConflicts(staff: Staff[], pin: string, exceptId: ID | null): Staff[] {
  if (!pin) return []
  return staff.filter((s) => s.deleted !== 1 && s.active === 1 && s.id !== exceptId && s.pin === pin)
}

/** Active, not-deleted owners. */
export function activeOwners(staff: Staff[]): Staff[] {
  return staff.filter((s) => s.deleted !== 1 && s.active === 1 && s.role === 'owner')
}

/**
 * True when this change would leave the shop without an active owner
 * (deleting, deactivating or demoting the last one).
 */
export function wouldRemoveLastOwner(
  staff: Staff[],
  id: ID,
  next: { role?: Staff['role']; active?: 0 | 1; deleted?: 0 | 1 },
): boolean {
  const owners = activeOwners(staff)
  const isActiveOwner = owners.some((s) => s.id === id)
  if (!isActiveOwner || owners.length > 1) return false
  const cur = owners[0]
  const role = next.role ?? cur.role
  const active = next.active ?? cur.active
  const deleted = next.deleted ?? cur.deleted
  return role !== 'owner' || active !== 1 || deleted === 1
}

const LEADING_VOWELS = /^[เแโใไ]+/

/** Letter for the round avatar: first Thai consonant (skips leading vowels) or first letter. */
export function initialOf(name: string): string {
  const n = name.trim().replace(LEADING_VOWELS, '')
  if (!n) return '?'
  const ch = Array.from(n)[0]
  return ch.toLocaleUpperCase('th')
}

// ---------------------------------------------------------------- shop / PromptPay

export const PROMPTPAY_TYPE_LABEL = {
  phone: 'เบอร์มือถือ',
  nationalId: 'เลขบัตรประชาชน / เลขผู้เสียภาษี',
  ewallet: 'เลข e-Wallet',
} as const

export interface PromptPayCheck {
  digits: string
  /** '' when empty (optional field). */
  error: string
  typeLabel: string | null
  valid: boolean
}

export function checkPromptPay(input: string): PromptPayCheck {
  const digits = (input ?? '').replace(/\D/g, '')
  if (!digits) return { digits, error: '', typeLabel: null, valid: false }
  const type = promptPayTargetType(digits)
  const typeLabel = type ? PROMPTPAY_TYPE_LABEL[type] : null
  if (!type) return { digits, error: 'ใช้เบอร์มือถือ 10 หลัก เลขบัตร 13 หลัก หรือ e-Wallet 15 หลัก', typeLabel, valid: false }
  if (!isValidPromptPayTarget(digits)) {
    const error = type === 'phone' ? 'เบอร์มือถือไม่ถูกต้อง' : type === 'nationalId' ? 'เลขบัตรไม่ถูกต้อง ตรวจอีกครั้ง' : 'เลขไม่ถูกต้อง'
    return { digits, error, typeLabel, valid: false }
  }
  return { digits, error: '', typeLabel, valid: true }
}

/** Booth names typed in the setup wizard: trimmed, blanks dropped. Error text when unusable. */
export function checkBoothNames(names: string[]): { names: string[]; error: string } {
  const clean = names.map((n) => n.trim()).filter(Boolean)
  if (clean.length === 0) return { names: clean, error: 'ใส่ชื่อแผงอย่างน้อย 1 แผง' }
  const seen = new Set<string>()
  for (const n of clean) {
    if (seen.has(n)) return { names: clean, error: `ชื่อแผง "${n}" ซ้ำกัน` }
    seen.add(n)
  }
  if (clean.some((n) => n.length > 40)) return { names: clean, error: 'ชื่อแผงยาวเกินไป' }
  return { names: clean, error: '' }
}

// ---------------------------------------------------------------- sync link sharing

export const SYNC_SHARE_TITLE = 'ลิงก์ซิงก์ร้าน'
export const SYNC_SHARE_KEY_LABEL = 'รหัสซิงก์'

/** Message sent from the first device to a new one (see parseSyncShare). */
export function syncShareText(url: string, key: string): string {
  return `${SYNC_SHARE_TITLE}\n${url.trim()}\n${SYNC_SHARE_KEY_LABEL}\n${key.trim()}`
}

/**
 * The whole shared message pasted into the link field (line breaks may be stripped by the
 * browser): pull out the /exec link and the key. null when the text isn't such a message.
 */
export function parseSyncShare(text: string): { url: string; key: string } | null {
  const t = (text ?? '').trim()
  const at = t.indexOf(SYNC_SHARE_KEY_LABEL)
  if (at < 0) return null
  const url = (t.match(/https?:\/\/\S*?\/exec\b/) ?? t.match(/https?:\/\/[^\s]+/))?.[0] ?? ''
  const key = t
    .slice(at + SYNC_SHARE_KEY_LABEL.length)
    .trim()
    .split(/\s+/)[0] ?? ''
  if (!url || !key) return null
  return { url, key }
}

// ---------------------------------------------------------------- login lockout

export const LOGIN_MAX_TRIES = 5
export const LOGIN_COOLDOWN_MS = 30_000

export interface LoginLock {
  fails: number
  until: number // epoch ms; 0 = not locked
}

/** State after a wrong PIN: the 5th wrong try starts a 30 s cooldown and resets the counter. */
export function afterWrongPin(lock: LoginLock, now: number): LoginLock {
  const fails = lock.fails + 1
  if (fails >= LOGIN_MAX_TRIES) return { fails: 0, until: now + LOGIN_COOLDOWN_MS }
  return { fails, until: 0 }
}

export function lockRemainingSec(lock: LoginLock, now: number): number {
  return lock.until > now ? Math.ceil((lock.until - now) / 1000) : 0
}
