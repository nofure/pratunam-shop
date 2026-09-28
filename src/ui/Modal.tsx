import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconButton } from './Button'
import { cx } from './cx'
import { isTopLayer, lockScroll, pushLayer } from './layer'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  /** Action buttons pinned to the bottom (stays visible while the body scrolls). */
  footer?: ReactNode
  /** md = 520px, lg = 760px wide on tablets/desktop. Phones always get a full-width bottom sheet. */
  size?: 'md' | 'lg'
  children?: ReactNode
  /** Close when the dimmed area is tapped (default true). Set false for forms that must not be lost. */
  closeOnBackdrop?: boolean
  /** Element to focus on open. Default: the first focusable element (the close button). */
  initialFocus?: RefObject<HTMLElement | null>
  className?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Bottom sheet on phones (< 640px), centered dialog on wider screens. Rendered in a portal. */
export function Modal(props: ModalProps) {
  if (!props.open) return null
  return <ModalPanel {...props} />
}

function ModalPanel({
  onClose,
  title,
  footer,
  size = 'md',
  children,
  closeOnBackdrop = true,
  initialFocus,
  className,
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const downOnBackdrop = useRef(false)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Layer registration, scroll lock, initial focus, Esc + focus trap, focus restore.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const popLayer = pushLayer(panel, () => onCloseRef.current())
    const unlock = lockScroll()

    // Children with autoFocus (e.g. an amount input) already took focus — keep it.
    if (!panel.contains(document.activeElement)) {
      const target = initialFocus?.current ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel
      target.focus({ preventScroll: true })
    }

    const onKey = (e: KeyboardEvent) => {
      if (!isTopLayer(panel)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      )
      if (nodes.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      popLayer()
      unlock()
      if (prevFocus && prevFocus.isConnected) prevFocus.focus({ preventScroll: true })
    }
    // Runs once per open; initialFocus is only read on open.
  }, [])

  // Keep the sheet above the on-screen keyboard when the browser only shrinks the
  // visual viewport (Android Chrome default): fit the backdrop to the visible area.
  useEffect(() => {
    const vv = window.visualViewport
    const el = backdropRef.current
    if (!vv || !el) return
    const reset = () => {
      el.style.top = ''
      el.style.height = ''
      el.style.bottom = ''
    }
    const update = () => {
      const keyboard = window.innerHeight - vv.height
      if (Math.abs(vv.scale - 1) > 0.01 || keyboard < 80) {
        reset()
        return
      }
      el.style.top = `${vv.offsetTop}px`
      el.style.height = `${vv.height}px`
      el.style.bottom = 'auto'
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      reset()
    }
  }, [])

  const hasFooter = footer !== undefined && footer !== null && footer !== false

  return createPortal(
    <div
      ref={backdropRef}
      className="modal-backdrop"
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        // Portal events bubble through the React tree; don't let a click in the
        // modal trigger onClick handlers of the component that rendered it.
        e.stopPropagation()
        if (closeOnBackdrop && downOnBackdrop.current && e.target === e.currentTarget) onClose()
        downOnBackdrop.current = false
      }}
    >
      <div
        ref={panelRef}
        className={cx('modal', `modal-${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <div className="modal-head">
          {title ? (
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
          ) : (
            <span className="modal-title" />
          )}
          <IconButton label="ปิด" icon={<X size={24} />} onClick={onClose} className="modal-close" />
        </div>
        <div className="modal-body">{children}</div>
        {hasFooter && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
