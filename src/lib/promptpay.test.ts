import { describe, expect, it } from 'vitest'
import generatePayload from 'promptpay-qr'
import {
  crc16,
  formatPromptPayTarget,
  isValidPromptPayTarget,
  promptPayPayload,
  promptPayTargetType,
  thaiIdChecksumOk,
} from './promptpay'

/** Append the Thai ID check digit to 12 digits. */
function withCheckDigit(first12: string): string {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (13 - i)
  return first12 + String((11 - (sum % 11)) % 10)
}

const VALID_ID = withCheckDigit('110170023070')
const VALID_TAX_ID = withCheckDigit('010555600012')

describe('crc16', () => {
  it('matches the CRC-16/CCITT-FALSE check value', () => {
    expect(crc16('123456789')).toBe('29B1')
  })
  it('is 4 uppercase hex chars', () => {
    expect(crc16('')).toBe('FFFF')
    expect(crc16('A')).toMatch(/^[0-9A-F]{4}$/)
  })
})

describe('promptPayPayload equals the promptpay-qr reference', () => {
  const targets = [
    '0812345678',
    '081-234-5678',
    '0987654321',
    '0600000000',
    '+66812345678',
    '66 81 234 5678',
    VALID_ID,
    '1-1017-00230-70-8',
    VALID_TAX_ID,
    '004999000288505',
    '123456789012345',
  ]
  const amounts: (number | undefined)[] = [undefined, 0, 1, 39, 100, 139, 139.5, 1234.56, 0.01, 99999.99]

  for (const target of targets) {
    for (const amount of amounts) {
      it(`${target} / ${amount}`, () => {
        expect(promptPayPayload(target, amount)).toBe(generatePayload(target, { amount }))
      })
    }
  }
})

describe('promptPayPayload structure', () => {
  it('static QR without an amount', () => {
    const p = promptPayPayload('0812345678')
    expect(p.startsWith('000201010211')).toBe(true)
    expect(p).toContain('29370016A000000677010111011300668123456785802TH5303764')
    expect(p).not.toContain('5406')
    expect(p).toMatch(/6304[0-9A-F]{4}$/)
  })

  it('dynamic QR with an amount', () => {
    const p = promptPayPayload('0812345678', 139)
    expect(p.startsWith('000201010212')).toBe(true)
    expect(p).toContain('5406139.00')
    const body = p.slice(0, -4)
    expect(p.slice(-4)).toBe(crc16(body))
  })

  it('national ID and e-wallet tags', () => {
    expect(promptPayPayload(VALID_ID)).toContain(`0213${VALID_ID}`)
    expect(promptPayPayload('004999000288505')).toContain('0315004999000288505')
  })

  it('ignores negative / invalid amounts', () => {
    expect(promptPayPayload('0812345678', -5)).toBe(promptPayPayload('0812345678'))
    expect(promptPayPayload('0812345678', Number.NaN)).toBe(promptPayPayload('0812345678'))
  })
})

describe('promptPayTargetType / isValidPromptPayTarget', () => {
  it('detects target types', () => {
    expect(promptPayTargetType('0812345678')).toBe('phone')
    expect(promptPayTargetType('081-234-5678')).toBe('phone')
    expect(promptPayTargetType('+66812345678')).toBe('phone')
    expect(promptPayTargetType(VALID_ID)).toBe('nationalId')
    expect(promptPayTargetType('004999000288505')).toBe('ewallet')
    expect(promptPayTargetType('12345')).toBeNull()
    expect(promptPayTargetType('')).toBeNull()
    expect(promptPayTargetType('08123456789')).toBeNull() // 11 digits not starting with 66
  })

  it('validates phones', () => {
    expect(isValidPromptPayTarget('0812345678')).toBe(true)
    expect(isValidPromptPayTarget('081-234-5678')).toBe(true)
    expect(isValidPromptPayTarget('0612345678')).toBe(true)
    expect(isValidPromptPayTarget('0912345678')).toBe(true)
    expect(isValidPromptPayTarget('+66 81 234 5678')).toBe(true)
    expect(isValidPromptPayTarget('0212345678')).toBe(false) // landline
    expect(isValidPromptPayTarget('081234567')).toBe(false)
    expect(isValidPromptPayTarget('')).toBe(false)
    expect(isValidPromptPayTarget('abc')).toBe(false)
  })

  it('validates 13-digit IDs with the check digit', () => {
    expect(thaiIdChecksumOk(VALID_ID)).toBe(true)
    expect(isValidPromptPayTarget(VALID_ID)).toBe(true)
    expect(isValidPromptPayTarget(VALID_TAX_ID)).toBe(true)
    const wrong = VALID_ID.slice(0, 12) + String((Number(VALID_ID[12]) + 1) % 10)
    expect(isValidPromptPayTarget(wrong)).toBe(false)
  })

  it('accepts 15-digit e-wallet IDs', () => {
    expect(isValidPromptPayTarget('004999000288505')).toBe(true)
  })
})

describe('formatPromptPayTarget', () => {
  it('formats for display', () => {
    expect(formatPromptPayTarget('0812345678')).toBe('081-234-5678')
    expect(formatPromptPayTarget('+66812345678')).toBe('081-234-5678')
    expect(formatPromptPayTarget(VALID_ID)).toBe(
      `${VALID_ID[0]}-${VALID_ID.slice(1, 5)}-${VALID_ID.slice(5, 10)}-${VALID_ID.slice(10, 12)}-${VALID_ID[12]}`,
    )
    expect(formatPromptPayTarget('004999000288505')).toBe('004999000288505')
  })
})
