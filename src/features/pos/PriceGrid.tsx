import type { CSSProperties } from 'react'
import { PenLine } from 'lucide-react'
import { TIER_COLORS } from '../../constants'
import { baht } from '../../lib/format'
import type { Tier } from '../../types'
import { promoText } from './util'

interface Props {
  tiers: Tier[]
  /** Pieces of each tier already in the cart (by tier id). */
  qtyByTier: Map<string, number>
  onAdd: (t: Tier) => void
  onCustom: () => void
}

/** Price buttons that look like the shop's rack price cards. Tap = +1. */
export default function PriceGrid({ tiers, qtyByTier, onAdd, onCustom }: Props) {
  return (
    <div className="pos-grid">
      {tiers.map((t) => {
        const c = TIER_COLORS[t.color] ?? TIER_COLORS.gray
        const qty = qtyByTier.get(t.id) ?? 0
        const promo = promoText(t.promoQty, t.promoPrice, t.unit)
        const price = baht(t.price)
        const label = `${t.name} ${price} บาท${promo ? ` โปร ${promo}` : ''}${qty > 0 ? ` ในตะกร้า ${qty} ${t.unit}` : ''}`
        return (
          <button
            key={t.id}
            type="button"
            className={'pos-tier' + (qty > 0 ? ' in-cart' : '')}
            style={{ background: c.bg, '--tier-fg': c.fg } as CSSProperties}
            aria-label={label}
            onClick={() => onAdd(t)}
          >
            <span className={'pos-tier-price num' + (price.length >= 4 ? ' long' : '')} aria-hidden="true">
              {price}
            </span>
            <span className="pos-tier-name" aria-hidden="true">
              {t.name}
            </span>
            {promo && (
              <span className="pos-tier-promo" aria-hidden="true">
                {promo}
              </span>
            )}
            {qty > 0 && (
              <span key={qty} className="pos-tier-qty num" aria-hidden="true">
                {qty}
              </span>
            )}
          </button>
        )
      })}
      <button type="button" className="pos-tier pos-tier-custom" onClick={onCustom}>
        <PenLine size={28} aria-hidden="true" />
        <span className="pos-tier-name">ราคาอื่น</span>
      </button>
    </div>
  )
}
