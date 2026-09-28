// Small building blocks shared by the shift page, the close sheet and the history page.
import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownLeft, ArrowUpRight, Check, MessageCircle, Share2, Trash2 } from 'lucide-react'
import { db } from '../../db'
import { EXPENSE_CATEGORY_LABEL, PAY_METHOD_LABEL } from '../../constants'
import { cashDiffText, cashDiffTone } from '../../domain/shift'
import { lineShareUrl } from '../../domain/summary'
import { baht, bahtSign, num, round2, timeHM } from '../../lib/format'
import { shareOrCopy } from '../../lib/share'
import type { CashMove, ID, PayMethod, ShiftTotals, ShopConfig } from '../../types'
import { Badge, Button, EmptyState, IconButton, Money, Spinner, cx, useToast } from '../../ui'

// ---------------------------------------------------------------- names

/** Staff name lookup that also knows deleted / inactive staff (history keeps their names). */
export function useStaffNames(): (id: ID | null | undefined) => string {
  const rows = useLiveQuery(() => db.staff.toArray(), [])
  return useMemo(() => {
    const m = new Map((rows ?? []).map((s) => [s.id, s.name]))
    return (id) => (id ? (m.get(id) ?? (rows ? 'ไม่ทราบชื่อ' : '…')) : '–')
  }, [rows])
}

/** Booth name lookup including deleted / inactive booths. */
export function useBoothNames(): (id: ID | null | undefined) => string {
  const rows = useLiveQuery(() => db.booths.toArray(), [])
  return useMemo(() => {
    const m = new Map((rows ?? []).map((b) => [b.id, b.name]))
    return (id) => (id ? (m.get(id) ?? (rows ? 'แผงที่ถูกลบ' : '…')) : '–')
  }, [rows])
}

// ---------------------------------------------------------------- loading / errors

export function Loading({ label = 'กำลังโหลด…' }: { label?: string }) {
  return (
    <div className="shift-loading">
      <Spinner size={22} />
      <span>{label}</span>
    </div>
  )
}

interface BoundaryState {
  error: unknown
}

/** Shows a retry screen instead of a blank page if a query or render fails. */
export class ShiftErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('shift page failed', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <EmptyState
            title="โหลดข้อมูลไม่สำเร็จ"
            hint="ลองใหม่อีกครั้ง ถ้ายังไม่ได้ ให้ปิดแอปแล้วเปิดใหม่ ข้อมูลที่บันทึกไว้ไม่หาย"
            action={
              <Button variant="primary" onClick={() => this.setState({ error: null })}>
                ลองใหม่
              </Button>
            }
          />
        </div>
      )
    }
    return this.props.children
  }
}

// ---------------------------------------------------------------- cash difference

export function diffBadgeTone(diff: number): 'success' | 'danger' | 'warning' {
  const t = cashDiffTone(diff)
  return t === 'ok' ? 'success' : t === 'short' ? 'danger' : 'warning'
}

/** ตรง / ขาด N / เกิน N badge. `null` = the cash was never counted. */
export function DiffBadge({ diff }: { diff: number | null | undefined }) {
  if (diff === null || diff === undefined) return <Badge tone="neutral">ไม่ได้นับ</Badge>
  return <Badge tone={diffBadgeTone(diff)}>{cashDiffText(diff)}</Badge>
}

// ---------------------------------------------------------------- totals

/** Payment methods worth showing: cash + transfer always, the others when enabled or used. */
export function visibleMethods(shop: ShopConfig | null | undefined, byMethod: Record<PayMethod, number>): PayMethod[] {
  const out: PayMethod[] = ['cash', 'transfer']
  if (shop?.halfHalfEnabled === 1 || round2(byMethod.halfhalf) !== 0) out.push('halfhalf')
  if (shop?.otherPayEnabled === 1 || round2(byMethod.other) !== 0) out.push('other')
  return out
}

export function methodLabel(m: PayMethod, shop: ShopConfig | null | undefined): string {
  if (m === 'other') return shop?.otherPayLabel?.trim() || PAY_METHOD_LABEL.other
  return PAY_METHOD_LABEL[m]
}

export function MethodTotals({ totals, shop }: { totals: ShiftTotals; shop: ShopConfig | null | undefined }) {
  const methods = visibleMethods(shop, totals.byMethod)
  return (
    <div className="shift-methods">
      {methods.map((m) => (
        <div key={m} className="shift-method">
          <span className="shift-method-label">{methodLabel(m, shop)}</span>
          <Money value={totals.byMethod[m]} className="shift-method-value" />
        </div>
      ))}
    </div>
  )
}

/** Discounts and voided bills in one quiet line (hidden when there are none). */
export function DiscountLine({ totals }: { totals: ShiftTotals }) {
  const parts: ReactNode[] = []
  if (round2(totals.manualDiscount) > 0)
    parts.push(
      <span key="m">
        ลูกค้าต่อ <strong className="num">{bahtSign(totals.manualDiscount)}</strong>
      </span>,
    )
  if (round2(totals.promoDiscount) > 0)
    parts.push(
      <span key="p">
        ส่วนลดโปร <strong className="num">{bahtSign(totals.promoDiscount)}</strong>
      </span>,
    )
  if (totals.voidBills > 0)
    parts.push(
      <span key="v" className="tone-danger">
        ยกเลิก {num(totals.voidBills)} บิล <strong className="num">({bahtSign(totals.voidTotal)})</strong>
      </span>,
    )
  if (!parts.length) return <p className="shift-discounts muted">ไม่มีส่วนลดหรือบิลยกเลิก</p>
  return <p className="shift-discounts">{parts}</p>
}

/** เงินทอนตั้งต้น + ขายเงินสด + เงินเข้า − เงินออก = ควรมี */
export function CashBreakdown({
  openingFloat,
  totals,
  expected,
  counted,
}: {
  openingFloat: number
  totals: ShiftTotals
  /** stored expected cash of a closed shift (defaults to the computed one) */
  expected?: number | null
  counted?: number | null
}) {
  const exp = expected ?? totals.expectedCash
  return (
    <dl className="shift-kv">
      <div className="shift-kv-row">
        <dt>เงินทอนตั้งต้น</dt>
        <dd>
          <Money value={openingFloat} />
        </dd>
      </div>
      <div className="shift-kv-row">
        <dt>+ ขายเงินสด</dt>
        <dd>
          <Money value={totals.byMethod.cash} />
        </dd>
      </div>
      <div className="shift-kv-row">
        <dt>+ เงินเข้า</dt>
        <dd>
          <Money value={totals.cashIn} />
        </dd>
      </div>
      <div className="shift-kv-row">
        <dt>− เงินออก</dt>
        <dd>
          <Money value={totals.cashOut} />
        </dd>
      </div>
      <div className="shift-kv-row shift-kv-total">
        <dt>= ควรมีในลิ้นชัก</dt>
        <dd>
          <Money value={exp} size="lg" />
        </dd>
      </div>
      {counted !== undefined && counted !== null && (
        <>
          <div className="shift-kv-row">
            <dt>นับได้จริง</dt>
            <dd>
              <Money value={counted} />
            </dd>
          </div>
          <div className="shift-kv-row">
            <dt>ผลต่าง</dt>
            <dd>
              <DiffBadge diff={round2(counted - exp)} />
            </dd>
          </div>
        </>
      )}
    </dl>
  )
}

// ---------------------------------------------------------------- cash moves

export function CashMoveList({
  moves,
  staffName,
  canDelete,
  onDelete,
  showDate,
}: {
  moves: CashMove[]
  staffName: (id: ID | null | undefined) => string
  canDelete?: (m: CashMove) => boolean
  onDelete?: (m: CashMove) => void
  /** optional date shown before the time (e.g. moves recorded after midnight) */
  showDate?: (m: CashMove) => string | null
}) {
  const rows = [...moves].sort((a, b) => b.createdAt - a.createdAt)
  return (
    <ul className="shift-moves">
      {rows.map((m) => {
        const out = m.type === 'out'
        const datePrefix = showDate ? showDate(m) : null
        return (
          <li key={m.id} className="shift-move">
            <span className={cx('shift-move-icon', out ? 'is-out' : 'is-in')} aria-hidden="true">
              {out ? <ArrowUpRight size={20} /> : <ArrowDownLeft size={20} />}
            </span>
            <span className="shift-move-main">
              <span className="shift-move-reason">{m.reason}</span>
              <span className="shift-move-sub">
                {datePrefix ? `${datePrefix} ` : ''}
                {timeHM(m.createdAt)} · {staffName(m.staffId)}
                {out && m.category ? ` · ค่าใช้จ่าย: ${EXPENSE_CATEGORY_LABEL[m.category] ?? m.category}` : ''}
              </span>
            </span>
            <span className={cx('shift-move-amt num', out ? 'tone-danger' : 'tone-success')}>
              {out ? '−' : '+'}฿{baht(m.amount)}
            </span>
            {onDelete && canDelete?.(m) && (
              <IconButton
                label={`ลบรายการ ${m.reason}`}
                icon={<Trash2 size={20} />}
                variant="danger"
                onClick={() => onDelete(m)}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------- checkbox card

export function CheckCard({
  checked,
  onChange,
  label,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={cx('shift-check', checked && 'is-checked')}
      onClick={() => onChange(!checked)}
    >
      <span className="shift-check-box" aria-hidden="true">
        {checked && <Check size={22} strokeWidth={3} />}
      </span>
      <span className="shift-check-text">
        <span className="shift-check-label">{label}</span>
        {children}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------- share

/** "ส่งเข้า LINE" + "แชร์ / คัดลอก" (rendered as siblings so they fit a modal footer). */
export function ShareButtons({ text, title, size = 'lg' }: { text: string; title?: string; size?: 'md' | 'lg' }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const share = async () => {
    setBusy(true)
    try {
      const r = await shareOrCopy(text, title)
      if (r === 'copied') toast('คัดลอกข้อความแล้ว วางในแชตได้เลย', 'success')
      else if (r === 'failed' && typeof navigator.share !== 'function') toast('คัดลอกไม่สำเร็จ', 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <a
        className={cx('btn btn-primary', size === 'lg' && 'btn-lg')}
        href={lineShareUrl(text)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="btn-icon" aria-hidden="true">
          <MessageCircle size={22} />
        </span>
        <span className="btn-label">ส่งเข้า LINE</span>
      </a>
      <Button size={size} icon={<Share2 size={20} />} loading={busy} onClick={() => void share()}>
        แชร์ / คัดลอก
      </Button>
    </>
  )
}
