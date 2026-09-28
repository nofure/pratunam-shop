import type { ComponentPropsWithRef, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'
export type ButtonSize = 'md' | 'lg' | 'xl'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** Default 'secondary' (neutral). Use 'primary' for the main confirm / money action. */
  variant?: ButtonVariant
  /** md = 48px, lg = 56px, xl = 64px tall. */
  size?: ButtonSize
  /** Full width. */
  block?: boolean
  /** Icon shown before the label, e.g. <Plus size={20} />. */
  icon?: ReactNode
  /** Shows a spinner and disables the button (use while saving). */
  loading?: boolean
}

const SPINNER_SIZE: Record<ButtonSize, number> = { md: 20, lg: 22, xl: 24 }

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  icon,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const hasLabel = children !== undefined && children !== null && children !== false && children !== ''
  return (
    <button
      type={type}
      className={cx(
        'btn',
        `btn-${variant}`,
        size !== 'md' && `btn-${size}`,
        block && 'btn-block',
        loading && 'is-loading',
        !hasLabel && 'btn-icon-only',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="btn-icon" aria-hidden="true">
          <LoaderCircle size={SPINNER_SIZE[size]} className="spin" />
        </span>
      ) : icon ? (
        <span className="btn-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {hasLabel && <span className="btn-label">{children}</span>}
    </button>
  )
}

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** Required: read by screen readers and shown as a tooltip. */
  label: string
  icon: ReactNode
  variant?: 'ghost' | 'secondary' | 'primary' | 'danger' | 'accent'
  /** md = 48px, lg = 56px. */
  size?: 'md' | 'lg'
}

export function IconButton({ label, icon, variant = 'ghost', size = 'md', className, type = 'button', title, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cx('ibtn', `ibtn-${variant}`, size === 'lg' && 'ibtn-lg', className)}
      {...rest}
    >
      {icon}
    </button>
  )
}

/** Small inline loading spinner. */
export function Spinner({ size = 20, label = 'กำลังโหลด' }: { size?: number; label?: string }) {
  return (
    <span className="ui-spinner" role="status" aria-label={label}>
      <LoaderCircle size={size} className="spin" aria-hidden="true" />
    </span>
  )
}
