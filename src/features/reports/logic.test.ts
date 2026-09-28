import { describe, expect, it } from 'vitest'
import type { ReportDayRow, ReportTierRow } from '../../domain/reports'
import { mkItem, mkSale } from '../../domain/test-fixtures'
import { toCsv } from '../../lib/share'
import {
  billsCsvRows,
  categoryUnit,
  csvFileName,
  dayStats,
  fileNamePart,
  formatPct,
  hourChartData,
  marginPct,
  pctChange,
  peakHour,
  previousRange,
  rangeDays,
  rangeFromParams,
  saleItemsText,
  salesChartData,
  sharePct,
  sortTierRows,
  tiersCsvRows,
} from './logic'

const tierRow = (p: Partial<ReportTierRow>): ReportTierRow => ({
  key: 'k',
  tierId: 't',
  boothId: 'b1',
  boothName: 'แผง A',
  name: 'เสื้อยืด',
  price: 39,
  unit: 'ตัว',
  qty: 1,
  sales: 39,
  cogs: null,
  profit: null,
  ...p,
})

describe('ranges', () => {
  it('reads a valid range from params and defaults to today', () => {
    expect(rangeFromParams('2026-09-01', '2026-09-29', '2026-09-29')).toEqual({ from: '2026-09-01', to: '2026-09-29' })
    expect(rangeFromParams(null, null, '2026-09-29')).toEqual({ from: '2026-09-29', to: '2026-09-29' })
    expect(rangeFromParams('2026-13-01', '2026-09-29', '2026-09-29')).toEqual({ from: '2026-09-29', to: '2026-09-29' })
    expect(rangeFromParams('2026-02-30', '2026-03-01', '2026-09-29')).toEqual({ from: '2026-09-29', to: '2026-09-29' })
    expect(rangeFromParams('2026-09-29', '2026-09-01', '2026-09-29')).toEqual({ from: '2026-09-01', to: '2026-09-29' })
  })

  it('previous period has the same length and ends the day before', () => {
    expect(previousRange({ from: '2026-09-29', to: '2026-09-29' })).toEqual({ from: '2026-09-28', to: '2026-09-28' })
    expect(previousRange({ from: '2026-09-23', to: '2026-09-29' })).toEqual({ from: '2026-09-16', to: '2026-09-22' })
    expect(previousRange({ from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2026-01-29', to: '2026-02-28' })
    expect(rangeDays({ from: '2026-09-01', to: '2026-09-30' })).toBe(30)
  })
})

describe('percentages', () => {
  it('pctChange needs a positive previous value', () => {
    expect(pctChange(120, 100)).toBe(20)
    expect(pctChange(80, 100)).toBe(-20)
    expect(pctChange(100, 0)).toBeNull()
    expect(pctChange(1, 3)).toBe(-66.7)
  })

  it('formatPct', () => {
    expect(formatPct(20)).toBe('+20%')
    expect(formatPct(-66.7)).toBe('−67%')
    expect(formatPct(3.5)).toBe('+3.5%')
    expect(formatPct(-0.4)).toBe('−0.4%')
    expect(formatPct(0)).toBe('เท่าเดิม')
  })

  it('sharePct and marginPct', () => {
    expect(sharePct(25, 100)).toBe('25%')
    expect(sharePct(0.2, 100)).toBe('<1%')
    expect(sharePct(5, 0)).toBe('0%')
    expect(marginPct(40, 100)).toBe(40)
    expect(marginPct(10, 0)).toBeNull()
  })
})

describe('charts', () => {
  const days = (n: number, start = 1): ReportDayRow[] =>
    Array.from({ length: n }, (_, i) => ({
      dayKey: `2026-09-${String(start + i).padStart(2, '0')}`,
      sales: (i + 1) * 10,
      bills: 1,
    }))

  it('daily data highlights the best day', () => {
    const { mode, data } = salesChartData(days(3))
    expect(mode).toBe('day')
    expect(data).toHaveLength(3)
    expect(data[0].label).toBe('อ. 1 ก.ย.')
    expect(data.filter((d) => d.highlight).map((d) => d.value)).toEqual([30])
  })

  it('long ranges are grouped by month', () => {
    const byDay: ReportDayRow[] = []
    for (let m = 7; m <= 9; m++)
      for (let d = 1; d <= 28; d++)
        byDay.push({ dayKey: `2026-0${m}-${String(d).padStart(2, '0')}`, sales: m === 8 ? 10 : 1, bills: 1 })
    const { mode, data } = salesChartData(byDay)
    expect(mode).toBe('month')
    expect(data.map((d) => d.label)).toEqual(['ก.ค. 69', 'ส.ค. 69', 'ก.ย. 69'])
    expect(data.map((d) => d.value)).toEqual([28, 280, 28])
    expect(data[1].highlight).toBe(true)
  })

  it('hour chart is trimmed to the hours with sales', () => {
    const byHour = new Array(24).fill(0)
    byHour[9] = 100
    byHour[12] = 300
    byHour[17] = 50
    const data = hourChartData(byHour)
    expect(data.map((d) => d.label)).toEqual(['9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'])
    expect(data.find((d) => d.highlight)?.label).toBe('12:00')
    expect(peakHour(byHour)).toBe(12)
    expect(hourChartData(new Array(24).fill(0))).toEqual([])
    expect(peakHour(new Array(24).fill(0))).toBeNull()
  })

  it('dayStats averages over days with sales only', () => {
    const rows: ReportDayRow[] = [
      { dayKey: '2026-09-01', sales: 100, bills: 2 },
      { dayKey: '2026-09-02', sales: 0, bills: 0 },
      { dayKey: '2026-09-03', sales: 300, bills: 3 },
    ]
    const s = dayStats(rows)
    expect(s.best?.dayKey).toBe('2026-09-03')
    expect(s.sellingDays).toBe(2)
    expect(s.avgPerSellingDay).toBe(200)
  })
})

describe('tier rows', () => {
  const rows = [
    tierRow({ key: 'a', name: 'ก', qty: 10, sales: 390, profit: 90 }),
    tierRow({ key: 'b', name: 'ข', qty: 2, sales: 518, profit: null }),
    tierRow({ key: 'c', name: 'ค', qty: 5, sales: 200, profit: 120 }),
  ]

  it('sorts by sales, quantity or profit (unknown profit last)', () => {
    expect(sortTierRows(rows, 'sales').map((r) => r.key)).toEqual(['b', 'a', 'c'])
    expect(sortTierRows(rows, 'qty').map((r) => r.key)).toEqual(['a', 'c', 'b'])
    expect(sortTierRows(rows, 'profit').map((r) => r.key)).toEqual(['c', 'a', 'b'])
  })

  it('categoryUnit', () => {
    const r = [
      tierRow({ name: 'รองเท้า', unit: 'คู่' }),
      tierRow({ name: 'รองเท้า', unit: 'คู่' }),
      tierRow({ name: 'ปนกัน', unit: 'ตัว' }),
      tierRow({ name: 'ปนกัน', unit: 'ใบ' }),
    ]
    expect(categoryUnit(r, 'รองเท้า')).toBe('คู่')
    expect(categoryUnit(r, 'ปนกัน')).toBe('ชิ้น')
  })
})

describe('csv', () => {
  it('bills csv has one row per non-deleted bill, oldest first', () => {
    const t = (h: number) => new Date(2026, 8, 29, h, 5).getTime()
    const a = mkSale({
      id: 'a',
      billNo: 2,
      createdAt: t(11),
      method: 'transfer',
      manualDiscount: 9,
      items: [mkItem({ tierId: 't39', name: 'เสื้อยืด', price: 39, qty: 3, promoQty: 3, promoPrice: 100 })],
    })
    const b = mkSale({
      id: 'b',
      billNo: 1,
      createdAt: t(10),
      status: 'void',
      voidReason: 'กดผิด',
      items: [mkItem({ name: 'ราคาอื่น, พิเศษ', price: 50, qty: 1 })],
    })
    const c = mkSale({ id: 'c', deleted: 1, items: [mkItem({ price: 10, qty: 1 })] })
    const rows = billsCsvRows(
      [a, b, c],
      () => 'แผง A',
      () => 'น้อย',
      (m) => (m === 'cash' ? 'เงินสด' : 'โอน'),
    )
    expect(rows).toHaveLength(3)
    expect(rows[1]).toEqual(['2026-09-29', '10:05', 'แผง A', 1, 'น้อย', 'ราคาอื่น, พิเศษ 50×1', 1, 50, 0, 0, 50, 'เงินสด', 'ยกเลิก', 'กดผิด'])
    expect(rows[2]).toEqual(['2026-09-29', '11:05', 'แผง A', 2, 'น้อย', 'เสื้อยืด 39×3=100', 3, 117, 17, 9, 91, 'โอน', 'จ่ายแล้ว', ''])
    const csv = toCsv(rows)
    expect(csv.split('\r\n')[1]).toContain('"ราคาอื่น, พิเศษ 50×1"')
  })

  it('items text joins lines', () => {
    const s = mkSale({ items: [mkItem({ name: 'ก', price: 10, qty: 2 }), mkItem({ name: 'ข', price: 5.5, qty: 1 })] })
    expect(saleItemsText(s)).toBe('ก 10×2; ข 5.50×1')
  })

  it('tier csv keeps unknown cost empty', () => {
    const rows = tiersCsvRows([tierRow({ qty: 3, sales: 100, cogs: null, profit: null })])
    expect(rows[1]).toEqual(['แผง A', 'เสื้อยืด', 39, 'ตัว', 3, 100, null, null])
    expect(toCsv(rows).split('\r\n')[1]).toBe('แผง A,เสื้อยืด,39,ตัว,3,100,,')
  })

  it('file names carry the range and booth', () => {
    expect(csvFileName('บิล', { from: '2026-09-29', to: '2026-09-29' })).toBe('บิล_2026-09-29.csv')
    expect(csvFileName('บิล', { from: '2026-09-01', to: '2026-09-29' }, 'แผง A/B')).toBe('บิล_2026-09-01_ถึง_2026-09-29_แผง-A-B.csv')
    expect(fileNamePart('  a:b  ')).toBe('a-b')
  })
})
