// Who is selling? Tap your name, then type your PIN.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, Store } from 'lucide-react'
import { useCurrentBooth, useShop, useStaffList } from '../../hooks'
import { useSession } from '../../session'
import type { ID, Staff } from '../../types'
import { EmptyState, PinPad, cx } from '../../ui'
import { LOGIN_MAX_TRIES, afterWrongPin, lockRemainingSec, pinLengthOf, type LoginLock } from '../settings/logic'
import { Avatar, Loading, RoleBadge } from '../settings/parts'
import { requestPersistentStorage } from '../settings/storage'
import { readPinLock as readLock, writePinLock as writeLock } from './pinLock'
import './auth.css'

/** Where to go after login: the page that sent us here (never back to login/setup). */
function targetFrom(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from
  if (typeof from === 'string' && from.startsWith('/') && !/^\/(login|setup)\b/.test(from) && from !== '/') return from
  return '/pos'
}

/** A seller logging in after the owner locked the screen on an owner page goes to selling instead. */
function destinationFor(s: Staff, target: string): string {
  return s.role !== 'owner' && /^\/(settings|reports|expenses)\b/.test(target) ? '/pos' : target
}

export default function LoginPage() {
  const shop = useShop()
  const staffList = useStaffList()
  const booth = useCurrentBooth()
  const { staff: current, login } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const target = targetFrom(location.state)

  const [selectedId, setSelectedId] = useState<ID | null>(null)
  const [lock, setLock] = useState<LoginLock>(readLock)
  const lockRef = useRef(lock)
  const [error, setError] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  // Tick once a second while locked so the countdown updates.
  useEffect(() => {
    if (lock.until <= Date.now()) return
    const t = window.setInterval(() => {
      const n = Date.now()
      setNow(n)
      if (n >= lockRef.current.until) {
        window.clearInterval(t)
        setError(null)
      }
    }, 500)
    return () => window.clearInterval(t)
  }, [lock.until])

  // Sellers of this device's booth first, then owners, then everyone else (hooks sort owners first by name).
  const people = useMemo(() => {
    if (!staffList) return undefined
    const boothId = booth?.id ?? null
    const rank = (s: Staff) => (boothId && s.boothId === boothId && s.role === 'staff' ? 0 : s.role === 'owner' ? 1 : 2)
    return [...staffList].sort((a, b) => rank(a) - rank(b))
  }, [staffList, booth])

  if (shop === undefined || people === undefined || current === undefined) return <Loading />
  if (!shop || shop.deleted === 1 || shop.setupDone !== 1) return <Navigate to="/setup" replace />
  if (current) return <Navigate to={destinationFor(current, target)} replace />

  const selected = people.find((s) => s.id === selectedId) ?? (people.length === 1 ? people[0] : null)
  const remaining = lockRemainingSec(lock, now)
  const locked = remaining > 0

  const choose = (s: Staff) => {
    setSelectedId(s.id)
    if (!lockRemainingSec(lockRef.current, Date.now())) setError(null)
  }

  const submit = (pin: string) => {
    if (!selected) return
    const at = Date.now()
    if (lockRemainingSec(lockRef.current, at) > 0) return
    if (pin === selected.pin) {
      const clear = { fails: 0, until: 0 }
      lockRef.current = clear
      writeLock(clear)
      setLock(clear)
      setError(null)
      login(selected)
      // Ask once more that the browser never evicts the shop data (no prompt on Android Chrome).
      void requestPersistentStorage()
      navigate(destinationFor(selected, target), { replace: true })
      return
    }
    const next = afterWrongPin(lockRef.current, at)
    lockRef.current = next
    writeLock(next)
    setLock(next)
    setNow(at)
    if (next.until) setError(`ใส่ PIN ผิด ${LOGIN_MAX_TRIES} ครั้ง รอสักครู่แล้วลองใหม่`)
    else {
      const left = LOGIN_MAX_TRIES - next.fails
      setError(left <= 2 ? `PIN ไม่ถูกต้อง ลองได้อีก ${left} ครั้ง` : 'PIN ไม่ถูกต้อง ลองอีกครั้ง')
    }
    setErrorKey((k) => k + 1)
  }

  return (
    <div className="auth">
      <div className="auth-inner">
        <header className="auth-head">
          <span className="auth-logo" aria-hidden="true">
            ฿
          </span>
          <div className="auth-head-text">
            <h1 className="auth-shop">{shop.name}</h1>
            <p className="auth-booth">
              <Store size={16} aria-hidden="true" />
              {booth ? `เครื่องนี้: ${booth.name}` : 'เครื่องนี้ยังไม่ได้เลือกแผง'}
            </p>
          </div>
        </header>

        {people.length === 0 ? (
          <EmptyState title="ยังไม่มีคนขายที่ใช้งานอยู่" hint="ถ้าเพิ่งเชื่อมเครื่องนี้ รอให้ซิงก์ข้อมูลเสร็จสักครู่" />
        ) : (
          <div className={cx('auth-body', selected && 'has-selected')}>
            <section className="auth-people" aria-label="เลือกชื่อ">
              <h2 className="auth-title">ใครใช้เครื่องนี้</h2>
              <div className="auth-grid">
                {people.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={cx('auth-tile', selected?.id === s.id && 'active')}
                    aria-pressed={selected?.id === s.id}
                    onClick={() => choose(s)}
                  >
                    <Avatar name={s.name} role={s.role} size="lg" />
                    <span className="auth-tile-name">{s.name}</span>
                    <RoleBadge role={s.role} />
                  </button>
                ))}
              </div>
            </section>

            <section className="auth-pin" aria-label="ใส่ PIN">
              {selected ? (
                <>
                  <div className="auth-pin-who">
                    {people.length > 1 && (
                      <button type="button" className="ibtn ibtn-ghost auth-back" aria-label="เลือกชื่ออื่น" onClick={() => setSelectedId(null)}>
                        <ChevronLeft size={28} />
                      </button>
                    )}
                    <Avatar name={selected.name} role={selected.role} />
                    <span className="auth-pin-name">{selected.name}</span>
                  </div>
                  <PinPad
                    key={selected.id}
                    length={pinLengthOf(selected.pin)}
                    title={locked ? `ลองใหม่ได้ใน ${remaining} วินาที` : 'ใส่ PIN'}
                    error={error}
                    errorKey={errorKey}
                    disabled={locked}
                    onComplete={submit}
                  />
                  <p className="auth-hint">ลืม PIN ให้เจ้าของร้านตั้งใหม่ที่ ตั้งค่า → คนขาย</p>
                </>
              ) : (
                <p className="auth-pick">เลือกชื่อของคุณ</p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
