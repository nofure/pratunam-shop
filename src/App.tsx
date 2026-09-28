import { useEffect, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { SessionProvider, useSession } from './session'
import { startAutoSync } from './sync'
import { UIProvider } from './ui'
import Layout from './Layout'
import AppErrorBoundary from './AppErrorBoundary'
import PosPage from './features/pos/PosPage'
import BillsPage from './features/pos/BillsPage'
import ShiftPage from './features/shift/ShiftPage'
import ShiftHistoryPage from './features/shift/ShiftHistoryPage'
import StockRoutes from './features/stock/StockRoutes'
import ExpensesPage from './features/expenses/ExpensesPage'
import ReportsRoutes from './features/reports/ReportsRoutes'
import SettingsRoutes from './features/settings/SettingsRoutes'
import SetupPage from './features/settings/SetupPage'
import LoginPage from './features/auth/LoginPage'
import MorePage from './features/more/MorePage'

function Loading() {
  return <div className="page-loading">กำลังโหลด…</div>
}

/** Redirects to /setup until the shop is set up, then to /login until someone logs in. */
function RequireAuth({ children }: { children: ReactNode }) {
  const shop = useLiveQuery(async () => (await db.shop.get('shop')) ?? null, [])
  const { staff } = useSession()
  const loc = useLocation()
  if (shop === undefined || staff === undefined) return <Loading />
  if (!shop || shop.setupDone !== 1) return <Navigate to="/setup" replace />
  if (!staff) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return <>{children}</>
}

/** Owner-only pages. Staff see a short message instead (the owner can switch in and come back here). */
export function OwnerOnly({ children }: { children: ReactNode }) {
  const { isOwner, logout } = useSession()
  if (!isOwner)
    return (
      <div className="page">
        <div className="empty">
          <p className="empty-title">หน้านี้สำหรับเจ้าของร้าน</p>
          <p className="muted">เข้าสู่ระบบด้วย PIN ของเจ้าของเพื่อดูหน้านี้</p>
          <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={logout}>
            <span className="btn-label">เข้าสู่ระบบเป็นเจ้าของ</span>
          </button>
        </div>
      </div>
    )
  return <>{children}</>
}

export default function App() {
  useEffect(() => startAutoSync(), [])
  return (
    // Outermost guard: even the session (which reads the database) can't blank the app.
    <AppErrorBoundary>
    <SessionProvider>
      <UIProvider>
      <HashRouter>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/pos" replace />} />
            <Route path="pos" element={<PosPage />} />
            <Route path="bills" element={<BillsPage />} />
            <Route path="shift" element={<ShiftPage />} />
            <Route path="shift/history" element={<ShiftHistoryPage />} />
            <Route path="stock/*" element={<StockRoutes />} />
            <Route
              path="expenses"
              element={
                <OwnerOnly>
                  <ExpensesPage />
                </OwnerOnly>
              }
            />
            <Route
              path="reports/*"
              element={
                <OwnerOnly>
                  <ReportsRoutes />
                </OwnerOnly>
              }
            />
            <Route
              path="settings/*"
              element={
                <OwnerOnly>
                  <SettingsRoutes />
                </OwnerOnly>
              }
            />
            <Route path="more" element={<MorePage />} />
            <Route path="*" element={<Navigate to="/pos" replace />} />
          </Route>
        </Routes>
      </HashRouter>
      </UIProvider>
    </SessionProvider>
    </AppErrorBoundary>
  )
}
