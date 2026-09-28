// Small pieces shared by the setup wizard, settings pages and login.
import { useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { TIER_COLORS } from '../../constants'
import { hasPromo } from '../../domain/pricing'
import { baht } from '../../lib/format'
import type { Role, TierColor } from '../../types'
import { Badge, PinPad, Segmented, cx } from '../../ui'
import { initialOf, isWeakPin } from './logic'

// ---------------------------------------------------------------- price card

export interface TierCardProps {
  name: string
  price: number | null
  promoQty?: number | null
  promoPrice?: number | null
  unit?: string
  color: TierColor
  inactive?: boolean
  small?: boolean
  onClick?: () => void
  className?: string
  children?: ReactNode
}

/** A price button drawn like the shop's rack cards: name on top, big red-ish price, promo line. */
export function TierCard({ name, price, promoQty = null, promoPrice = null, unit = '', color, inactive, small, onClick, className, children }: TierCardProps) {
  const c = TIER_COLORS[color] ?? TIER_COLORS.yellow
  const promo = hasPromo(promoQty, promoPrice) ? `${promoQty} ${unit || 'ชิ้น'} ${baht(promoPrice as number)}` : ''
  const body = (
    <>
      <span className="settings-card-name">{name || 'ชื่อสินค้า'}</span>
      <span className="settings-card-price num">{price != null && price > 0 ? baht(price) : '–'}</span>
      <span className="settings-card-promo">{promo || (unit ? `ต่อ${unit}` : ' ')}</span>
      {inactive && <span className="settings-card-off">ปิดใช้งาน</span>}
      {children}
    </>
  )
  const cls = cx('settings-card', small && 'settings-card-sm', inactive && 'is-off', !!promo && 'has-promo', className)
  const style = { background: c.bg, color: c.fg }
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick} aria-label={`${name} ${price ?? ''} บาท${promo ? ` โปร ${promo}` : ''}`}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  )
}

// ---------------------------------------------------------------- colour swatches

export function ColorSwatches({ value, onChange }: { value: TierColor; onChange: (c: TierColor) => void }) {
  return (
    <div className="settings-swatches" role="radiogroup" aria-label="สีปุ่ม">
      {(Object.keys(TIER_COLORS) as TierColor[]).map((k) => {
        const c = TIER_COLORS[k]
        const on = k === value
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c.label}
            title={c.label}
            className={cx('settings-swatch', on && 'active')}
            style={{ background: c.bg, color: c.fg }}
            onClick={() => onChange(k)}
          >
            {on && <Check size={22} strokeWidth={3} aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- people

export function Avatar({ name, role, size = 'md' }: { name: string; role: Role; size?: 'md' | 'lg' }) {
  return (
    <span className={cx('settings-avatar', role === 'owner' && 'is-owner', size === 'lg' && 'settings-avatar-lg')} aria-hidden="true">
      {initialOf(name)}
    </span>
  )
}

export function RoleBadge({ role }: { role: Role }) {
  return role === 'owner' ? <Badge tone="accent">เจ้าของ</Badge> : <Badge tone="info">คนขาย</Badge>
}

// ---------------------------------------------------------------- set a PIN (typed twice)

export interface PinSetterProps {
  /** Called with the confirmed PIN. */
  onDone: (pin: string) => void
  /** Warning shown after the first entry (e.g. same PIN as someone else). Return null when fine. */
  warn?: (pin: string) => string | null
  /** Offer 4 or 6 digits (default: 4 only). */
  allowSix?: boolean
  initialLength?: 4 | 6
}

export function PinSetter({ onDone, warn, allowSix = false, initialLength = 4 }: PinSetterProps) {
  const [length, setLength] = useState<4 | 6>(initialLength)
  const [first, setFirst] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState(0)

  const note = first ? warn?.(first) ?? (isWeakPin(first) ? 'PIN นี้เดาง่าย ถ้าเปลี่ยนได้จะปลอดภัยกว่า' : null) : null

  return (
    <div className="settings-pinsetter">
      {allowSix && first === null && (
        <Segmented
          aria-label="จำนวนหลักของ PIN"
          options={[
            { value: 4, label: '4 หลัก' },
            { value: 6, label: '6 หลัก' },
          ]}
          value={length}
          onChange={(v) => {
            setLength(v)
            setError(null)
          }}
        />
      )}
      <PinPad
        key={`${length}-${first === null ? 'a' : 'b'}`}
        length={length}
        title={first === null ? `ตั้ง PIN ${length} หลัก` : 'ใส่ PIN เดิมอีกครั้ง'}
        error={error}
        errorKey={errorKey}
        onComplete={(pin) => {
          if (first === null) {
            setFirst(pin)
            setError(null)
            return
          }
          if (pin !== first) {
            setFirst(null)
            setError('PIN ไม่ตรงกัน ตั้งใหม่อีกครั้ง')
            setErrorKey((k) => k + 1)
            return
          }
          onDone(pin)
        }}
      />
      {note && <p className="settings-note tone-warning">{note}</p>}
      {first !== null && (
        <button type="button" className="btn btn-ghost" onClick={() => setFirst(null)}>
          เริ่มตั้งใหม่
        </button>
      )}
    </div>
  )
}

export function Loading() {
  return <div className="page-loading">กำลังโหลด…</div>
}
