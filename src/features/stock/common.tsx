// Small building blocks shared by the stock pages.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Info, Lock, Store, Trash2 } from 'lucide-react'
import { db, remove } from '../../db'
import { TIER_COLORS } from '../../constants'
import { useSession } from '../../session'
import type { TierStock } from '../../domain/stock'
import { hasPromo } from '../../domain/pricing'
import type { Lot, Tier } from '../../types'
import { baht, bahtSign, num, thaiDate } from '../../lib/format'
import { Badge, Button, EmptyState, IconButton, Money, cx, useConfirm, useToast } from '../../ui'
import { boothNameOf, useStockBooth } from './data'
import { promoText, qtyText } from './logic'

export function Loading() {
  return <div className="page-loading">กำลังโหลด…</div>
}

// ---------- tier display ----------

type TagTier = Pick<Tier, 'color' | 'price' | 'promoQty' | 'promoPrice'>

/** Mini price card like the shop's rack tags. */
export function TierTag({ tier, size = 'md' }: { tier: TagTier; size?: 'sm' | 'md' }) {
  const c = TIER_COLORS[tier.color] ?? TIER_COLORS.gray
  const promo = size === 'md' && hasPromo(tier.promoQty, tier.promoPrice) ? `${tier.promoQty}/${baht(tier.promoPrice as number)}` : null
  return (
    <span className={cx('stock-tag', size === 'sm' && 'stock-tag-sm')} style={{ background: c.bg, color: c.fg }} aria-hidden="true">
      <span className="stock-tag-price">{baht(tier.price)}</span>
      {promo && <span className="stock-tag-promo">{promo}</span>}
    </span>
  )
}

/** "เสื้อยืด ฿39" + promo + hidden/deleted badge. */
export function TierTitle({ tier, className }: { tier: Tier | undefined; className?: string }) {
  if (!tier) return <span className={cx('stock-tier-title', className)}>ปุ่มราคาที่ไม่พบ</span>
  const promo = promoText(tier)
  return (
    <span className={cx('stock-tier-title', className)}>
      <span className="stock-tier-name">
        {tier.name} <span className="num">{bahtSign(tier.price)}</span>
      </span>
      {promo && <span className="stock-tier-promo">โปร {promo}</span>}
      {tier.deleted === 1 ? (
        <Badge tone="danger">ลบแล้ว</Badge>
      ) : tier.active !== 1 ? (
        <Badge>ซ่อนอยู่</Badge>
      ) : null}
    </span>
  )
}

/** Quantity with unit: "36 ตัว". */
export function Qty({ n, unit, className }: { n: number; unit?: string; className?: string }) {
  return (
    <span className={cx('num', className)}>
      {num(n, 2)}
      {unit ? <span className="stock-unit"> {unit}</span> : null}
    </span>
  )
}

// ---------- booth ----------

/** Booth chips for the owner; a plain label for staff (who stay on the device's booth). */
export function BoothBar() {
  const { boothId, setBoothId, booths, allBooths, canPick } = useStockBooth()
  if (!canPick || booths.length <= 1) {
    if (!boothId) return null
    return (
      <p className="stock-boothname">
        <Store size={18} aria-hidden="true" />
        <span>{boothNameOf(allBooths, boothId)}</span>
      </p>
    )
  }
  return (
    <div className="stock-chips" role="group" aria-label="เลือกแผง">
      {booths.map((b) => (
        <button
          key={b.id}
          type="button"
          className={cx('chip', b.id === boothId && 'active')}
          aria-pressed={b.id === boothId}
          onClick={() => setBoothId(b.id)}
        >
          {b.name}
        </button>
      ))}
    </div>
  )
}

/** Shown when there is no booth to work with. */
export function NoBooth() {
  const { canPick } = useStockBooth()
  if (canPick)
    return (
      <EmptyState
        icon={<Store size={28} />}
        title="ยังไม่มีแผง"
        hint="เพิ่มแผงก่อน แล้วค่อยรับของเข้าและดูสต็อก"
        action={
          <Link to="/settings/booths" className="btn btn-primary">
            ไปที่ตั้งค่า
          </Link>
        }
      />
    )
  return (
    <EmptyState
      icon={<Store size={28} />}
      title="เครื่องนี้ยังไม่ได้เลือกแผง"
      hint="กดที่ชื่อแผงบนแถบด้านบน แล้วเลือกแผงที่เครื่องนี้ใช้ขาย"
    />
  )
}

/** Shown when the booth has no price buttons yet. */
export function NoTiers() {
  const { isOwner } = useSession()
  return (
    <EmptyState
      title="แผงนี้ยังไม่มีปุ่มราคา"
      hint={isOwner ? 'สต็อกนับตามปุ่มราคา เพิ่มปุ่มราคาของแผงนี้ก่อน' : 'ให้เจ้าของร้านเพิ่มปุ่มราคาของแผงนี้ก่อน'}
      action={
        isOwner ? (
          <Link to="/settings/tiers" className="btn btn-primary">
            ไปที่ตั้งค่า
          </Link>
        ) : undefined
      }
    />
  )
}

// ---------- access & errors ----------

export function OwnerGate({ children }: { children: ReactNode }) {
  const { isOwner } = useSession()
  if (isOwner) return <>{children}</>
  return (
    <EmptyState
      icon={<Lock size={28} />}
      title="หน้านี้สำหรับเจ้าของร้าน"
      hint="เข้าสู่ระบบด้วย PIN ของเจ้าของเพื่อใช้หน้านี้"
      action={
        <Link to="/stock" className="btn btn-secondary">
          ดูของคงเหลือ
        </Link>
      }
    />
  )
}

interface BoundaryState {
  error: Error | null
}

/** Catches a failed database read so one page error doesn't blank the whole app. */
export class StockErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('stock page error', error, info.componentStack)
  }

  render() {
    if (this.state.error)
      return (
        <EmptyState
          icon={<AlertTriangle size={28} />}
          title="เปิดหน้านี้ไม่สำเร็จ"
          hint="ข้อมูลในเครื่องยังอยู่ครบ ลองอีกครั้ง ถ้ายังไม่ได้ให้ปิดแอปแล้วเปิดใหม่"
          action={
            <Button variant="primary" onClick={() => this.setState({ error: null })}>
              ลองอีกครั้ง
            </Button>
          }
        />
      )
    return this.props.children
  }
}

// ---------- callout ----------

export function Callout({ tone = 'info', children }: { tone?: 'info' | 'warning'; children: ReactNode }) {
  return (
    <div className={cx('stock-callout', `stock-callout-${tone}`)}>
      {tone === 'warning' ? <AlertTriangle size={20} aria-hidden="true" /> : <Info size={20} aria-hidden="true" />}
      <div className="stock-callout-body">{children}</div>
    </div>
  )
}

// ---------- tier picker ----------

export function TierPicker({
  tiers,
  value,
  onChange,
  stock,
  invalid,
}: {
  tiers: Tier[]
  value: string | null
  onChange: (id: string) => void
  stock?: Map<string, TierStock>
  invalid?: boolean
}) {
  return (
    <div className={cx('stock-tier-grid', invalid && 'is-invalid')} role="group" aria-label="ปุ่มราคา">
      {tiers.map((t) => {
        const s = stock?.get(t.id)
        const selected = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            className={cx('stock-tier-btn', selected && 'selected')}
            aria-pressed={selected}
            onClick={() => onChange(t.id)}
          >
            <TierTag tier={t} size="sm" />
            <span className="stock-tier-btn-text">
              <span className="stock-tier-btn-name">{t.name}</span>
              {s && t.trackStock === 1 && (s.received !== 0 || s.adjusted !== 0) ? (
                <span className="stock-tier-btn-sub num">
                  เหลือ {qtyText(s.onHand)} {t.unit}
                </span>
              ) : t.trackStock !== 1 ? (
                <span className="stock-tier-btn-sub">ไม่นับสต็อก</span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ---------- lots ----------

/** Confirm + soft-delete a received lot. */
export function useDeleteLot() {
  const confirm = useConfirm()
  const toast = useToast()
  return async (lot: Lot, tier: Tier | undefined) => {
    const ok = await confirm({
      title: 'ลบรายการรับเข้านี้',
      message: `${tier ? `${tier.name} ${bahtSign(tier.price)} · ` : ''}${num(lot.qty, 2)} ${tier?.unit ?? 'ชิ้น'} ทุนรวม ${bahtSign(lot.totalCost)}\nของคงเหลือและทุนเฉลี่ยของปุ่มนี้จะเปลี่ยนตาม และกำไรในรายงานจะคิดใหม่`,
      confirmText: 'ลบ',
      danger: true,
    })
    if (!ok) return
    try {
      await remove(db.lots, lot.id)
      toast('ลบแล้ว', 'success')
    } catch (e) {
      console.error(e)
      toast('ลบไม่สำเร็จ ลองอีกครั้ง', 'error')
    }
  }
}

export function LotRow({
  lot,
  tier,
  supplierName,
  boothName,
  staffName,
  onDelete,
}: {
  lot: Lot
  tier: Tier | undefined
  supplierName?: string | null
  boothName?: string | null
  staffName?: string | null
  onDelete?: () => void
}) {
  const unit = tier?.unit ?? 'ชิ้น'
  const parts = [
    thaiDate(lot.dayKey),
    boothName,
    `ทุน${unit}ละ ${bahtSign(lot.unitCost)}`,
    supplierName ? `ร้าน ${supplierName}` : null,
    staffName ? `โดย ${staffName}` : null,
  ].filter(Boolean)
  return (
    <div className="list-row stock-lot-row">
      {tier ? <TierTag tier={tier} size="sm" /> : <span className="stock-tag stock-tag-sm stock-tag-missing">?</span>}
      <div className="list-main">
        <span className="list-title">
          {tier ? `${tier.name} ${bahtSign(tier.price)}` : 'ปุ่มราคาที่ไม่พบ'} ·{' '}
          <span className="num">
            {num(lot.qty, 2)} {unit}
          </span>
        </span>
        <span className="list-sub">{parts.join(' · ')}</span>
        {lot.note && <span className="list-sub stock-note">{lot.note}</span>}
      </div>
      <div className="stock-row-end">
        <Money value={lot.totalCost} />
        {onDelete && (
          <IconButton label="ลบรายการนี้" icon={<Trash2 size={20} />} variant="danger" onClick={onDelete} />
        )}
      </div>
    </div>
  )
}
