import { Store } from 'lucide-react'
import { setDevice, useDevice } from './device'
import { useBooths } from './hooks'

/** Choose which booth this device sells for. Shown until a booth is chosen. */
export default function BoothPicker({ onDone }: { onDone?: () => void }) {
  const booths = useBooths()
  const { boothId } = useDevice()
  if (!booths) return <div className="page-loading">กำลังโหลด…</div>
  return (
    <div className="page">
      <h1 className="page-title">เครื่องนี้ใช้ขายที่แผงไหน</h1>
      <p className="muted">เลือกครั้งเดียว เครื่องจะจำไว้ เปลี่ยนภายหลังได้ที่ชื่อแผงด้านบน (เฉพาะเจ้าของ)</p>
      {booths.length === 0 ? (
        <div className="empty">
          <p className="empty-title">ยังไม่มีแผง</p>
          <p className="muted">ให้เจ้าของเพิ่มแผงที่ เมนู → ตั้งค่า → แผง</p>
        </div>
      ) : (
        <div className="booth-grid">
          {booths.map((b) => (
            <button
              key={b.id}
              className={'booth-card' + (b.id === boothId ? ' selected' : '')}
              onClick={() => {
                setDevice({ boothId: b.id })
                onDone?.()
              }}
            >
              <Store size={28} />
              <span>{b.name}</span>
            </button>
          ))}
        </div>
      )}
      {onDone && boothId && (
        <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={onDone}>
          ยกเลิก
        </button>
      )}
    </div>
  )
}
