// Tracks open modal panels (topmost last) so Esc, focus trapping and global
// keyboard listeners (NumPad / PinPad) only act on the layer the user sees.
// It also makes the phone's back button close the top modal instead of leaving the page
// (or closing the installed app): while any modal is open, one extra history entry with the
// same URL sits on top; pressing back pops it and we close the top modal.

const stack: HTMLElement[] = []
const closers = new Map<HTMLElement, () => void>()
let lockCount = 0
let savedOverflow = ''

// ---- back button ----

const GUARD_KEY = 'pratunamModal'
let listening = false
/** history.back() calls we made ourselves (to drop the guard entry) whose popstate is still coming. */
let ownBacks = 0

function currentState(): Record<string, unknown> | null {
  try {
    const st: unknown = window.history.state
    return st && typeof st === 'object' ? (st as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function onGuard(): boolean {
  return currentState()?.[GUARD_KEY] === 1
}

function pushGuard(): void {
  try {
    // Same URL, and the router's own state (index, key) copied so it sees no navigation.
    window.history.pushState({ ...(currentState() ?? {}), [GUARD_KEY]: 1 }, '')
  } catch {
    /* history not available — the back button simply keeps its normal behaviour */
  }
}

function armIfNeeded(): void {
  if (stack.length > 0 && !onGuard()) pushGuard()
}

function onPopState(): void {
  if (ownBacks > 0) {
    // The guard entry we removed after a modal closed; a modal opened meanwhile needs a new one.
    ownBacks--
    armIfNeeded()
    return
  }
  if (stack.length === 0 || onGuard()) return
  // Back pressed with a modal open: close the top one and stay on the page.
  const top = stack[stack.length - 1]
  try {
    closers.get(top)?.()
  } finally {
    // A modal underneath (or one that refused to close) keeps the back button armed.
    setTimeout(armIfNeeded, 0)
  }
}

function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  // A reload while a modal was open leaves the guard entry behind: make it a plain entry again.
  const st = currentState()
  if (st?.[GUARD_KEY] === 1) {
    try {
      const rest = { ...st }
      delete rest[GUARD_KEY]
      window.history.replaceState(rest, '')
    } catch {
      /* ignore */
    }
  }
  window.addEventListener('popstate', onPopState)
  // Dev server hot reload: don't leave the old module's listener behind.
  import.meta.hot?.dispose(() => window.removeEventListener('popstate', onPopState))
}

/**
 * Register an open modal panel. `onBack` is called when the phone's back button is pressed while
 * this panel is on top. Returns a function that unregisters it.
 */
export function pushLayer(el: HTMLElement, onBack?: () => void): () => void {
  listen()
  stack.push(el)
  if (onBack) closers.set(el, onBack)
  if (stack.length === 1 && typeof window !== 'undefined' && !onGuard()) pushGuard()
  return () => {
    const i = stack.lastIndexOf(el)
    if (i >= 0) stack.splice(i, 1)
    closers.delete(el)
    if (stack.length === 0 && typeof window !== 'undefined' && onGuard()) {
      // Closed by a button (not by back): drop the history entry added when it opened.
      ownBacks++
      try {
        window.history.back()
      } catch {
        ownBacks--
      }
    }
  }
}

export function isTopLayer(el: HTMLElement): boolean {
  return stack[stack.length - 1] === el
}

/** True when `el` is not covered by a modal: no modal is open, or `el` is inside the top one. */
export function isInTopLayer(el: Element | null): boolean {
  if (!el) return false
  const top = stack[stack.length - 1]
  return !top || top.contains(el)
}

/** Stop the page behind a modal from scrolling. Nested calls are counted. */
export function lockScroll(): () => void {
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount++
  let released = false
  return () => {
    if (released) return
    released = true
    lockCount--
    if (lockCount === 0) document.body.style.overflow = savedOverflow
  }
}

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/** True for elements where typed keys belong to the element (text fields, selects, contenteditable). */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t.isContentEditable) return true
  const tag = t.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((t as HTMLInputElement).type)
  return false
}

/** Short haptic tick on phones that support it; silently ignored elsewhere. */
export function vibrate(ms: number): void {
  try {
    if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
    // Chrome logs an error when vibrate() runs before the user has touched the page.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
    if (activation && !activation.hasBeenActive) return
    navigator.vibrate(ms)
  } catch {
    /* not allowed (no user gesture yet) — ignore */
  }
}
