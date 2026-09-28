// Small building blocks shared by the report cards.
import type { ReactNode } from 'react'
import { ChevronDown, ChevronUp, Info, TriangleAlert } from 'lucide-react'
import { Button, Money, cx } from '../../ui'
import { TIER_COLORS } from '../../constants'
import { baht } from '../../lib/format'
import { cashDiffText, cashDiffTone } from '../../domain/shift'
import type { TierColor } from '../../types'
import { formatPct } from './logic'

/** Price shown like the shop's price cards (tier colour). */
export function PriceTag({ price, color }: { price: number; color?: TierColor | null }) {
  const c = TIER_COLORS[color ?? 'gray'] ?? TIER_COLORS.gray
  return (
    <span className="rep-tag num" style={{ background: c.bg, color: c.fg }}>
      {baht(price)}
    </span>
  )
}

/** "ดูทั้งหมด (N)" / "ย่อ" toggle under a long list. Renders nothing when everything already fits. */
export function ShowMore({ total, limit, open, onToggle }: { total: number; limit: number; open: boolean; onToggle: () => void }) {
  if (total <= limit) return null
  return (
    <Button
      variant="ghost"
      block
      className="rep-more"
      icon={open ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
      onClick={onToggle}
      aria-expanded={open}
    >
      {open ? 'ย่อ' : `ดูทั้งหมด (${total})`}
    </Button>
  )
}

/** ตรง / ขาด 20 / เกิน 15 in green / red / orange. */
export function CashDiff({ diff, className }: { diff: number; className?: string }) {
  const tone = cashDiffTone(diff)
  return (
    <span className={cx('rep-diff num', tone === 'ok' ? 'tone-success' : tone === 'short' ? 'tone-danger' : 'tone-warning', className)}>
      {cashDiffText(diff)}
    </span>
  )
}

/** +12% (green) / −8% (red) / เท่าเดิม. */
export function Delta({ p }: { p: number | null }) {
  if (p === null) return null
  return <span className={cx('rep-delta num', p > 0 && 'tone-success', p < 0 && 'tone-danger')}>{formatPct(p)}</span>
}

export function Note({ tone = 'info', children }: { tone?: 'info' | 'warning'; children: ReactNode }) {
  return (
    <div className={cx('rep-note-box', `rep-note-${tone}`)} role={tone === 'warning' ? 'alert' : undefined}>
      <span className="rep-note-icon" aria-hidden="true">
        {tone === 'warning' ? <TriangleAlert size={18} /> : <Info size={18} />}
      </span>
      <div className="rep-note-text">{children}</div>
    </div>
  )
}

/** Label / amount row of a money breakdown. */
export function Line({
  label,
  value,
  sub,
  strong = false,
  big = false,
  tone,
  indent = false,
  extra,
}: {
  label: ReactNode
  value: number
  sub?: ReactNode
  strong?: boolean
  big?: boolean
  tone?: 'success' | 'danger'
  indent?: boolean
  extra?: ReactNode
}) {
  return (
    <div className={cx('rep-line', strong && 'strong', big && 'big', indent && 'indent')}>
      <dt>
        <span>{label}</span>
        {sub !== undefined && sub !== null && <span className="rep-line-sub">{sub}</span>}
      </dt>
      <dd>
        {extra}
        <Money value={value} size={big ? 'lg' : 'md'} tone={tone ?? 'default'} />
      </dd>
    </div>
  )
}

export function CardLoading() {
  return (
    <div className="rep-card-loading" role="status">
      กำลังโหลด…
    </div>
  )
}
