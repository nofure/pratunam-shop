// Data model shared by every module. All money values are in baht (number).
// Every stored record carries SyncMeta so it can be synced between devices.

export type ID = string

export interface SyncMeta {
  id: ID
  createdAt: number // epoch ms
  updatedAt: number // epoch ms, bumped on every local write (last-write-wins on sync)
  deviceId: string // device that last wrote the record
  deleted: 0 | 1 // soft delete — never hard-delete synced data
  synced: 0 | 1 // 0 = local change not yet pushed to the sync backend
}

/** YYYY-MM-DD in the device's local time zone (the shop's business day). */
export type DayKey = string

export type PayMethod = 'cash' | 'transfer' | 'halfhalf' | 'other'
export type Role = 'owner' | 'staff'
export type TierColor = 'yellow' | 'red' | 'orange' | 'pink' | 'purple' | 'blue' | 'green' | 'gray'

/** Single record with id 'shop'. */
export interface ShopConfig extends SyncMeta {
  name: string
  promptPayId: string // phone (10 digits), national/tax ID (13 digits) or e-wallet (15 digits); '' = not set
  promptPayName: string // account name shown under the QR so customers can check
  halfHalfEnabled: 0 | 1 // show คนละครึ่ง payment button
  otherPayEnabled: 0 | 1
  otherPayLabel: string // e.g. 'บัตรเครดิต'
  voidNeedsOwner: 0 | 1 // voiding a bill requires an owner PIN
  setupDone: 0 | 1
}

/** A stall / booth (แผง). Each device is assigned to one booth. */
export interface Booth extends SyncMeta {
  name: string
  openingFloat: number // default change money at shift open (เงินทอนตั้งต้น)
  sort: number
  active: 0 | 1
}

export interface Staff extends SyncMeta {
  name: string
  pin: string // 4–6 digits, stored as-is (attribution, not strong security)
  role: Role
  boothId: ID | null // usual booth, null = any
  active: 0 | 1
}

/**
 * A price button (ปุ่มราคา) = category + price in one booth, matching the shop's
 * rack/bin price tags. Stock and cost are tracked per tier, not per physical item.
 */
export interface Tier extends SyncMeta {
  boothId: ID
  name: string // category label, e.g. 'เสื้อยืด', 'สแล็ค', 'ผ้าใบ'
  price: number // unit price (baht, integer)
  promoQty: number | null // quantity promo: promoQty pieces for promoPrice (e.g. 3 for 100)
  promoPrice: number | null
  unit: string // 'ตัว' | 'คู่' | 'ชิ้น' | 'ใบ' | …
  color: TierColor
  sort: number
  active: 0 | 1
  trackStock: 0 | 1
  lowStock: number | null // alert when on-hand <= this
}

export interface SaleItem {
  tierId: ID | null // null = custom price entered by hand (ราคาอื่น)
  name: string
  unit: string
  price: number
  qty: number
  promoQty: number | null
  promoPrice: number | null
  fullTotal: number // price * qty
  lineTotal: number // after quantity promo
}

/** A bill (บิล). Paid bills are never edited — they can only be voided. */
export interface Sale extends SyncMeta {
  boothId: ID
  shiftId: ID
  staffId: ID
  dayKey: DayKey // business day = the shift's dayKey
  billNo: number // running number within the shift (display only)
  items: SaleItem[]
  pieces: number
  subtotal: number // sum of fullTotal
  promoDiscount: number // subtotal - sum of lineTotal
  manualDiscount: number // bargaining discount (ลูกค้าต่อ)
  total: number // subtotal - promoDiscount - manualDiscount (>= 0)
  method: PayMethod
  cashReceived: number | null // cash only
  change: number | null // cash only
  status: 'paid' | 'void'
  voidReason: string | null
  voidedAt: number | null
  voidedBy: ID | null
  note: string | null
}

export interface ShiftTotals {
  bills: number // paid bills
  pieces: number
  byMethod: Record<PayMethod, number>
  total: number // paid total
  promoDiscount: number
  manualDiscount: number
  voidBills: number
  voidTotal: number
  cashIn: number
  cashOut: number
  expectedCash: number // openingFloat + cash sales + cashIn - cashOut
}

/** A selling session of one booth (เปิดร้าน → ปิดยอด). One open shift per booth. */
export interface Shift extends SyncMeta {
  boothId: ID
  staffId: ID // opened by
  dayKey: DayKey
  openedAt: number
  openingFloat: number
  status: 'open' | 'closed'
  closedAt: number | null
  closedBy: ID | null
  countedCash: number | null
  denominations: Record<string, number> | null // e.g. {'1000': 2, '100': 5}
  expectedCash: number | null
  cashDiff: number | null // countedCash - expectedCash (negative = ขาด)
  transferChecked: 0 | 1 // staff confirmed transfer total matches the bank app
  halfhalfChecked: 0 | 1 // staff confirmed คนละครึ่ง total matches the ถุงเงิน app
  note: string | null
  snapshot: ShiftTotals | null // totals frozen at close
}

export type ExpenseCategory = 'rent' | 'electric' | 'wage' | 'supplies' | 'travel' | 'food' | 'other'

/** Money put into / taken out of the drawer during a shift. */
export interface CashMove extends SyncMeta {
  shiftId: ID
  boothId: ID
  staffId: ID
  dayKey: DayKey
  type: 'in' | 'out'
  amount: number
  reason: string
  // When set, this cash-out is also a business expense (counted in expense reports).
  // null = not an expense (e.g. owner collecting cash, getting change).
  category: ExpenseCategory | null
}

export interface Supplier extends SyncMeta {
  name: string
  phone: string | null
  location: string | null // e.g. 'โบ๊เบ๊ ตึก 3'
  note: string | null
}

/** Goods received (รับของเข้า) for one price tier. */
export interface Lot extends SyncMeta {
  boothId: ID
  tierId: ID
  dayKey: DayKey
  qty: number
  unitCost: number
  totalCost: number
  supplierId: ID | null
  note: string | null
  staffId: ID | null
}

export type AdjustReason = 'count' | 'damaged' | 'lost' | 'transfer_in' | 'transfer_out' | 'return_supplier' | 'other'

/** Stock correction for one tier. Stock count creates qtyChange = counted - onHand. */
export interface Adjustment extends SyncMeta {
  boothId: ID
  tierId: ID
  dayKey: DayKey
  qtyChange: number // + adds stock, - removes stock
  reason: AdjustReason
  countedQty: number | null // for reason 'count'
  linkId: ID | null // pairs transfer_out with transfer_in
  note: string | null
  staffId: ID | null
}

export interface Expense extends SyncMeta {
  boothId: ID | null // null = whole shop
  dayKey: DayKey
  category: ExpenseCategory
  amount: number
  note: string | null
  staffId: ID | null
}

export type TableName =
  | 'shop'
  | 'booths'
  | 'staff'
  | 'tiers'
  | 'sales'
  | 'shifts'
  | 'cashMoves'
  | 'lots'
  | 'adjustments'
  | 'suppliers'
  | 'expenses'
