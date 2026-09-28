import { Link } from 'react-router-dom'
import { BarChart3, Boxes, ChevronRight, ClipboardList, History, PackagePlus, Receipt, Settings, Wallet } from 'lucide-react'
import { useSession } from '../../session'

interface Item {
  to: string
  label: string
  hint: string
  icon: React.ReactNode
  owner?: boolean
}

const ITEMS: Item[] = [
  { to: '/shift', label: 'เปิดร้าน / ปิดยอด', hint: 'เงินทอน เงินเข้า-ออก นับเงินตอนเย็น', icon: <Wallet /> },
  { to: '/shift/history', label: 'ประวัติการปิดยอด', hint: 'ย้อนดูยอดและเงินขาด-เกินแต่ละวัน', icon: <History /> },
  { to: '/stock', label: 'สต็อก', hint: 'ของคงเหลือตามปุ่มราคา', icon: <Boxes /> },
  { to: '/stock/receive', label: 'รับของเข้า', hint: 'จดของที่ซื้อมา จำนวนและทุน', icon: <PackagePlus />, owner: true },
  { to: '/stock/count', label: 'นับสต็อก', hint: 'นับของจริงแล้วปรับยอด', icon: <ClipboardList /> },
  { to: '/expenses', label: 'ค่าใช้จ่าย', hint: 'ค่าแผง ค่าไฟ ค่าจ้าง ถุง', icon: <Receipt />, owner: true },
  { to: '/reports', label: 'รายงาน', hint: 'ยอดขาย กำไร ขายดี ขายช้า', icon: <BarChart3 />, owner: true },
  { to: '/settings', label: 'ตั้งค่า', hint: 'ร้าน แผง ปุ่มราคา คนขาย ซิงก์ สำรองข้อมูล', icon: <Settings />, owner: true },
]

export default function MorePage() {
  const { isOwner, staff } = useSession()
  const items = ITEMS.filter((i) => !i.owner || isOwner)
  return (
    <div className="page">
      <h1 className="page-title">เมนู</h1>
      <div className="list">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="list-row list-link">
            <span className="list-icon">{i.icon}</span>
            <span className="list-main">
              <span className="list-title">{i.label}</span>
              <span className="list-sub">{i.hint}</span>
            </span>
            <ChevronRight size={20} className="muted" />
          </Link>
        ))}
      </div>
      {!isOwner && (
        <p className="muted" style={{ marginTop: 16 }}>
          เข้าสู่ระบบเป็น {staff?.name} · เมนูของเจ้าของร้านต้องใช้ PIN ของเจ้าของ
        </p>
      )}
    </div>
  )
}
