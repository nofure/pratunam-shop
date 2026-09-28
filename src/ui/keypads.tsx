import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Delete } from 'lucide-react'
import { cx } from './cx'
import { isEditableTarget, isInTopLayer, vibrate } from './layer'
import { applyPadKey, type PadKey } from './logic'

const LONG_PRESS_MS = 550

function keyFromEvent(e: KeyboardEvent, allowDecimal: boolean): PadKey | null {
  if (/^[0-9]$/.test(e.key)) return e.key as PadKey
  if (allowDecimal && (e.key === '.' || e.key === ',' || e.key === 'Decimal')) return '.'
  if (e.key === 'Backspace') return 'back'
  if (e.key === 'Delete') return 'clear'
  return null
}

/** Listen to a physical keyboard while mounted (ignores typing in text fields and keys behind a modal). */
function usePhysicalKeys(
  enabled: boolean,
  rootRef: RefObject<HTMLElement | null>,
  handler: (e: KeyboardEvent) => boolean,
) {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (isEditableTarget(e.target)) return
      if (!isInTopLayer(rootRef.current)) return
      if (handlerRef.current(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, rootRef])
}

/** Backspace key: tap = delete one, hold = clear all. */
function BackKey({ onBack, onClear, disabled }: { onBack: () => void; onClear: () => void; disabled?: boolean }) {
  const timer = useRef<number | undefined>(undefined)
  const held = useRef(false)
  const stop = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = undefined
  }
  useEffect(() => stop, [])
  return (
    <button
      type="button"
      className="numpad-key numpad-key-fn"
      aria-label="ลบ (กดค้างเพื่อล้าง)"
      title="ลบ · กดค้างเพื่อล้าง"
      disabled={disabled}
      onPointerDown={() => {
        held.current = false
        stop()
        timer.current = window.setTimeout(() => {
          held.current = true
          timer.current = undefined
          vibrate(20)
          onClear()
        }, LONG_PRESS_MS)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (held.current) {
          held.current = false
          return
        }
        onBack()
      }}
    >
      <Delete size={28} aria-hidden="true" />
    </button>
  )
}

// ---------- NumPad ----------

export interface NumPadProps {
  value: string
  onChange: (s: string) => void
  /** Shows '.' instead of '00'. */
  allowDecimal?: boolean
  /** Max characters of the value (default 9). */
  maxLength?: number
  /** Called on the Enter key of a physical keyboard. */
  onEnter?: () => void
  disabled?: boolean
  /** Listen to a physical keyboard while mounted (default true). */
  keyboard?: boolean
  className?: string
}

/** Big on-screen keypad (3×4). The caller shows the value; parse it with parseMoney(). */
export function NumPad({
  value,
  onChange,
  allowDecimal = false,
  maxLength = 9,
  onEnter,
  disabled = false,
  keyboard = true,
  className,
}: NumPadProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  // Latest value even if two keys arrive before the parent re-renders.
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  const press = (key: PadKey) => {
    if (disabled) return
    const next = applyPadKey(valueRef.current, key, allowDecimal, maxLength)
    if (next === valueRef.current) return
    valueRef.current = next
    onChange(next)
  }

  usePhysicalKeys(keyboard && !disabled, rootRef, (e) => {
    if (e.key === 'Enter') {
      if (!onEnter || e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return false
      onEnter()
      return true
    }
    const k = keyFromEvent(e, allowDecimal)
    if (!k) return false
    press(k)
    return true
  })

  const digit = (d: PadKey, label: ReactNode = d) => (
    <button key={d} type="button" className="numpad-key" disabled={disabled} onClick={() => press(d)}>
      {label}
    </button>
  )

  return (
    <div ref={rootRef} className={cx('numpad', className)} role="group" aria-label="แป้นตัวเลข">
      {(['1', '2', '3', '4', '5', '6', '7', '8', '9'] as PadKey[]).map((d) => digit(d))}
      {allowDecimal ? digit('.', '.') : digit('00')}
      {digit('0')}
      <BackKey disabled={disabled} onBack={() => press('back')} onClear={() => press('clear')} />
    </div>
  )
}

// ---------- PinPad ----------

export interface PinPadProps {
  /** Number of digits (4–6). Default 4. */
  length?: number
  /** Called when all digits are entered; the pad then clears itself. */
  onComplete: (pin: string) => void
  /** Optional: every change of the typed digits (e.g. to match PINs of different lengths). */
  onChange?: (pin: string) => void
  /** Red message + shake. Clear it (null / '') after a successful PIN. */
  error?: string | null
  /** Change this number to shake again with the same error text. Optional. */
  errorKey?: number | string
  /** Default 'ใส่รหัส PIN'. */
  title?: ReactNode
  disabled?: boolean
  /** Listen to a physical keyboard while mounted (default true). */
  keyboard?: boolean
  className?: string
}

export function PinPad({
  length = 4,
  onComplete,
  onChange,
  error,
  errorKey,
  title = 'ใส่รหัส PIN',
  disabled = false,
  keyboard = true,
  className,
}: PinPadProps) {
  const len = Math.min(8, Math.max(1, Math.round(length)))
  const rootRef = useRef<HTMLDivElement>(null)
  const [pin, setPin] = useState('')
  const pinRef = useRef('')
  const [shakeKey, setShakeKey] = useState(0)
  const lastShakeAt = useRef(0)
  const completedAt = useRef(0)
  const errorRef = useRef(error)
  const clearTimer = useRef<number | undefined>(undefined)
  const checkTimer = useRef<number | undefined>(undefined)
  const busy = useRef(false)
  const onCompleteRef = useRef(onComplete)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    errorRef.current = error
    onCompleteRef.current = onComplete
    onChangeRef.current = onChange
  })

  const shake = () => {
    lastShakeAt.current = Date.now()
    setShakeKey((k) => k + 1)
    vibrate(120)
  }

  // New error text (or errorKey bump) → shake and start over.
  useEffect(() => {
    if (!error) return
    shake()
    if (pinRef.current !== '') {
      pinRef.current = ''
      setPin('')
      onChangeRef.current?.('')
    }
  }, [error, errorKey])

  useEffect(
    () => () => {
      window.clearTimeout(clearTimer.current)
      window.clearTimeout(checkTimer.current)
    },
    [],
  )

  const setBoth = (v: string) => {
    if (v === pinRef.current) return
    pinRef.current = v
    setPin(v)
    onChangeRef.current?.(v)
  }

  const press = (key: PadKey) => {
    if (disabled || busy.current) return
    const cur = pinRef.current
    if (key === 'back') return setBoth(cur.slice(0, -1))
    if (key === 'clear') return setBoth('')
    if (!/^[0-9]$/.test(key) || cur.length >= len) return
    const next = cur + key
    setBoth(next)
    if (next.length < len) return
    // Show the last dot briefly, then clear for the next try.
    busy.current = true
    completedAt.current = Date.now()
    onCompleteRef.current(next)
    clearTimer.current = window.setTimeout(() => {
      busy.current = false
      setBoth('')
    }, 160)
    // Same error text again (wrong PIN twice) doesn't change the prop — shake anyway.
    window.clearTimeout(checkTimer.current)
    checkTimer.current = window.setTimeout(() => {
      if (errorRef.current && lastShakeAt.current < completedAt.current) shake()
    }, 350)
  }

  usePhysicalKeys(keyboard && !disabled, rootRef, (e) => {
    const k = keyFromEvent(e, false)
    if (!k) return false
    press(k)
    return true
  })

  const hasError = !!error
  return (
    <div ref={rootRef} className={cx('pinpad', className)}>
      {title !== null && title !== undefined && title !== '' && <div className="pinpad-title">{title}</div>}
      <div
        key={shakeKey}
        className={cx('pin-dots', hasError && 'pin-error', shakeKey > 0 && hasError && 'pin-shake')}
        role="img"
        aria-label={`ใส่แล้ว ${pin.length} จาก ${len} หลัก`}
      >
        {Array.from({ length: len }, (_, i) => (
          <span key={i} className={cx('pin-dot', i < pin.length && 'filled')} />
        ))}
      </div>
      <div className="pinpad-error" role="alert">
        {error || ''}
      </div>
      <div className="numpad pinpad-keys" role="group" aria-label="แป้นตัวเลข">
        {(['1', '2', '3', '4', '5', '6', '7', '8', '9'] as PadKey[]).map((d) => (
          <button key={d} type="button" className="numpad-key" disabled={disabled} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <span className="numpad-blank" aria-hidden="true" />
        <button type="button" className="numpad-key" disabled={disabled} onClick={() => press('0')}>
          0
        </button>
        <BackKey disabled={disabled} onBack={() => press('back')} onClear={() => press('clear')} />
      </div>
    </div>
  )
}
