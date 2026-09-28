import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { CalendarDays } from 'lucide-react'
import type { DayKey } from '../types'
import { diffDays, presetRange, PRESET_LABEL, todayKey, type DayRange, type RangePreset } from '../lib/dates'
import { thaiDate } from '../lib/format'
import { cx } from './cx'
import { moneyToText, normalizeMoneyText, parseMoney, withCommas } from './logic'

// ---------- Field ----------

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  /** Red message under the control; also marks the control aria-invalid. */
  error?: ReactNode
  children: ReactNode
  /** Only needed when the child is not a single input/select/textarea/MoneyInput. */
  htmlFor?: string
  required?: boolean
  className?: string
}

type AnyProps = Record<string, unknown>

/** Label + control + hint/error. A single native control or MoneyInput child gets linked automatically. */
export function Field({ label, hint, error, children, htmlFor, required = false, className }: FieldProps) {
  const autoId = useId()
  const hintId = `${autoId}-hint`
  const errorId = `${autoId}-error`
  const hasHint = hint !== undefined && hint !== null && hint !== false && hint !== ''
  const hasError = error !== undefined && error !== null && error !== false && error !== ''

  let control: ReactNode = children
  let controlId: string | undefined = htmlFor
  const only = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<AnyProps>) : null
  const linkable =
    only !== null &&
    (typeof only.type === 'string' ? ['input', 'select', 'textarea'].includes(only.type) : only.type === MoneyInput)
  if (only && linkable) {
    const p = only.props
    controlId = (typeof p.id === 'string' ? p.id : undefined) ?? htmlFor ?? `${autoId}-control`
    const describedBy =
      [typeof p['aria-describedby'] === 'string' ? p['aria-describedby'] : null, hasHint ? hintId : null, hasError ? errorId : null]
        .filter(Boolean)
        .join(' ') || undefined
    control = cloneElement(only, {
      id: controlId,
      'aria-describedby': describedBy,
      'aria-invalid': hasError ? true : p['aria-invalid'],
    })
  }

  const labelContent = (
    <>
      {label}
      {required && (
        <span className="field-req" aria-hidden="true">
          *
        </span>
      )}
    </>
  )

  return (
    <div className={cx('field', hasError && 'field-invalid', className)}>
      {controlId ? (
        <label className="field-label" htmlFor={controlId}>
          {labelContent}
        </label>
      ) : (
        <span className="field-label">{labelContent}</span>
      )}
      {control}
      {hasHint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
      {hasError && (
        <span id={errorId} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

// ---------- MoneyInput ----------

export interface MoneyInputProps
  extends Omit<ComponentPropsWithRef<'input'>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'size' | 'prefix'> {
  value: number | null
  onChange: (n: number | null) => void
  /** Allow satang (up to 2 decimals). Default false = whole baht. */
  allowDecimal?: boolean
  /** lg (default) = 60px tall, 28px digits. md = 48px. */
  size?: 'md' | 'lg'
  /** Text on the left inside the box. Default '฿'; false hides it. */
  prefix?: ReactNode | false
  /** Max digits before the decimal point (default 9). */
  maxDigits?: number
}

/** Amount input: numeric keyboard, selects all on focus, shows 1,250 when not editing. */
export function MoneyInput({
  value,
  onChange,
  allowDecimal = false,
  size = 'lg',
  prefix = '฿',
  maxDigits = 9,
  placeholder = '0',
  className,
  onFocus,
  onBlur,
  ...rest
}: MoneyInputProps) {
  const [text, setText] = useState(() => moneyToText(value))
  const [focused, setFocused] = useState(false)
  const [prevValue, setPrevValue] = useState(value)

  // The parent changed the value (e.g. reset after save): show it unless it matches what is typed.
  if (value !== prevValue) {
    setPrevValue(value)
    if (parseMoney(text) !== value) setText(moneyToText(value))
  }

  return (
    <div className={cx('money-input', `money-input-${size}`, className)}>
      {prefix !== false && (
        <span className="money-input-prefix" aria-hidden="true">
          {prefix}
        </span>
      )}
      <input
        autoComplete="off"
        enterKeyHint="done"
        {...rest}
        type="text"
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        className={cx('input money-input-field', prefix === false && 'no-prefix')}
        placeholder={placeholder}
        value={focused ? text : withCommas(text)}
        onChange={(e) => {
          const next = normalizeMoneyText(e.target.value, allowDecimal, maxDigits)
          if (next === null) return
          setText(next)
          const n = parseMoney(next)
          setPrevValue(n)
          onChange(n)
        }}
        onFocus={(e) => {
          setFocused(true)
          const el = e.currentTarget
          // After React swaps in the raw text, select it so typing replaces the amount.
          requestAnimationFrame(() => {
            if (document.activeElement === el) el.select()
          })
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          if (text.endsWith('.')) setText(text.slice(0, -1))
          onBlur?.(e)
        }}
      />
    </div>
  )
}

// ---------- Segmented ----------

export interface SegmentedOption<T extends string | number> {
  value: T
  label: ReactNode
  disabled?: boolean
}

export interface SegmentedProps<T extends string | number> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Always full width (default: full width on phones, compact on wider screens). */
  block?: boolean
  className?: string
  'aria-label'?: string
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  block = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  const activeIndex = options.findIndex((o) => o.value === value)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
    if (enabled.length === 0) return
    e.preventDefault()
    const pos = Math.max(0, enabled.indexOf(activeIndex))
    const nextPos =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? enabled.length - 1
          : (pos + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length
    const idx = enabled[nextPos]
    onChange(options[idx].value)
    const btn = e.currentTarget.querySelectorAll<HTMLButtonElement>('.seg-item')[idx]
    btn?.focus()
  }

  return (
    <div className={cx('seg', block && 'seg-block', className)} role="radiogroup" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const active = i === activeIndex
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (activeIndex === -1 && i === 0) ? 0 : -1}
            className={cx('seg-item', active && 'active')}
            disabled={o.disabled}
            onClick={() => {
              if (!active) onChange(o.value)
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------- Toggle ----------

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
  className?: string
}

/** Full-width row with a switch on the right (role=switch). */
export function Toggle({ checked, onChange, label, hint, disabled = false, className }: ToggleProps) {
  const id = useId()
  const hasHint = hint !== undefined && hint !== null && hint !== ''
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={hasHint ? `${id}-hint` : undefined}
      className={cx('toggle', className)}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-text">
        <span id={`${id}-label`} className="toggle-label">
          {label}
        </span>
        {hasHint && (
          <span id={`${id}-hint`} className="toggle-hint">
            {hint}
          </span>
        )}
      </span>
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
    </button>
  )
}

// ---------- DateRangePicker ----------

const DEFAULT_PRESETS: RangePreset[] = ['today', 'yesterday', '7d', '30d', 'thisMonth', 'lastMonth']

export interface DateRangePickerProps {
  value: DayRange
  onChange: (r: DayRange) => void
  /** Which preset chips to show (default: all). */
  presets?: RangePreset[]
  className?: string
}

function rangeText(r: DayRange): string {
  if (r.from === r.to) return thaiDate(r.from)
  const days = diffDays(r.from, r.to) + 1
  return `${thaiDate(r.from)} – ${thaiDate(r.to)} · ${days} วัน`
}

export function DateRangePicker({ value, onChange, presets = DEFAULT_PRESETS, className }: DateRangePickerProps) {
  const today = todayKey()
  const matched = presets.find((p) => {
    const r = presetRange(p, today)
    return r.from === value.from && r.to === value.to
  })
  const [customOpen, setCustomOpen] = useState(matched === undefined)
  const showCustom = customOpen || matched === undefined

  const setFrom = (from: DayKey) => {
    if (!from) return
    onChange({ from, to: from > value.to ? from : value.to })
  }
  const setTo = (to: DayKey) => {
    if (!to) return
    onChange({ from: to < value.from ? to : value.from, to })
  }

  return (
    <div className={cx('drp', className)}>
      <div className="drp-chips" role="group" aria-label="ช่วงวันที่">
        {presets.map((p) => {
          const active = !showCustom && matched === p
          return (
            <button
              key={p}
              type="button"
              className={cx('chip', active && 'active')}
              aria-pressed={active}
              onClick={() => {
                setCustomOpen(false)
                onChange(presetRange(p, today))
              }}
            >
              {PRESET_LABEL[p]}
            </button>
          )
        })}
        <button
          type="button"
          className={cx('chip', showCustom && 'active')}
          aria-pressed={showCustom}
          aria-expanded={showCustom}
          onClick={() => setCustomOpen(true)}
        >
          <CalendarDays size={18} aria-hidden="true" />
          เลือกเอง
        </button>
      </div>
      {showCustom && (
        <div className="drp-custom">
          <label className="drp-date">
            <span>ตั้งแต่</span>
            <input
              type="date"
              className="input"
              value={value.from}
              max={value.to < today ? value.to : today}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="drp-date">
            <span>ถึง</span>
            <input
              type="date"
              className="input"
              value={value.to}
              min={value.from}
              max={value.to > today ? value.to : today}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      )}
      <p className="drp-summary">
        <CalendarDays size={16} aria-hidden="true" />
        <span>{rangeText(value)}</span>
      </p>
    </div>
  )
}
