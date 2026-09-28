import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { ShopDB, alive, save, saveMany } from '../db'
import { computeShiftTotals } from '../domain/shift'
import { promoLineTotal } from '../domain/pricing'
import type { Booth, ShopConfig, Shift, Staff, Tier } from '../types'
import { DEMO_STAFF_NAME, DEMO_STAFF_PIN, DemoError, cashBreakdown, generateDemoData, mulberry32 } from './demo'

const TODAY = '2026-09-29'
const dbs: ShopDB[] = []
let n = 0
function makeDb(): ShopDB {
  const d = new ShopDB(`demo-test-${++n}`)
  dbs.push(d)
  return d
}
afterEach(async () => {
  while (dbs.length) await dbs.pop()!.delete()
})

async function seed(d: ShopDB, withTiers = true) {
  await save<ShopConfig>(d.shop, {
    id: 'shop',
    name: 'ร้านทดสอบ',
    promptPayId: '',
    promptPayName: '',
    halfHalfEnabled: 1,
    otherPayEnabled: 0,
    otherPayLabel: 'อื่นๆ',
    voidNeedsOwner: 1,
    setupDone: 1,
  })
  const owner = await save<Staff>(d.staff, { name: 'เจ้าของ', pin: '2580', role: 'owner', boothId: null, active: 1 })
  const b1 = await save<Booth>(d.booths, { name: 'แผงเสื้อ', openingFloat: 1000, sort: 0, active: 1 })
  const b2 = await save<Booth>(d.booths, { name: 'แผงรองเท้า', openingFloat: 500, sort: 1, active: 1 })
  if (withTiers) {
    const t = (boothId: string, name: string, price: number, sort: number, promoQty: number | null = null, promoPrice: number | null = null) => ({
      boothId,
      name,
      price,
      promoQty,
      promoPrice,
      unit: 'ตัว',
      color: 'yellow' as const,
      sort,
      active: 1 as const,
      trackStock: 1 as const,
      lowStock: 5,
    })
    await saveMany<Tier>(d.tiers, [
      t(b1.id, 'เสื้อยืด', 39, 0, 3, 100),
      t(b1.id, 'เสื้อยืด', 59, 1, 2, 100),
      t(b1.id, 'เสื้อบอล', 139, 2),
      t(b2.id, 'ผ้าใบ', 129, 0),
      t(b2.id, 'ผ้าใบ', 199, 1),
    ])
  }
  return { owner, b1, b2 }
}

describe('demo data', () => {
  it('prng is deterministic', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 5; i++) expect(a()).toBe(b())
  })

  it('breaks cash into notes', () => {
    expect(cashBreakdown(1789)).toEqual({ '1000': 1, '500': 1, '100': 2, '50': 1, '20': 1, '10': 1, '5': 1, '2': 2 })
  })

  it('fills past days only with consistent shifts and bills', async () => {
    const d = makeDb()
    const { b1 } = await seed(d)
    // Today's open shift must stay untouched.
    const open = await save<Shift>(d.shifts, {
      boothId: b1.id,
      staffId: 'x',
      dayKey: TODAY,
      openedAt: Date.now(),
      openingFloat: 1000,
      status: 'open',
      closedAt: null,
      closedBy: null,
      countedCash: null,
      denominations: null,
      expectedCash: null,
      cashDiff: null,
      transferChecked: 0,
      halfhalfChecked: 0,
      note: null,
      snapshot: null,
    })

    const res = await generateDemoData({ days: 14, today: TODAY, database: d })
    expect(res.shifts).toBe(28)
    expect(res.staffCreated).toBe(true)
    expect(res.lots).toBeGreaterThan(0)
    expect(res.expenses).toBeGreaterThan(0)

    const staff = alive(await d.staff.toArray())
    const demo = staff.find((s) => s.name === DEMO_STAFF_NAME)
    expect(demo?.pin).toBe(DEMO_STAFF_PIN)

    const shifts = alive(await d.shifts.toArray()).filter((s) => s.id !== open.id)
    expect(shifts.every((s) => s.dayKey < TODAY && s.dayKey >= '2026-09-15' && s.status === 'closed')).toBe(true)
    expect((await d.shifts.get(open.id))?.status).toBe('open')
    expect((await d.shifts.get(open.id))?.updatedAt).toBe(open.updatedAt)

    const sales = alive(await d.sales.toArray())
    const moves = alive(await d.cashMoves.toArray())
    for (const sh of shifts) {
      const ss = sales.filter((s) => s.shiftId === sh.id)
      expect(ss.length).toBeGreaterThanOrEqual(25)
      expect(ss.length).toBeLessThanOrEqual(80)
      const mv = moves.filter((m) => m.shiftId === sh.id)
      expect(mv.some((m) => m.category === 'food')).toBe(true)
      const totals = computeShiftTotals(sh.openingFloat, ss, mv)
      expect(sh.expectedCash).toBe(totals.expectedCash)
      expect([0, -20, -50, 10]).toContain(sh.cashDiff)
      for (const s of ss) {
        expect(s.dayKey).toBe(sh.dayKey)
        expect(s.createdAt).toBeGreaterThan(sh.openedAt)
        expect(s.createdAt).toBeLessThan(sh.closedAt!)
        expect(s.total).toBeGreaterThanOrEqual(0)
        expect(s.total).toBe(s.subtotal - s.promoDiscount - s.manualDiscount)
        expect(s.pieces).toBe(s.items.reduce((a, i) => a + i.qty, 0))
        for (const i of s.items) expect(i.lineTotal).toBe(promoLineTotal(i.price, i.qty, i.promoQty, i.promoPrice))
        if (s.method === 'cash') expect(s.change).toBe((s.cashReceived ?? 0) - s.total)
        else expect(s.cashReceived).toBeNull()
      }
    }
    const methods = new Set(sales.map((s) => s.method))
    expect(methods.has('cash') && methods.has('transfer') && methods.has('halfhalf')).toBe(true)

    const tiers = alive(await d.tiers.toArray())
    for (const lot of alive(await d.lots.toArray())) {
      const t = tiers.find((x) => x.id === lot.tierId)!
      expect(lot.qty).toBeGreaterThanOrEqual(40)
      expect(lot.qty).toBeLessThanOrEqual(300)
      expect(lot.unitCost / t.price).toBeGreaterThan(0.35)
      expect(lot.unitCost / t.price).toBeLessThan(0.75)
      expect(lot.dayKey < TODAY).toBe(true)
    }
    const suppliers = alive(await d.suppliers.toArray()).map((s) => s.name)
    expect(suppliers).toContain('ร้านส่งโบ๊เบ๊')

    // Running again does not duplicate anything.
    const again = await generateDemoData({ days: 14, today: TODAY, database: d })
    expect(again.shifts).toBe(0)
    expect(again.skipped).toBe(28)
    expect(alive(await d.shifts.toArray())).toHaveLength(29)
  })

  it('refuses when there are no price buttons', async () => {
    const d = makeDb()
    await seed(d, false)
    await expect(generateDemoData({ days: 3, today: TODAY, database: d })).rejects.toBeInstanceOf(DemoError)
  })
})
