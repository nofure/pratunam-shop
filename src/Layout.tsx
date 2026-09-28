import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { BarChart3, CloudOff, Cloud, Lock, Menu, ReceiptText, ShoppingBag, Store, Wallet, RefreshCw, AlertTriangle } from 'lucide-react'
import { useSession } from './session'
import { useCurrentBooth } from './hooks'
import { useSyncStatus, syncNow } from './sync'
import BoothPicker from './BoothPicker'
import AppErrorBoundary from './AppErrorBoundary'

function SyncBadge() {
  const s = useSyncStatus()
  if (s.state === 'off') return null
  const icon =
    s.state === 'syncing' ? (
      <RefreshCw size={16} className="spin" />
    ) : s.state === 'offline' ? (
      <CloudOff size={16} />
    ) : s.state === 'error' ? (
      <AlertTriangle size={16} />
    ) : (
      <Cloud size={16} />
    )
  const label =
    s.state === 'offline'
      ? 'ออฟไลน์'
      : s.state === 'error'
        ? 'ซิงก์ไม่สำเร็จ'
        : s.state === 'syncing'
          ? 'กำลังซิงก์'
          : s.pending > 0
            ? `รอส่ง ${s.pending}`
            : 'ซิงก์แล้ว'
  return (
    <button className={`sync-badge sync-${s.state}`} onClick={() => void syncNow()} title={s.error ?? 'กดเพื่อซิงก์ตอนนี้'}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

export default function Layout() {
  const { staff, isOwner, logout } = useSession()
  const booth = useCurrentBooth()
  const [picking, setPicking] = useState(false)
  const { pathname } = useLocation()
  // Selling pages need a booth; settings/reports/menu and the close history stay reachable without one.
  const needsBooth = /^\/(pos|bills|shift)(\/|$)/.test(pathname) && !pathname.startsWith('/shift/history')

  // Top-level section ('pos', 'stock', …): moving to another one also clears a crashed page.
  const section = pathname.split('/')[1] ?? ''

  // A new page starts at the top (the previous page's scroll position would hide its header).
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  const nav = [
    { to: '/pos', label: 'ขาย', icon: <ShoppingBag size={22} /> },
    { to: '/bills', label: 'บิล', icon: <ReceiptText size={22} /> },
    { to: '/shift', label: 'ปิดยอด', icon: <Wallet size={22} /> },
    ...(isOwner ? [{ to: '/reports', label: 'รายงาน', icon: <BarChart3 size={22} /> }] : []),
    { to: '/more', label: 'เมนู', icon: <Menu size={22} /> },
  ]

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="topbar-booth"
          onClick={() => setPicking(true)}
          disabled={!isOwner && !!booth}
          title={isOwner ? 'เปลี่ยนแผงของเครื่องนี้' : undefined}
        >
          <Store size={18} />
          <span>{booth ? booth.name : 'ยังไม่ได้เลือกแผง'}</span>
        </button>
        <div className="topbar-right">
          <SyncBadge />
          <span className="topbar-user">{staff?.name}</span>
          <button className="icon-btn" onClick={logout} aria-label="ล็อกหน้าจอ / เปลี่ยนคนขาย" title="ล็อกหน้าจอ / เปลี่ยนคนขาย">
            <Lock size={20} />
          </button>
        </div>
      </header>
      <nav className="nav">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
            {n.icon}
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="main">
        {picking || (booth === null && needsBooth) ? (
          <BoothPicker onDone={() => setPicking(false)} />
        ) : (
          <AppErrorBoundary key={section}>
            <Outlet />
          </AppErrorBoundary>
        )}
      </main>
    </div>
  )
}
