// Small helpers shared by the POS and bills screens.
import { PAY_METHOD_LABEL } from '../../constants'
import { hasPromo } from '../../domain/pricing'
import { baht, round2 } from '../../lib/format'
import type { PayMethod, SaleItem, ShopConfig } from '../../types'
import type { BadgeTone } from '../../ui'

/** Short haptic tick for price-button taps (ignored where unsupported). */
export function tapFeedback(ms = 8): void {
  try {
    const nav = navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
    if (nav.userActivation && !nav.userActivation.hasBeenActive) return
    nav.vibrate?.(ms)
  } catch {
    /* not allowed — ignore */
  }
}

/** Payment method label; 'other' uses the shop's own label (e.g. 'บัตรเครดิต'). */
export function methodLabel(m: PayMethod, shop?: ShopConfig | null): string {
  if (m === 'other') return shop?.otherPayLabel?.trim() || PAY_METHOD_LABEL.other
  return PAY_METHOD_LABEL[m] ?? PAY_METHOD_LABEL.other
}

export const METHOD_TONE: Record<PayMethod, BadgeTone> = {
  cash: 'success',
  transfer: 'info',
  halfhalf: 'warning',
  other: 'neutral',
}

/** '3 ตัว 100' for a quantity promo, '' when there is none. */
export function promoText(promoQty: number | null, promoPrice: number | null, unit: string): string {
  if (!hasPromo(promoQty, promoPrice)) return ''
  return `${promoQty} ${unit || 'ชิ้น'} ${baht(promoPrice as number)}`
}

/** 'เสื้อยืด 39 ×4, ขาสั้น 100 ×1' */
export function itemsSummary(items: SaleItem[]): string {
  return items.map((i) => `${i.name} ${baht(i.price)} ×${i.qty}`).join(', ')
}

/**
 * Discount that drops the amount to the nearest lower multiple of 10 (ปัดเศษ): 139 → 9 (pays 130).
 * 0 when the amount is already round or below 10 (never makes a bill free).
 */
export function roundDownDiscount(amount: number): number {
  if (!Number.isFinite(amount) || amount < 10) return 0
  return round2(amount - Math.floor(amount / 10 + 1e-9) * 10)
}
