import type { AdjustReason, ExpenseCategory, PayMethod, TierColor } from './types'

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  cash: 'เงินสด',
  transfer: 'โอน / QR',
  halfhalf: 'คนละครึ่ง',
  other: 'อื่นๆ',
}

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  rent: 'ค่าเช่าแผง',
  electric: 'ค่าไฟ / น้ำ',
  wage: 'ค่าจ้างคนขาย',
  supplies: 'ถุง / ไม้แขวน / ของใช้',
  travel: 'ค่ารถ / ค่าส่งของ',
  food: 'ค่าข้าว',
  other: 'อื่นๆ',
}

export const ADJUST_REASON_LABEL: Record<AdjustReason, string> = {
  count: 'นับสต็อก',
  damaged: 'ของเสีย / ชำรุด',
  lost: 'ของหาย',
  transfer_in: 'ย้ายเข้าจากแผงอื่น',
  transfer_out: 'ย้ายไปแผงอื่น',
  return_supplier: 'คืนร้านที่ซื้อมา',
  other: 'อื่นๆ',
}

/** Background / text colours for price buttons (look like the shop's price cards). */
export const TIER_COLORS: Record<TierColor, { bg: string; fg: string; label: string }> = {
  yellow: { bg: '#FFE066', fg: '#C92A2A', label: 'เหลือง' },
  red: { bg: '#FFC9C9', fg: '#A61E1E', label: 'แดง' },
  orange: { bg: '#FFD8A8', fg: '#A94C06', label: 'ส้ม' },
  pink: { bg: '#FCC2D7', fg: '#A61E4D', label: 'ชมพู' },
  purple: { bg: '#D0BFFF', fg: '#5F3DC4', label: 'ม่วง' },
  blue: { bg: '#A5D8FF', fg: '#1864AB', label: 'ฟ้า' },
  green: { bg: '#B2F2BB', fg: '#2B8A3E', label: 'เขียว' },
  gray: { bg: '#DEE2E6', fg: '#343A40', label: 'เทา' },
}

export const UNITS = ['ตัว', 'คู่', 'ชิ้น', 'ใบ', 'ผืน', 'อัน', 'แพ็ค']

/** Thai banknotes and coins, largest first. */
export const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1]

export const CASH_OUT_PRESETS: { reason: string; category: ExpenseCategory | null }[] = [
  { reason: 'ค่าข้าวคนขาย', category: 'food' },
  { reason: 'ซื้อถุง / ไม้แขวน', category: 'supplies' },
  { reason: 'เจ้าของเก็บเงิน', category: null },
  { reason: 'จ่ายค่าจ้าง', category: 'wage' },
  { reason: 'ค่ารถ / ค่าส่งของ', category: 'travel' },
]

export const CASH_IN_PRESETS = ['เติมเงินทอน', 'แลกเหรียญ / แบงก์ย่อย']

export const VOID_REASONS = ['กดผิด', 'ลูกค้าเปลี่ยนใจ / คืนของ', 'รับเงินไม่สำเร็จ', 'อื่นๆ']
