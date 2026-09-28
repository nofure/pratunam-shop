import type { ReactNode } from 'react'
import { Banknote, CreditCard, HandCoins, Minus, Plus, QrCode, ShoppingBasket, Tag, Trash, X } from 'lucide-react'
import { promoLineTotal, type CartLine, type CartTotals } from '../../domain/pricing'
import { baht, round2 } from '../../lib/format'
import type { PayMethod, ShopConfig } from '../../types'
import { Button, EmptyState, IconButton, Money } from '../../ui'
import { methodLabel, promoText } from './util'

// ---------- lines ----------

interface LinesProps {
  lines: CartLine[]
  onQty: (key: string, qty: number) => void
  onEditQty: (line: CartLine) => void
}

export function CartLines({ lines, onQty, onEditQty }: LinesProps) {
  if (lines.length === 0)
    return (
      <EmptyState
        compact
        icon={<ShoppingBasket size={28} />}
        title="ยังไม่มีของในตะกร้า"
        hint="แตะปุ่มราคาเพื่อเพิ่มของ"
      />
    )
  return (
    <ul className="pos-lines">
      {lines.map((l) => {
        const full = round2(l.price * l.qty)
        const total = promoLineTotal(l.price, l.qty, l.promoQty, l.promoPrice)
        const promo = promoText(l.promoQty, l.promoPrice, l.unit)
        const promoUsed = total < full
        return (
          <li key={l.key} className="pos-line">
            <div className="pos-line-info">
              <span className="pos-line-name">
                {l.name} <span className="num">{baht(l.price)}</span>
              </span>
              <span className="pos-line-sub">
                <Money value={total} className="pos-line-total" />
                {promoUsed && (
                  <>
                    <s className="pos-line-full num">฿{baht(full)}</s>
                    <span className="pos-line-promo">โปร {promo}</span>
                  </>
                )}
                {!promoUsed && promo && <span className="pos-line-hint">โปร {promo}</span>}
              </span>
            </div>
            <div className="pos-stepper">
              <IconButton
                label={l.qty === 1 ? `เอา ${l.name} ${baht(l.price)} ออก` : `ลด ${l.name} ${baht(l.price)} 1 ${l.unit}`}
                icon={l.qty === 1 ? <Trash size={20} /> : <Minus size={22} />}
                variant={l.qty === 1 ? 'danger' : 'secondary'}
                onClick={() => onQty(l.key, l.qty - 1)}
              />
              <button
                type="button"
                className="pos-stepper-qty num"
                aria-label={`จำนวน ${l.qty} ${l.unit} แตะเพื่อแก้`}
                onClick={() => onEditQty(l)}
              >
                {l.qty}
              </button>
              <IconButton
                label={`เพิ่ม ${l.name} ${baht(l.price)} 1 ${l.unit}`}
                icon={<Plus size={22} />}
                variant="secondary"
                onClick={() => onQty(l.key, l.qty + 1)}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ---------- totals ----------

interface SummaryProps {
  totals: CartTotals
  onDiscount: () => void
  onClearDiscount: () => void
  onClear: () => void
}

export function CartSummary({ totals, onDiscount, onClearDiscount, onClear }: SummaryProps) {
  const empty = totals.items.length === 0
  const hasDeductions = totals.promoDiscount > 0 || totals.manualDiscount > 0
  return (
    <div className="pos-summary">
      {hasDeductions && (
        <div className="pos-sum-row">
          <span>รวม {totals.pieces} ชิ้น</span>
          <Money value={totals.subtotal} />
        </div>
      )}
      {totals.promoDiscount > 0 && (
        <div className="pos-sum-row tone-success">
          <span>ลดตามโปร</span>
          <span className="money num">−฿{baht(totals.promoDiscount)}</span>
        </div>
      )}
      {totals.manualDiscount > 0 && (
        <div className="pos-sum-row pos-sum-discount">
          <span className="pos-sum-discount-label">
            ลูกค้าต่อ
            <IconButton label="ไม่ลดแล้ว" icon={<X size={18} />} onClick={onClearDiscount} className="pos-sum-x" />
          </span>
          <span className="money num">−฿{baht(totals.manualDiscount)}</span>
        </div>
      )}
      <div className="pos-sum-total">
        <span className="pos-sum-total-label">
          ยอดรับ
          {!empty && <span className="pos-sum-pieces">{totals.pieces} ชิ้น</span>}
        </span>
        <Money value={totals.total} size="xl" />
      </div>
      <div className="pos-sum-actions">
        <Button icon={<Tag size={20} />} onClick={onDiscount} disabled={empty}>
          ลด / ต่อราคา
        </Button>
        <Button variant="ghost" icon={<Trash size={20} />} onClick={onClear} disabled={empty} className="pos-clear">
          ล้างตะกร้า
        </Button>
      </div>
    </div>
  )
}

// ---------- payment buttons ----------

interface PayProps {
  shop: ShopConfig
  disabled: boolean
  onPay: (m: PayMethod) => void
}

export function PayButtons({ shop, disabled, onPay }: PayProps) {
  const others: { m: PayMethod; icon: ReactNode }[] = [{ m: 'transfer', icon: <QrCode size={22} /> }]
  if (shop.halfHalfEnabled === 1) others.push({ m: 'halfhalf', icon: <HandCoins size={22} /> })
  if (shop.otherPayEnabled === 1) others.push({ m: 'other', icon: <CreditCard size={22} /> })
  return (
    <div className="pos-pay">
      <Button
        variant="primary"
        size="xl"
        block
        icon={<Banknote size={26} />}
        disabled={disabled}
        onClick={() => onPay('cash')}
      >
        เงินสด
      </Button>
      <div className={'pos-pay-others cols-' + others.length}>
        {others.map((o) => (
          <Button key={o.m} size="lg" icon={o.icon} disabled={disabled} onClick={() => onPay(o.m)}>
            {methodLabel(o.m, shop)}
          </Button>
        ))}
      </div>
    </div>
  )
}
