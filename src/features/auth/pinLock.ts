// Wrong-PIN cooldown for this device, shared by the login screen and the owner-PIN prompt that
// approves voiding a bill (both are ways to guess the owner PIN). Kept in localStorage.
import { afterWrongPin, lockRemainingSec, type LoginLock } from '../settings/logic'
import { readLocal, writeLocal } from '../settings/storage'

const PIN_LOCK_KEY = 'pratunam.loginLock.v1'

export function readPinLock(): LoginLock {
  try {
    const v = JSON.parse(readLocal(PIN_LOCK_KEY) ?? 'null') as Partial<LoginLock> | null
    if (v && typeof v.fails === 'number' && typeof v.until === 'number') return { fails: v.fails, until: v.until }
  } catch {
    /* ignore */
  }
  return { fails: 0, until: 0 }
}

export function writePinLock(l: LoginLock): void {
  writeLocal(PIN_LOCK_KEY, l.fails === 0 && l.until === 0 ? null : JSON.stringify(l))
}

/** Record one wrong PIN now; returns the new lock state. */
export function registerWrongPin(now: number = Date.now()): LoginLock {
  const next = afterWrongPin(readPinLock(), now)
  writePinLock(next)
  return next
}

export function clearPinLock(): void {
  writePinLock({ fails: 0, until: 0 })
}

/** Seconds left in the cooldown (0 = PINs may be tried). */
export function pinLockSeconds(now: number = Date.now()): number {
  return lockRemainingSec(readPinLock(), now)
}
