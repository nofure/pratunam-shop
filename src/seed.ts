// Starting data for the setup wizard, taken from the shop's price cards in the photos.
import { db, newId, save, saveMany } from './db'
import type { Booth, ShopConfig, Staff, Tier, TierColor } from './types'

interface TemplateTier {
  name: string
  price: number
  promoQty?: number
  promoPrice?: number
  unit: string
  color: TierColor
}

interface TemplateBooth {
  name: string
  tiers: TemplateTier[]
}

export const PHOTO_TEMPLATE: TemplateBooth[] = [
  {
    name: 'แผงเสื้อยืด',
    tiers: [
      { name: 'เสื้อยืด', price: 39, promoQty: 3, promoPrice: 100, unit: 'ตัว', color: 'yellow' },
      { name: 'เสื้อยืด', price: 59, promoQty: 2, promoPrice: 100, unit: 'ตัว', color: 'yellow' },
      { name: 'เสื้อสกรีน', price: 100, unit: 'ตัว', color: 'orange' },
      { name: 'ขาสั้น', price: 100, unit: 'ตัว', color: 'blue' },
      { name: 'เสื้อบอล', price: 139, unit: 'ตัว', color: 'green' },
      { name: 'เชิ้ตลาย', price: 159, unit: 'ตัว', color: 'pink' },
    ],
  },
  {
    name: 'แผงกางเกง',
    tiers: [
      { name: 'กางเกงผ้า', price: 100, unit: 'ตัว', color: 'yellow' },
      { name: 'กางเกงขาสั้น', price: 200, unit: 'ตัว', color: 'orange' },
      { name: 'สแล็ค', price: 259, unit: 'ตัว', color: 'blue' },
      { name: 'สแล็ค', price: 299, unit: 'ตัว', color: 'blue' },
      { name: 'สแล็คขายาว', price: 359, unit: 'ตัว', color: 'purple' },
      { name: 'ยีนส์', price: 399, unit: 'ตัว', color: 'gray' },
    ],
  },
  {
    name: 'แผงรองเท้า',
    tiers: [
      { name: 'รองเท้าแตะ', price: 100, unit: 'คู่', color: 'yellow' },
      { name: 'หัวโต', price: 100, unit: 'คู่', color: 'pink' },
      { name: 'ผ้าใบ', price: 129, unit: 'คู่', color: 'blue' },
      { name: 'ผ้าใบ', price: 159, unit: 'คู่', color: 'blue' },
      { name: 'ผ้าใบ', price: 199, unit: 'คู่', color: 'purple' },
      { name: 'กระเป๋าเป้', price: 199, unit: 'ใบ', color: 'gray' },
    ],
  },
]

export interface InitialSetup {
  shopName: string
  ownerName: string
  ownerPin: string
  promptPayId: string
  promptPayName: string
  halfHalfEnabled: boolean
  /** 'photos' = PHOTO_TEMPLATE, 'empty' = only the booth names given in boothNames */
  template: 'photos' | 'empty'
  boothNames: string[]
  openingFloat: number
}

/** Create shop config, owner account, booths and price buttons. Returns the owner. */
export async function createInitialData(s: InitialSetup): Promise<Staff> {
  return db.transaction('rw', [db.shop, db.staff, db.booths, db.tiers], async () => {
    await save<ShopConfig>(db.shop, {
      id: 'shop',
      name: s.shopName.trim() || 'ร้านของฉัน',
      promptPayId: s.promptPayId.replace(/\D/g, ''),
      promptPayName: s.promptPayName.trim(),
      halfHalfEnabled: s.halfHalfEnabled ? 1 : 0,
      otherPayEnabled: 0,
      otherPayLabel: 'อื่นๆ',
      voidNeedsOwner: 1,
      setupDone: 1,
    })
    const owner = await save<Staff>(db.staff, {
      name: s.ownerName.trim() || 'เจ้าของ',
      pin: s.ownerPin,
      role: 'owner',
      boothId: null,
      active: 1,
    })
    const booths = s.template === 'photos' ? PHOTO_TEMPLATE : s.boothNames.filter(Boolean).map((name) => ({ name, tiers: [] }))
    for (let i = 0; i < booths.length; i++) {
      const tb = booths[i]
      const booth = await save<Booth>(db.booths, {
        id: newId(),
        name: tb.name,
        openingFloat: s.openingFloat,
        sort: i,
        active: 1,
      })
      await saveMany<Tier>(
        db.tiers,
        tb.tiers.map((t, j) => ({
          boothId: booth.id,
          name: t.name,
          price: t.price,
          promoQty: t.promoQty ?? null,
          promoPrice: t.promoPrice ?? null,
          unit: t.unit,
          color: t.color,
          sort: j,
          active: 1 as const,
          trackStock: 1 as const,
          lowStock: 5,
        })),
      )
    }
    return owner
  })
}
