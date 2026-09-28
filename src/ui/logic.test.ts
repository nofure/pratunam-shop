import { describe, expect, it } from 'vitest'
import { applyPadKey, compactNumber, moneyToText, niceScale, normalizeMoneyText, parseMoney, withCommas } from './logic'

describe('parseMoney', () => {
  it('parses plain, grouped and decimal amounts', () => {
    expect(parseMoney('1250')).toBe(1250)
    expect(parseMoney('1,250')).toBe(1250)
    expect(parseMoney('฿ 1,250.5')).toBe(1250.5)
    expect(parseMoney('0.1')).toBe(0.1)
    expect(parseMoney('12.')).toBe(12)
    expect(parseMoney('.5')).toBe(0.5)
  })
  it('returns null for empty or invalid text', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('.')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('1.2.3')).toBeNull()
    expect(parseMoney('-5')).toBeNull()
  })
  it('rounds to satang', () => {
    expect(parseMoney('10.005')).toBe(10.01)
  })
})

describe('normalizeMoneyText', () => {
  it('strips leading zeros but keeps 0 and 0.x', () => {
    expect(normalizeMoneyText('007', false, 9)).toBe('7')
    expect(normalizeMoneyText('00', false, 9)).toBe('0')
    expect(normalizeMoneyText('0', false, 9)).toBe('0')
    expect(normalizeMoneyText('0.5', true, 9)).toBe('0.5')
    expect(normalizeMoneyText('.5', true, 9)).toBe('0.5')
  })
  it('drops separators and letters', () => {
    expect(normalizeMoneyText('1,250', false, 9)).toBe('1250')
    expect(normalizeMoneyText('฿1,250 บาท', false, 9)).toBe('1250')
    expect(normalizeMoneyText('12a', false, 9)).toBe('12')
  })
  it('rejects decimals when not allowed, and more than 2 decimals', () => {
    expect(normalizeMoneyText('12.5', false, 9)).toBeNull()
    expect(normalizeMoneyText('12.555', true, 9)).toBeNull()
    expect(normalizeMoneyText('12.55', true, 9)).toBe('12.55')
    expect(normalizeMoneyText('1.2.3', true, 9)).toBeNull()
  })
  it('limits integer digits', () => {
    expect(normalizeMoneyText('1234', false, 3)).toBeNull()
    expect(normalizeMoneyText('123.45', true, 3)).toBe('123.45')
  })
  it('allows clearing', () => {
    expect(normalizeMoneyText('', false, 9)).toBe('')
  })
})

describe('withCommas / moneyToText', () => {
  it('groups thousands', () => {
    expect(withCommas('1250')).toBe('1,250')
    expect(withCommas('1234567.5')).toBe('1,234,567.5')
    expect(withCommas('999')).toBe('999')
    expect(withCommas('')).toBe('')
  })
  it('formats numbers for editing', () => {
    expect(moneyToText(null)).toBe('')
    expect(moneyToText(1250)).toBe('1250')
    expect(moneyToText(25.5)).toBe('25.5')
    expect(moneyToText(0.1 + 0.2)).toBe('0.3')
  })
})

describe('applyPadKey', () => {
  const press = (keys: string[], allowDecimal = false, maxLength = 9) =>
    keys.reduce((v, k) => applyPadKey(v, k as Parameters<typeof applyPadKey>[1], allowDecimal, maxLength), '')

  it('builds numbers without leading zeros', () => {
    expect(press(['0', '0', '7'])).toBe('7')
    expect(press(['1', '0', '0'])).toBe('100')
    expect(press(['00'])).toBe('0')
    expect(press(['5', '00'])).toBe('500')
  })
  it('handles decimals', () => {
    expect(press(['.', '5'], true)).toBe('0.5')
    expect(press(['1', '.', '.', '2', '5', '9'], true)).toBe('1.25')
    expect(press(['1', '.'], false)).toBe('1')
    expect(press(['0', '.', '0', '5'], true)).toBe('0.05')
  })
  it('backspace and clear', () => {
    expect(press(['1', '2', '3', 'back'])).toBe('12')
    expect(press(['1', '2', 'clear'])).toBe('')
    expect(press(['back'])).toBe('')
  })
  it('respects maxLength', () => {
    expect(press(['1', '2', '3', '4'], false, 3)).toBe('123')
    expect(press(['1', '2', '00'], false, 3)).toBe('120')
    expect(press(['1', '2', '3', '00'], false, 3)).toBe('123')
  })
})

describe('niceScale / compactNumber', () => {
  it('covers the data with round steps', () => {
    const s = niceScale(0, 7980, false)
    expect(s.lo).toBe(0)
    expect(s.hi).toBeGreaterThanOrEqual(7980)
    expect(s.ticks[0]).toBe(0)
    expect(s.ticks[s.ticks.length - 1]).toBe(s.hi)
    expect(s.ticks).toEqual([0, 2000, 4000, 6000, 8000])
  })
  it('uses whole steps for integer data', () => {
    expect(niceScale(0, 3, true).ticks).toEqual([0, 1, 2, 3])
  })
  it('handles all-zero and negative data', () => {
    expect(niceScale(0, 0, true)).toEqual({ lo: 0, hi: 1, ticks: [0] })
    const s = niceScale(-500, 1500, true)
    expect(s.lo).toBeLessThanOrEqual(-500)
    expect(s.ticks).toContain(0)
  })
  it('compacts big numbers in Thai units', () => {
    expect(compactNumber(0)).toBe('0')
    expect(compactNumber(8500)).toBe('8,500')
    expect(compactNumber(12000)).toBe('1.2หมื่น')
    expect(compactNumber(250000)).toBe('2.5แสน')
    expect(compactNumber(1500000)).toBe('1.5ล้าน')
    expect(compactNumber(-20000)).toBe('−2หมื่น')
  })
})
