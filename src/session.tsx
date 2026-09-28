// Who is using this device right now (logged in with a PIN).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { getSessionStaffId, setSessionStaffId, useDevice } from './device'
import type { Staff } from './types'

interface SessionValue {
  /** undefined while loading, null when nobody is logged in */
  staff: Staff | null | undefined
  isOwner: boolean
  login: (staff: Staff) => void
  logout: () => void
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [staffId, setStaffId] = useState<string | null>(() => getSessionStaffId())
  const { autoLockMin } = useDevice()

  const staff = useLiveQuery(async () => {
    if (!staffId) return null
    const s = await db.staff.get(staffId)
    return s && s.deleted !== 1 && s.active === 1 ? s : null
  }, [staffId])

  const login = useCallback((s: Staff) => {
    setSessionStaffId(s.id)
    setStaffId(s.id)
  }, [])

  const logout = useCallback(() => {
    setSessionStaffId(null)
    setStaffId(null)
  }, [])

  // Auto-lock after idle minutes (device setting).
  useEffect(() => {
    if (!staffId || !autoLockMin) return
    let timer = window.setTimeout(logout, autoLockMin * 60_000)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(logout, autoLockMin * 60_000)
    }
    const events = ['pointerdown', 'keydown', 'scroll']
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
    }
  }, [staffId, autoLockMin, logout])

  const value = useMemo<SessionValue>(
    () => ({ staff, isOwner: staff?.role === 'owner', login, logout }),
    [staff, login, logout],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext)
  if (!v) throw new Error('useSession must be used inside <SessionProvider>')
  return v
}

/** Verify an owner PIN (for owner-only actions done on a staff session, e.g. voiding a bill). */
export async function findOwnerByPin(pin: string): Promise<Staff | null> {
  const owners = (await db.staff.toArray()).filter(
    (s) => s.deleted !== 1 && s.active === 1 && s.role === 'owner' && s.pin === pin,
  )
  return owners[0] ?? null
}
