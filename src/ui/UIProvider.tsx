import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { Button } from './Button'
import { Modal } from './Modal'

export type ToastTone = 'success' | 'error' | 'info'
export type ToastFn = (text: string, tone?: ToastTone) => void

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  /** Default 'ยืนยัน'. Prefer a verb that says what happens, e.g. 'ลบ', 'ยกเลิกบิล'. */
  confirmText?: string
  /** Default 'กลับ' (avoids 'ยกเลิก' next to e.g. 'ยกเลิกบิล'). */
  cancelText?: string
  /** Red confirm button; the safe (cancel) button gets initial focus. */
  danger?: boolean
}
export type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>

interface ToastItem {
  id: number
  text: string
  tone: ToastTone
}

interface PendingConfirm {
  id: number
  opts: ConfirmOptions
  resolve: (ok: boolean) => void
}

const ToastContext = createContext<ToastFn | null>(null)
const ConfirmContext = createContext<ConfirmFn | null>(null)

const TOAST_MS: Record<ToastTone, number> = { success: 2500, info: 2500, error: 3500 }
const MAX_TOASTS = 3

/** Wraps the app: hosts toasts and the promise-based confirm dialog. */
export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [queue, setQueue] = useState<PendingConfirm[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())
  const queueRef = useRef<PendingConfirm[]>([])

  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id))
    const h = timers.current.get(id)
    if (h !== undefined) {
      window.clearTimeout(h)
      timers.current.delete(id)
    }
  }, [])

  const toast = useCallback<ToastFn>(
    (text, tone = 'info') => {
      const id = nextId.current++
      setToasts((ts) => [...ts, { id, text, tone }].slice(-MAX_TOASTS))
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), TOAST_MS[tone]),
      )
    },
    [dismiss],
  )

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        const id = nextId.current++
        setQueue((q) => [...q, { id, opts, resolve }])
      }),
    [],
  )

  const current = queue[0]
  const settle = useCallback((item: PendingConfirm, ok: boolean) => {
    item.resolve(ok)
    // Guard against double taps settling (and dropping) the next queued dialog.
    setQueue((q) => (q[0]?.id === item.id ? q.slice(1) : q))
  }, [])

  useEffect(() => {
    const t = timers.current
    return () => {
      t.forEach((h) => window.clearTimeout(h))
      t.clear()
      queueRef.current.forEach((p) => p.resolve(false))
    }
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        {current && <ConfirmDialog key={current.id} opts={current.opts} onSettle={(ok) => settle(current, ok)} />}
        {createPortal(
          <div className="toast-host" role="status" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className={`toast toast-${t.tone}`}>
                {t.tone === 'success' ? (
                  <CircleCheck size={20} aria-hidden="true" />
                ) : t.tone === 'error' ? (
                  <CircleAlert size={20} aria-hidden="true" />
                ) : (
                  <Info size={20} aria-hidden="true" />
                )}
                <span>{t.text}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  )
}

function ConfirmDialog({ opts, onSettle }: { opts: ConfirmOptions; onSettle: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)
  return (
    <Modal
      open
      onClose={() => onSettle(false)}
      title={opts.title}
      className="modal-confirm"
      initialFocus={opts.danger ? cancelRef : okRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" size="lg" onClick={() => onSettle(false)}>
            {opts.cancelText ?? 'กลับ'}
          </Button>
          <Button ref={okRef} variant={opts.danger ? 'danger' : 'primary'} size="lg" onClick={() => onSettle(true)}>
            {opts.confirmText ?? 'ยืนยัน'}
          </Button>
        </>
      }
    >
      {opts.message !== undefined && opts.message !== null && <div className="confirm-message">{opts.message}</div>}
    </Modal>
  )
}

/** `toast('บันทึกแล้ว', 'success')` — short message above the bottom nav, auto-hides. */
export function useToast(): ToastFn {
  const ctx = useContext(ToastContext)
  return ctx ?? fallbackToast
}

/** `if (await confirm({ title: 'ลบรายการนี้', danger: true, confirmText: 'ลบ' })) …` */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  return ctx ?? fallbackConfirm
}

// Only used if a component renders outside <UIProvider> (should not happen in the app).
const fallbackToast: ToastFn = (text) => {
  console.warn('[ui] toast outside <UIProvider>:', text)
}
const fallbackConfirm: ConfirmFn = async (o) => window.confirm(o.title)
