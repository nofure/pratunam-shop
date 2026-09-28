import type { HTMLAttributes, ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, Inbox } from 'lucide-react'
import { baht, num, round2, signed as signedText } from '../lib/format'
import { cx } from './cx'

// ---------- Card ----------

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  /** Buttons / links shown on the right of the title. */
  actions?: ReactNode
  /** No inner padding (for lists and tables that run edge to edge). */
  flush?: boolean
}

export function Card({ title, actions, flush = false, className, children, ...rest }: CardProps) {
  const hasHead = (title !== undefined && title !== null) || (actions !== undefined && actions !== null)
  return (
    <section className={cx('card', flush && 'card-flush', className)} {...rest}>
      {hasHead && (
        <div className="card-head">
          {title !== undefined && title !== null ? <h2 className="card-title">{title}</h2> : <span />}
          {actions !== undefined && actions !== null && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

// ---------- PageHeader ----------

export interface PageHeaderProps {
  title: ReactNode
  /** `true` = go back in history (falls back to the parent path); a string = link to that path. */
  back?: string | true
  actions?: ReactNode
  /** Small line under the title (e.g. date, booth). */
  sub?: ReactNode
}

function parentPath(pathname: string): string {
  const p = pathname.replace(/\/+$/, '').replace(/\/[^/]*$/, '')
  return p || '/'
}

export function PageHeader({ title, back, actions, sub }: PageHeaderProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const goBack = () => {
    // React Router keeps the history index in history.state.idx; 0 means we'd leave the app.
    const idx = (window.history.state as { idx?: unknown } | null)?.idx
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate(parentPath(pathname), { replace: true })
  }

  return (
    <header className="page-header">
      {back === true ? (
        <button type="button" className="ibtn ibtn-ghost page-back" aria-label="กลับ" title="กลับ" onClick={goBack}>
          <ChevronLeft size={28} />
        </button>
      ) : typeof back === 'string' ? (
        <Link to={back} className="ibtn ibtn-ghost page-back" aria-label="กลับ" title="กลับ">
          <ChevronLeft size={28} />
        </Link>
      ) : null}
      <div className="page-header-main">
        <h1 className="page-header-title">{title}</h1>
        {sub !== undefined && sub !== null && <div className="page-header-sub">{sub}</div>}
      </div>
      {actions !== undefined && actions !== null && <div className="page-header-actions">{actions}</div>}
    </header>
  )
}

// ---------- EmptyState ----------

export interface EmptyStateProps {
  title: ReactNode
  hint?: ReactNode
  /** Usually a <Button> or <Link className="btn …">. */
  action?: ReactNode
  /** Defaults to an inbox icon. Pass `null` for no icon. */
  icon?: ReactNode
  /** Less vertical padding (inside cards). */
  compact?: boolean
  className?: string
}

export function EmptyState({ title, hint, action, icon, compact = false, className }: EmptyStateProps) {
  const shownIcon = icon === undefined ? <Inbox size={28} /> : icon
  return (
    <div className={cx('ui-empty', compact && 'compact', className)}>
      {shownIcon !== null && (
        <span className="ui-empty-icon" aria-hidden="true">
          {shownIcon}
        </span>
      )}
      <p className="ui-empty-title">{title}</p>
      {hint !== undefined && hint !== null && <p className="ui-empty-hint">{hint}</p>}
      {action !== undefined && action !== null && <div className="ui-empty-action">{action}</div>}
    </div>
  )
}

// ---------- Badge ----------

export type BadgeTone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'accent'

export interface BadgeProps {
  tone?: BadgeTone
  icon?: ReactNode
  children?: ReactNode
  className?: string
  title?: string
}

export function Badge({ tone = 'neutral', icon, children, className, title }: BadgeProps) {
  return (
    <span className={cx('badge', `badge-${tone}`, className)} title={title}>
      {icon}
      {children}
    </span>
  )
}

// ---------- Stat ----------

export type StatTone = 'default' | 'success' | 'danger' | 'warning'

export interface StatProps {
  label: ReactNode
  /** Numbers get thousands separators; pass <Money/> for baht. */
  value: ReactNode
  sub?: ReactNode
  tone?: StatTone
  /** Without the tile border/background (when already inside a Card). */
  plain?: boolean
  className?: string
}

export function Stat({ label, value, sub, tone = 'default', plain = false, className }: StatProps) {
  return (
    <div className={cx('stat', plain && 'stat-plain', tone !== 'default' && `stat-${tone}`, className)}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{typeof value === 'number' ? num(value, 2) : value}</span>
      {sub !== undefined && sub !== null && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

// ---------- Money ----------

export type MoneySize = 'sm' | 'md' | 'lg' | 'xl'

export interface MoneyProps {
  value: number
  /** sm = small text, md = inherits the surrounding size, lg = 24px, xl = big total. */
  size?: MoneySize
  /** Show + / − (for differences such as ขาด / เกิน). */
  signed?: boolean
  /** Text colour. */
  tone?: 'default' | 'success' | 'danger' | 'warning' | 'info' | 'price' | 'muted'
  /** Show the ฿ sign (default true). */
  symbol?: boolean
  className?: string
}

/** Formatted baht amount with tabular digits: ฿1,250 · −฿20 · +฿35 (signed). */
export function Money({ value, size = 'md', signed = false, tone = 'default', symbol = true, className }: MoneyProps) {
  let sign = ''
  let digits: string
  if (!Number.isFinite(value)) {
    digits = '–'
  } else if (signed) {
    const s = signedText(value)
    if (s.startsWith('+') || s.startsWith('−')) {
      sign = s[0]
      digits = s.slice(1)
    } else {
      digits = s
    }
  } else {
    const r = round2(value)
    if (r < 0) sign = '−'
    digits = baht(Math.abs(r))
  }
  return (
    <span className={cx('money', `money-${size}`, tone !== 'default' && `tone-${tone}`, className)}>
      {sign}
      {symbol && <span className="money-cur">฿</span>}
      {digits}
    </span>
  )
}
