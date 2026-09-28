// PromptPay (Thai QR, EMVCo merchant-presented) payload builder.
// Output matches the reference library `promptpay-qr` byte for byte.

export type PromptPayTargetType = 'phone' | 'nationalId' | 'ewallet'

const GUID_PROMPTPAY = 'A000000677010111'

export function digitsOnly(s: string): string {
  return (s ?? '').replace(/[^0-9]/g, '')
}

/**
 * phone: 10 digits starting with 0 (or 66 + 9 digits, e.g. from +66…)
 * nationalId: 13 digits (citizen ID or company tax ID)
 * ewallet: 15 digits
 */
export function promptPayTargetType(target: string): PromptPayTargetType | null {
  const d = digitsOnly(target)
  if (d.length === 10 && d.startsWith('0')) return 'phone'
  if (d.length === 11 && d.startsWith('66')) return 'phone'
  if (d.length === 13) return 'nationalId'
  if (d.length === 15) return 'ewallet'
  return null
}

/** Check digit of a 13-digit Thai citizen / tax ID. */
export function thaiIdChecksumOk(id: string): boolean {
  const d = digitsOnly(id)
  if (d.length !== 13) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(d[12])
}

export function isValidPromptPayTarget(target: string): boolean {
  const type = promptPayTargetType(target)
  if (type === 'phone') {
    const d = digitsOnly(target)
    // Thai mobile numbers: 06x / 08x / 09x
    const local = d.length === 10 ? d.slice(1) : d.slice(2)
    return /^[689]\d{8}$/.test(local)
  }
  if (type === 'nationalId') return thaiIdChecksumOk(target)
  return type === 'ewallet'
}

/** '0812345678' → '081-234-5678' for display; other targets are grouped for readability. */
export function formatPromptPayTarget(target: string): string {
  const d = digitsOnly(target)
  const type = promptPayTargetType(d)
  if (type === 'phone') {
    const local = d.length === 11 ? '0' + d.slice(2) : d
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`
  }
  if (type === 'nationalId') return `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}`
  return d
}

function field(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as required by EMVCo tag 63. */
export function crc16(data: string): string {
  let crc = 0xffff
  for (let i = 0; i < data.length; i++) {
    crc ^= (data.charCodeAt(i) & 0xff) << 8
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * Thai QR payload for a PromptPay target. With an amount > 0 the QR is "dynamic" (amount filled in
 * the customer's bank app); without it the customer types the amount.
 * Validate the target with isValidPromptPayTarget() before showing the QR.
 */
export function promptPayPayload(target: string, amount?: number): string {
  const d = digitsOnly(target)
  let merchant: string
  if (d.length >= 15) merchant = field('03', d)
  else if (d.length >= 13) merchant = field('02', d)
  else merchant = field('01', ('0000000000000' + d.replace(/^0/, '66')).slice(-13))

  const hasAmount = amount != null && Number.isFinite(amount) && amount > 0
  const data =
    field('00', '01') +
    field('01', hasAmount ? '12' : '11') +
    field('29', field('00', GUID_PROMPTPAY) + merchant) +
    field('58', 'TH') +
    field('53', '764') +
    (hasAmount ? field('54', (amount as number).toFixed(2)) : '')
  const withCrcHeader = data + '6304'
  return withCrcHeader + crc16(withCrcHeader)
}
