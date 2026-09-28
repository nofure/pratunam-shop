import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useDevice } from '../../device'
import { useBooths } from '../../hooks'
import { useSession } from '../../session'
import type { ID } from '../../types'
import { PageHeader, cx } from '../../ui'
import { Loading, OwnerGate, StockErrorBoundary } from './common'
import { StockBoothContext, type StockBoothValue } from './data'
import OnHandPage from './OnHandPage'
import ReceivePage from './ReceivePage'
import CountPage from './CountPage'
import AdjustPage from './AdjustPage'
import SuppliersPage from './SuppliersPage'
import LotsPage from './LotsPage'
import './stock.css'

const TABS: { to: string; label: string; owner: boolean; end?: boolean }[] = [
  { to: '/stock', label: 'คงเหลือ', owner: false, end: true },
  { to: '/stock/receive', label: 'รับของเข้า', owner: true },
  { to: '/stock/count', label: 'นับสต็อก', owner: false },
  { to: '/stock/adjust', label: 'ปรับสต็อก', owner: true },
  { to: '/stock/suppliers', label: 'ร้านที่ซื้อ', owner: true },
  { to: '/stock/lots', label: 'ประวัติรับเข้า', owner: true },
]

const PICK_KEY = 'pratunam.stock.booth'

function readPicked(): ID | null {
  try {
    return sessionStorage.getItem(PICK_KEY)
  } catch {
    return null
  }
}

/** Which booth the stock pages show. Owner: any active booth (default this device's). Staff: this device's booth only. */
function StockBoothProvider({ children }: { children: ReactNode }) {
  const { isOwner } = useSession()
  const device = useDevice()
  const allBooths = useBooths(true)
  const [picked, setPicked] = useState<ID | null>(readPicked)

  const setBoothId = useCallback((id: ID) => {
    setPicked(id)
    try {
      sessionStorage.setItem(PICK_KEY, id)
    } catch {
      /* private mode — keep in memory */
    }
  }, [])

  const value = useMemo<StockBoothValue | null>(() => {
    if (!allBooths) return null
    const booths = allBooths.filter((b) => b.active === 1)
    const isActive = (id: ID | null): id is ID => id != null && booths.some((b) => b.id === id)
    let boothId: ID | null
    if (isOwner) boothId = isActive(picked) ? picked : isActive(device.boothId) ? device.boothId : (booths[0]?.id ?? null)
    else boothId = device.boothId && allBooths.some((b) => b.id === device.boothId) ? device.boothId : null
    return { boothId, setBoothId, booths, allBooths, canPick: isOwner }
  }, [allBooths, isOwner, picked, device.boothId, setBoothId])

  if (!value) return <Loading />
  return <StockBoothContext.Provider value={value}>{children}</StockBoothContext.Provider>
}

export default function StockRoutes() {
  const { isOwner } = useSession()
  const { pathname } = useLocation()
  const tabs = TABS.filter((t) => !t.owner || isOwner)
  const navRef = useRef<HTMLElement>(null)

  // Keep the current tab visible in the scrolling chip row on phones.
  useEffect(() => {
    const nav = navRef.current
    const active = nav?.querySelector<HTMLElement>('.chip.active')
    if (!nav || !active) return
    const left = active.offsetLeft - nav.offsetLeft
    if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth)
      nav.scrollTo({ left: Math.max(0, left - 16) })
  }, [pathname])

  return (
    <StockBoothProvider>
      <div className="page stock-page">
        <PageHeader title="สต็อก" back="/more" />
        <nav ref={navRef} className="stock-tabs" aria-label="เมนูสต็อก">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cx('chip', isActive && 'active')}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <StockErrorBoundary key={pathname}>
          <Routes>
            <Route index element={<OnHandPage />} />
            <Route
              path="receive"
              element={
                <OwnerGate>
                  <ReceivePage />
                </OwnerGate>
              }
            />
            <Route path="count" element={<CountPage />} />
            <Route
              path="adjust"
              element={
                <OwnerGate>
                  <AdjustPage />
                </OwnerGate>
              }
            />
            <Route
              path="suppliers"
              element={
                <OwnerGate>
                  <SuppliersPage />
                </OwnerGate>
              }
            />
            <Route
              path="lots"
              element={
                <OwnerGate>
                  <LotsPage />
                </OwnerGate>
              }
            />
            <Route path="*" element={<Navigate to="/stock" replace />} />
          </Routes>
        </StockErrorBoundary>
      </div>
    </StockBoothProvider>
  )
}
