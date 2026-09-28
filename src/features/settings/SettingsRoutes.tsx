// Owner settings, mounted at /settings/* (App wraps it in <OwnerOnly>).
import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, Cloud, Database, Smartphone, Store, Tags, Users, Wallet } from 'lucide-react'
import { alive, db } from '../../db'
import { useDevice } from '../../device'
import { useBooths, useCurrentBooth, useShop, useStaffList } from '../../hooks'
import { useSyncStatus } from '../../sync'
import { dateTime } from '../../lib/format'
import { PageHeader } from '../../ui'
import ShopSettings from './ShopSettings'
import BoothSettings from './BoothSettings'
import TierSettings from './TierSettings'
import StaffSettings from './StaffSettings'
import DeviceSettings from './DeviceSettings'
import SyncSettings from './SyncSettings'
import DataSettings from './DataSettings'
import { LAST_BACKUP_KEY, readLocal } from './storage'
import './settings.css'

export default function SettingsRoutes() {
  return (
    <Routes>
      <Route index element={<SettingsHome />} />
      <Route path="shop" element={<ShopSettings />} />
      <Route path="booths" element={<BoothSettings />} />
      <Route path="tiers" element={<TierSettings />} />
      <Route path="staff" element={<StaffSettings />} />
      <Route path="device" element={<DeviceSettings />} />
      <Route path="sync" element={<SyncSettings />} />
      <Route path="data" element={<DataSettings />} />
      <Route path="*" element={<Navigate to="/settings" replace />} />
    </Routes>
  )
}

const SYNC_LABEL = {
  off: 'ยังไม่ได้ตั้งค่า ใช้เครื่องเดียว',
  idle: 'เปิดอยู่',
  syncing: 'กำลังซิงก์',
  ok: 'ซิงก์แล้ว',
  error: 'ซิงก์ไม่สำเร็จ',
  offline: 'ออฟไลน์',
} as const

function SettingsHome() {
  const shop = useShop()
  const booths = useBooths(true)
  const staff = useStaffList(true)
  const booth = useCurrentBooth()
  const { autoLockMin } = useDevice()
  const sync = useSyncStatus()
  const tierCount = useLiveQuery(async () => alive(await db.tiers.toArray()).filter((t) => t.active === 1).length, [])
  const lastBackup = Number(readLocal(LAST_BACKUP_KEY)) || null

  const activeBooths = booths?.filter((b) => b.active === 1).length
  const activeStaff = staff?.filter((s) => s.active === 1).length
  const n = (v: number | undefined, unit: string) => (v === undefined ? '…' : `${v} ${unit}`)

  const items: { to: string; label: string; sub: string; icon: ReactNode }[] = [
    {
      to: 'shop',
      label: 'ร้าน',
      sub: shop ? `${shop.name} · ${shop.promptPayId ? 'มีพร้อมเพย์' : 'ยังไม่ใส่พร้อมเพย์'}` : 'ชื่อร้าน พร้อมเพย์ วิธีรับเงิน',
      icon: <Wallet size={22} />,
    },
    { to: 'booths', label: 'แผง', sub: `${n(activeBooths, 'แผง')} · เงินทอนตั้งต้น`, icon: <Store size={22} /> },
    { to: 'tiers', label: 'ปุ่มราคา', sub: `${n(tierCount, 'ปุ่ม')} · ราคา โปร สี สต็อก`, icon: <Tags size={22} /> },
    { to: 'staff', label: 'คนขาย', sub: `${n(activeStaff, 'คน')} · PIN และสิทธิ์`, icon: <Users size={22} /> },
    {
      to: 'device',
      label: 'เครื่องนี้',
      sub: `${booth ? booth.name : 'ยังไม่เลือกแผง'} · ${autoLockMin ? `ล็อกเมื่อไม่ใช้ ${autoLockMin} นาที` : 'ไม่ล็อกอัตโนมัติ'}`,
      icon: <Smartphone size={22} />,
    },
    {
      to: 'sync',
      label: 'ซิงก์และ LINE',
      sub: SYNC_LABEL[sync.state] + (sync.state !== 'off' && sync.pending > 0 ? ` · รอส่ง ${sync.pending}` : ''),
      icon: <Cloud size={22} />,
    },
    {
      to: 'data',
      label: 'ข้อมูล',
      sub: lastBackup ? `สำรองล่าสุด ${dateTime(lastBackup)}` : 'สำรอง กู้คืน ไฟล์ Excel ข้อมูลทดลอง',
      icon: <Database size={22} />,
    },
  ]

  return (
    <div className="page settings-page settings-home">
      <PageHeader title="ตั้งค่า" back="/more" />
      <nav className="list" aria-label="หมวดตั้งค่า">
        {items.map((i) => (
          <Link key={i.to} to={`/settings/${i.to}`} className="list-row list-link">
            <span className="list-icon">{i.icon}</span>
            <span className="list-main">
              <span className="list-title">{i.label}</span>
              <span className="list-sub">{i.sub}</span>
            </span>
            <ChevronRight size={20} className="muted" aria-hidden="true" />
          </Link>
        ))}
      </nav>
    </div>
  )
}
