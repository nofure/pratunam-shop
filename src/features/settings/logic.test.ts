import { describe, expect, it } from 'vitest'
import type { Staff, Tier } from '../../types'
import {
  afterWrongPin,
  checkBoothNames,
  checkPromptPay,
  findDuplicateTier,
  initialOf,
  isWeakPin,
  lockRemainingSec,
  moveItem,
  nextSort,
  pinConflicts,
  parseSyncShare,
  pinLengthOf,
  promoSaving,
  resequence,
  syncShareText,
  tierNameSuggestions,
  validateTierForm,
  wouldRemoveLastOwner,
} from './logic'

let seq = 0
function staff(p: Partial<Staff>): Staff {
  seq++
  return {
    id: `s${seq}`,
    createdAt: 1,
    updatedAt: 1,
    deviceId: 'd',
    deleted: 0,
    synced: 0,
    name: 'คน',
    pin: '1234',
    role: 'staff',
    boothId: null,
    active: 1,
    ...p,
  }
}
function tier(p: Partial<Tier>): Tier {
  seq++
  return {
    id: `t${seq}`,
    createdAt: 1,
    updatedAt: 1,
    deviceId: 'd',
    deleted: 0,
    synced: 0,
    boothId: 'b1',
    name: 'เสื้อยืด',
    price: 39,
    promoQty: null,
    promoPrice: null,
    unit: 'ตัว',
    color: 'yellow',
    sort: 0,
    active: 1,
    trackStock: 1,
    lowStock: 5,
    ...p,
  }
}

describe('ordering', () => {
  it('moves items and ignores impossible moves', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    const same = ['a', 'b']
    expect(moveItem(same, 0, -1)).toBe(same)
    expect(moveItem(same, 1, 1)).toBe(same)
  })
  it('resequences only changed rows', () => {
    const rows = [
      { id: 'x', sort: 0 },
      { id: 'y', sort: 5 },
      { id: 'z', sort: 2 },
    ]
    expect(resequence(rows)).toEqual([{ id: 'y', sort: 1 }])
    expect(nextSort(rows)).toBe(6)
    expect(nextSort([])).toBe(0)
  })
})

describe('tier form', () => {
  const base = { name: 'เสื้อยืด', price: 39, promoOn: false, promoQty: null, promoPrice: null }
  it('requires name and price', () => {
    expect(validateTierForm({ ...base, name: ' ' }).name).toBeTruthy()
    expect(validateTierForm({ ...base, price: null }).price).toBeTruthy()
    expect(validateTierForm({ ...base, price: 0 }).price).toBeTruthy()
    expect(validateTierForm(base)).toEqual({})
  })
  it('checks promo qty >= 2 and promo price below the normal price', () => {
    expect(validateTierForm({ ...base, promoOn: true, promoQty: 1, promoPrice: 30 }).promoQty).toBeTruthy()
    expect(validateTierForm({ ...base, promoOn: true, promoQty: 3, promoPrice: 117 }).promoPrice).toBeTruthy()
    expect(validateTierForm({ ...base, promoOn: true, promoQty: 3, promoPrice: 100 })).toEqual({})
    expect(validateTierForm({ ...base, promoOn: true, promoQty: 3, promoPrice: null }).promoPrice).toBeTruthy()
  })
  it('computes promo saving', () => {
    expect(promoSaving(39, 3, 100)).toBe(17)
    expect(promoSaving(59, 2, 100)).toBe(18)
    expect(promoSaving(39, null, null)).toBe(0)
  })
  it('suggests names most-used first, unique', () => {
    const list = [tier({ name: 'ผ้าใบ' }), tier({ name: 'สแล็ค' }), tier({ name: 'ผ้าใบ' })]
    expect(tierNameSuggestions(list, ['สแล็ค', 'ยีนส์', ''])).toEqual(['ผ้าใบ', 'สแล็ค', 'ยีนส์'])
  })
  it('finds a duplicate name + price in the same booth only', () => {
    const a = tier({ name: 'ผ้าใบ', price: 129 })
    const other = tier({ name: 'ผ้าใบ', price: 129, boothId: 'b2' })
    expect(findDuplicateTier([a, other], 'b1', ' ผ้าใบ ', 129, null)).toBe(a)
    expect(findDuplicateTier([a, other], 'b1', 'ผ้าใบ', 129, a.id)).toBeNull()
    expect(findDuplicateTier([a], 'b1', 'ผ้าใบ', 159, null)).toBeNull()
  })
})

describe('staff', () => {
  it('protects the last active owner', () => {
    const o = staff({ role: 'owner' })
    const s = staff({ role: 'staff' })
    const list = [o, s]
    expect(wouldRemoveLastOwner(list, o.id, { active: 0 })).toBe(true)
    expect(wouldRemoveLastOwner(list, o.id, { role: 'staff' })).toBe(true)
    expect(wouldRemoveLastOwner(list, o.id, { deleted: 1 })).toBe(true)
    expect(wouldRemoveLastOwner(list, o.id, { role: 'owner', active: 1 })).toBe(false)
    expect(wouldRemoveLastOwner(list, s.id, { deleted: 1 })).toBe(false)
    const o2 = staff({ role: 'owner' })
    expect(wouldRemoveLastOwner([o, o2, s], o.id, { active: 0 })).toBe(false)
    const inactiveOwner = staff({ role: 'owner', active: 0 })
    expect(wouldRemoveLastOwner([o, inactiveOwner], o.id, { role: 'staff' })).toBe(true)
  })
  it('lists active PIN conflicts', () => {
    const a = staff({ pin: '1111' })
    const b = staff({ pin: '1111', active: 0 })
    const c = staff({ pin: '1111', deleted: 1 })
    const d = staff({ pin: '2222' })
    expect(pinConflicts([a, b, c, d], '1111', null)).toEqual([a])
    expect(pinConflicts([a, b, c, d], '1111', a.id)).toEqual([])
  })
  it('pin helpers', () => {
    expect(pinLengthOf('123456')).toBe(6)
    expect(pinLengthOf('12')).toBe(4)
    expect(pinLengthOf(undefined)).toBe(4)
    expect(isWeakPin('1234')).toBe(true)
    expect(isWeakPin('0000')).toBe(true)
    expect(isWeakPin('4321')).toBe(true)
    expect(isWeakPin('2580')).toBe(false)
  })
  it('avatar initial skips leading Thai vowels', () => {
    expect(initialOf('เอ')).toBe('อ')
    expect(initialOf('สมชาย')).toBe('ส')
    expect(initialOf('  ')).toBe('?')
    expect(initialOf('ann')).toBe('A')
  })
})

describe('promptpay / setup checks', () => {
  it('accepts empty (optional), phones and valid IDs', () => {
    expect(checkPromptPay('').error).toBe('')
    expect(checkPromptPay('').valid).toBe(false)
    expect(checkPromptPay('081-234-5678').valid).toBe(true)
    expect(checkPromptPay('0812345678').typeLabel).toBe('เบอร์มือถือ')
    expect(checkPromptPay('12345').error).toBeTruthy()
    expect(checkPromptPay('0212345678').valid).toBe(false)
    expect(checkPromptPay('1234567890121').valid).toBe(true)
    expect(checkPromptPay('1234567890123').valid).toBe(false)
  })
  it('checks booth names', () => {
    expect(checkBoothNames(['', ' ']).error).toBeTruthy()
    expect(checkBoothNames(['แผงเสื้อ', 'แผงเสื้อ ']).error).toBeTruthy()
    expect(checkBoothNames([' แผงเสื้อ ', '', 'แผงรองเท้า'])).toEqual({ names: ['แผงเสื้อ', 'แผงรองเท้า'], error: '' })
  })
})

describe('login lockout', () => {
  it('locks for 30 s after 5 wrong PINs', () => {
    let lock = { fails: 0, until: 0 }
    for (let i = 0; i < 4; i++) lock = afterWrongPin(lock, 1000)
    expect(lock).toEqual({ fails: 4, until: 0 })
    lock = afterWrongPin(lock, 1000)
    expect(lock.until).toBe(31_000)
    expect(lockRemainingSec(lock, 1000)).toBe(30)
    expect(lockRemainingSec(lock, 30_500)).toBe(1)
    expect(lockRemainingSec(lock, 31_000)).toBe(0)
  })
})

describe('sync share text', () => {
  const url = 'https://script.google.com/macros/s/AKfy-abc_123/exec'
  const key = 'แผงเสื้อ-ประตูน้ำ-7k3m-x9pq-2569'
  it('round-trips with line breaks', () => {
    expect(parseSyncShare(syncShareText(url, key))).toEqual({ url, key })
  })
  it('works when the browser strips line breaks on paste', () => {
    expect(parseSyncShare(syncShareText(url, key).replace(/\n/g, ''))).toEqual({ url, key })
  })
  it('ignores a plain link', () => {
    expect(parseSyncShare(url)).toBeNull()
    expect(parseSyncShare('รหัสซิงก์')).toBeNull()
  })
})
