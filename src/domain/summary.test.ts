import { describe, expect, it } from 'vitest'
import { daySummaryText, lineShareUrl, shiftSummaryText, shopTitle } from './summary'
import { computeShiftTotals, topItems } from './shift'
import { buildReport, lowStockList, type ReportInput } from './reports'
import { computeStock } from './stock'
import { emptyShiftTotals } from './shift'
import { mkBooth, mkExpense, mkItem, mkLot, mkMove, mkSale, mkShift, mkStaff, mkTier } from './test-fixtures'
import type { ShiftTotals } from '../types'

const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m).getTime()

function totals(p: Partial<ShiftTotals>): ShiftTotals {
  return { ...emptyShiftTotals(500), ...p }
}

describe('shopTitle', () => {
  it('adds ร้าน once', () => {
    expect(shopTitle('ประตูน้ำ')).toBe('ร้านประตูน้ำ')
    expect(shopTitle('ร้านป้าแดง')).toBe('ร้านป้าแดง')
    expect(shopTitle('Pratunam')).toBe('ร้าน Pratunam')
    expect(shopTitle('  ')).toBe('ร้าน')
  })
})

describe('shiftSummaryText', () => {
  const top = [
    { tierId: 't39', name: 'เสื้อยืด', price: 39, unit: 'ตัว', qty: 10, total: 339 },
    { tierId: 't100', name: 'ขาสั้น', price: 100, unit: 'ตัว', qty: 4, total: 400 },
    { tierId: 't59', name: 'เสื้อยืด', price: 59, unit: 'ตัว', qty: 3, total: 159 },
    { tierId: 't139', name: 'เสื้อบอล', price: 139, unit: 'ตัว', qty: 1, total: 139 },
  ]
  const t = totals({
    bills: 12,
    pieces: 30,
    total: 1234,
    byMethod: { cash: 800, transfer: 334, halfhalf: 100, other: 0 },
    manualDiscount: 30,
    voidBills: 1,
    voidTotal: 59,
    cashIn: 100,
    cashOut: 100,
    expectedCash: 1300,
  })
  const closed = mkShift({
    dayKey: '2026-09-29',
    openedAt: at(29, 9, 5),
    status: 'closed',
    closedAt: at(29, 18, 30),
    countedCash: 1280,
    expectedCash: 1300,
    cashDiff: -20,
    transferChecked: 1,
    halfhalfChecked: 1,
  })

  it('closed shift with a shortage', () => {
    const text = shiftSummaryText({ shopName: 'ประตูน้ำ', boothName: 'แผงเสื้อยืด', staffName: 'น้อย', shift: closed, totals: t, top })
    const lines = text.split('\n')
    expect(lines[0]).toBe('ร้านประตูน้ำ · แผงเสื้อยืด')
    expect(lines[1]).toBe('ปิดยอด 29 ก.ย. 69 (09:05–18:30) โดย น้อย')
    expect(lines[2]).toBe('ยอดขาย 1,234 บาท · 12 บิล · 30 ชิ้น')
    expect(lines[3]).toBe('เงินสด 800 · โอน 334 · คนละครึ่ง 100')
    expect(text).toContain('เงินทอนตั้งต้น 500 · เงินเข้า 100 · เงินออก 100')
    expect(text).toContain('เงินสดควรมี 1,300 นับได้ 1,280 → ขาด 20')
    expect(text).toContain('ลดราคา 30 · ยกเลิก 1 บิล (59)')
    expect(text).toContain('ขายดี: เสื้อยืด 39 ×10, ขาสั้น 100 ×4, เสื้อยืด 59 ×3')
    expect(text).not.toContain('เสื้อบอล')
    expect(text).not.toContain('อื่นๆ')
    expect(text).not.toContain('ยังไม่ได้เช็ก')
  })

  it('over and exact', () => {
    const over = shiftSummaryText({
      shopName: 'ประตูน้ำ',
      boothName: 'แผง',
      staffName: 'น้อย',
      shift: { ...closed, countedCash: 1315, cashDiff: 15 },
      totals: t,
      top: [],
    })
    expect(over).toContain('นับได้ 1,315 → เกิน 15')
    expect(over).not.toContain('ขายดี')
    const exact = shiftSummaryText({
      shopName: 'ประตูน้ำ',
      boothName: 'แผง',
      staffName: 'น้อย',
      shift: { ...closed, countedCash: 1300, cashDiff: 0 },
      totals: t,
      top: [],
    })
    expect(exact).toContain('→ ตรง')
  })

  it('omits lines that do not apply', () => {
    const quiet = totals({ bills: 1, pieces: 1, total: 100, byMethod: { cash: 100, transfer: 0, halfhalf: 0, other: 0 }, expectedCash: 600 })
    const text = shiftSummaryText({ shopName: 'ร้านป้า', boothName: 'แผง', staffName: 'น้อย', shift: { ...closed, countedCash: 600, cashDiff: 0 }, totals: quiet, top: [] })
    expect(text).not.toContain('ลดราคา')
    expect(text).not.toContain('ยกเลิก')
    expect(text).not.toContain('เงินเข้า')
    expect(text).toContain('เงินทอนตั้งต้น 500')
  })

  it('open shift has no counted cash', () => {
    const open = mkShift({ openedAt: at(29, 9, 5), status: 'open' })
    const text = shiftSummaryText({ shopName: 'ประตูน้ำ', boothName: 'แผง', staffName: 'น้อย', shift: open, totals: t, top })
    expect(text).toContain('ยังไม่ปิดยอด 29 ก.ย. 69 (เปิด 09:05)')
    expect(text).toContain('เงินสดควรมี 1,300')
    expect(text).not.toContain('นับได้')
  })

  it('shows other payments with the shop label and unchecked totals', () => {
    const withOther = totals({ bills: 3, total: 600, byMethod: { cash: 100, transfer: 200, halfhalf: 100, other: 200 } })
    const text = shiftSummaryText({
      shopName: 'ประตูน้ำ',
      boothName: 'แผง',
      staffName: 'น้อย',
      shift: { ...closed, transferChecked: 0, halfhalfChecked: 0, note: 'แบงก์ปลอม 1 ใบ' },
      totals: withOther,
      top: [],
      otherLabel: 'บัตรเครดิต',
    })
    expect(text).toContain('คนละครึ่ง 100 · บัตรเครดิต 200')
    expect(text).toContain('ยังไม่ได้เช็กยอดโอน และ คนละครึ่ง')
    expect(text).toContain('หมายเหตุ: แบงก์ปลอม 1 ใบ')
  })

  it('works with real computed totals', () => {
    const sales = [
      mkSale({ method: 'cash', items: [mkItem({ tierId: 't39', name: 'เสื้อยืด', price: 39, qty: 4, promoQty: 3, promoPrice: 100 })] }),
      mkSale({ method: 'transfer', items: [mkItem({ tierId: 't100', name: 'ขาสั้น', price: 100, qty: 1 })] }),
    ]
    const shift = mkShift({ openingFloat: 500, status: 'closed', closedAt: at(29, 20), countedCash: 639, expectedCash: 639, cashDiff: 0, transferChecked: 1 })
    const tt = computeShiftTotals(500, sales, [])
    const text = shiftSummaryText({ shopName: 'ประตูน้ำ', boothName: 'แผง', staffName: 'น้อย', shift, totals: tt, top: topItems(sales, 3) })
    expect(text).toContain('ยอดขาย 239 บาท · 2 บิล · 5 ชิ้น')
    expect(text).toContain('เงินสด 139 · โอน 100 · คนละครึ่ง 0')
    expect(text).toContain('เงินสดควรมี 639 นับได้ 639 → ตรง')
    expect(text).toContain('ขายดี: เสื้อยืด 39 ×4, ขาสั้น 100 ×1')
  })
})

describe('daySummaryText', () => {
  const b1 = mkBooth({ id: 'b1', name: 'แผงเสื้อยืด', sort: 1 })
  const b2 = mkBooth({ id: 'b2', name: 'แผงกางเกง', sort: 2 })
  const tiers = [
    mkTier({ id: 't39', boothId: 'b1', name: 'เสื้อยืด', price: 39, promoQty: 3, promoPrice: 100, lowStock: 60, sort: 1 }),
    mkTier({ id: 't100', boothId: 'b2', name: 'สแล็ค', price: 259, lowStock: 5, sort: 2 }),
  ]
  const input: ReportInput = {
    from: '2026-09-29',
    to: '2026-09-29',
    boothId: null,
    sales: [
      mkSale({
        boothId: 'b1',
        staffId: 's1',
        dayKey: '2026-09-29',
        method: 'cash',
        items: [mkItem({ tierId: 't39', name: 'เสื้อยืด', price: 39, qty: 6, promoQty: 3, promoPrice: 100 })],
      }),
      mkSale({
        boothId: 'b2',
        staffId: 's2',
        dayKey: '2026-09-29',
        method: 'transfer',
        manualDiscount: 9,
        items: [mkItem({ tierId: 't100', name: 'สแล็ค', price: 259, qty: 2 })],
      }),
      mkSale({ boothId: 'b2', dayKey: '2026-09-29', status: 'void', items: [mkItem({ tierId: 't100', price: 259, qty: 1 })] }),
    ],
    shifts: [
      mkShift({ id: 'sh1', boothId: 'b1', staffId: 's1', status: 'closed', closedAt: at(29, 20), cashDiff: -20 }),
      mkShift({ id: 'sh2', boothId: 'b2', staffId: 's2', status: 'open' }),
    ],
    cashMoves: [mkMove({ boothId: 'b1', type: 'out', amount: 60, category: 'food' })],
    expenses: [mkExpense({ category: 'rent', amount: 300 })],
    lots: [mkLot({ tierId: 't39', qty: 60, unitCost: 20 }), mkLot({ tierId: 't100', qty: 6, unitCost: 150 })],
    adjustments: [],
    tiers,
    booths: [b1, b2],
    staff: [mkStaff({ id: 's1', name: 'น้อย' }), mkStaff({ id: 's2', name: 'แดง' })],
  }

  it('contains the key numbers', () => {
    const report = buildReport(input)
    const stock = computeStock(tiers, input.lots, [], input.sales)
    const low = lowStockList(tiers, stock)
    const text = daySummaryText({ shopName: 'ประตูน้ำ', dayKey: '2026-09-29', report, low })
    const lines = text.split('\n')
    expect(lines[0]).toBe('ร้านประตูน้ำ · สรุป 29 ก.ย. 69')
    // 200 (b1) and 509 (b2) → b2 first
    expect(text).toContain('แผงกางเกง 509 บาท · 1 บิล')
    expect(text).toContain('แผงเสื้อยืด 200 บาท · 1 บิล')
    expect(text).toContain('รวม 709 บาท · 2 บิล · 8 ชิ้น')
    expect(text).toContain('เงินสด 200 · โอน 509 · คนละครึ่ง 0')
    expect(text).toContain('ลดราคา 9 · ยกเลิก 1 บิล (259)')
    // COGS: 6×20 + 2×150 = 420 → gross 289; expenses 300 + 60 = 360 → net −71
    expect(text).toContain('กำไรขั้นต้น 289')
    expect(text).toContain('ค่าใช้จ่าย 360')
    expect(text).toContain('ขาดทุนสุทธิ 71')
    expect(text).toContain('ขายดี: เสื้อยืด 39 ×6, สแล็ค 259 ×2')
    expect(text).toContain('เงินสดไม่ตรง:')
    expect(text).toContain('- แผงเสื้อยืด น้อย ขาด 20')
    expect(text).toContain('ยังไม่ปิดยอด: แผงกางเกง')
    expect(text).toContain('ของใกล้หมด: สแล็ค 259 เหลือ 4, เสื้อยืด 39 เหลือ 54')
  })

  it('range header, booth filter and unknown cost note', () => {
    const report = buildReport({ ...input, from: '2026-09-28', to: '2026-09-29', boothId: 'b1', lots: [] })
    const text = daySummaryText({ shopName: 'ประตูน้ำ', dayKey: '2026-09-29', report, low: [] })
    expect(text.split('\n')[0]).toBe('ร้านประตูน้ำ · แผงเสื้อยืด · สรุป 28 ก.ย. 69 – 29 ก.ย. 69')
    expect(text).not.toContain('แผงกางเกง')
    expect(text).not.toContain('กำไร') // no cost known
    expect(text).toContain('ค่าใช้จ่าย 60')
    expect(text).toContain('- 29 ก.ย. 69 แผงเสื้อยืด น้อย ขาด 20')
  })

  it('partial cost: gross profit with a note, no net profit', () => {
    const report = buildReport({ ...input, lots: [mkLot({ tierId: 't39', qty: 60, unitCost: 20 })] })
    const text = daySummaryText({ shopName: 'ประตูน้ำ', dayKey: '2026-09-29', report, low: [] })
    expect(text).toContain('กำไรขั้นต้น 80 (ไม่รวมยอด 509 ที่ไม่มีต้นทุน)')
    expect(text).toContain('ค่าใช้จ่าย 360')
    expect(text).not.toContain('สุทธิ')
  })

  it('no sales', () => {
    const report = buildReport({ ...input, sales: [], shifts: [], cashMoves: [], expenses: [] })
    const text = daySummaryText({ shopName: 'ประตูน้ำ', dayKey: '2026-09-29', report, low: [] })
    expect(text).toBe('ร้านประตูน้ำ · สรุป 29 ก.ย. 69\nยังไม่มียอดขาย')
  })

  it('lists at most 5 low-stock tiers', () => {
    const many = Array.from({ length: 7 }, (_, i) => mkTier({ id: `x${i}`, name: `ของ${i}`, price: 10 + i, lowStock: 5 }))
    const stock = computeStock(many, many.map((t) => mkLot({ tierId: t.id, qty: 2 })), [], [])
    const report = buildReport({ ...input, sales: [] })
    const text = daySummaryText({ shopName: 'ประตูน้ำ', dayKey: '2026-09-29', report, low: lowStockList(many, stock) })
    const lowLine = text.split('\n').find((l) => l.startsWith('ของใกล้หมด'))!
    expect(lowLine.split(', ')).toHaveLength(5)
    expect(lowLine).toContain('และอีก 2 รายการ')
  })
})

describe('lineShareUrl', () => {
  it('encodes the text', () => {
    const url = lineShareUrl('ยอด 1,234 บาท\nขาด 20 & more')
    expect(url.startsWith('https://line.me/R/share?text=')).toBe(true)
    expect(decodeURIComponent(url.split('text=')[1])).toBe('ยอด 1,234 บาท\nขาด 20 & more')
    expect(url).not.toContain('\n')
    expect(url).not.toContain(' ')
  })
})
