// Settings of this phone / tablet only (not synced): booth, auto-lock, storage.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, HardDrive, Store } from 'lucide-react'
import { version as APP_VERSION } from '../../../package.json'
import { setDevice, useDevice } from '../../device'
import { useBooths, useOpenShift } from '../../hooks'
import { Badge, Button, Card, EmptyState, PageHeader, cx, useToast } from '../../ui'
import { Loading } from './parts'
import { formatBytes, requestPersistentStorage, storageInfo, type StorageInfo } from './storage'

const LOCK_OPTIONS = [0, 1, 3, 5, 10]

export default function DeviceSettings() {
  const device = useDevice()
  const booths = useBooths()
  const openShift = useOpenShift(device.boothId)
  const toast = useToast()
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    let alive = true
    void storageInfo().then((s) => alive && setStorage(s))
    return () => {
      alive = false
    }
  }, [])

  const askPersist = async () => {
    setAsking(true)
    const ok = await requestPersistentStorage()
    setStorage(await storageInfo())
    setAsking(false)
    toast(ok ? 'เครื่องจะเก็บข้อมูลไว้ถาวรแล้ว' : 'เบราว์เซอร์ยังไม่อนุญาต ลองติดตั้งแอปลงหน้าจอหลักก่อน แล้วกดอีกครั้ง', ok ? 'success' : 'info')
  }

  const lockValue = LOCK_OPTIONS.includes(device.autoLockMin) ? device.autoLockMin : 0

  return (
    <div className="page settings-page">
      <PageHeader title="เครื่องนี้" back="/settings" sub="ตั้งค่าเฉพาะเครื่องนี้ ไม่ซิงก์ไปเครื่องอื่น" />
      <div className="stack">
        <Card title="เครื่องนี้ขายที่แผง">
          {booths === undefined ? (
            <Loading />
          ) : booths.length === 0 ? (
            <EmptyState
              compact
              title="ยังไม่มีแผง"
              action={
                <Link to="/settings/booths" className="btn btn-primary">
                  เพิ่มแผง
                </Link>
              }
            />
          ) : (
            <div className="stack-sm">
              <div className="settings-chips" role="radiogroup" aria-label="แผงของเครื่องนี้">
                {booths.map((b) => {
                  const on = b.id === device.boothId
                  return (
                    <button
                      key={b.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={cx('chip', on && 'active')}
                      onClick={() => {
                        if (on) return
                        setDevice({ boothId: b.id })
                        toast(`เครื่องนี้ขายที่ ${b.name}`, 'success')
                      }}
                    >
                      {on ? <Check size={18} aria-hidden="true" /> : <Store size={16} aria-hidden="true" />}
                      {b.name}
                    </button>
                  )
                })}
              </div>
              {!device.boothId && <p className="settings-note tone-warning">ยังไม่ได้เลือกแผง หน้าขายจะให้เลือกก่อน</p>}
              {openShift && <p className="settings-note">แผงที่เลือกเปิดร้านอยู่ ถ้าเปลี่ยนแผง ยอดขายที่ขายไปแล้วยังอยู่กับแผงเดิม และยังต้องปิดยอดแผงเดิมตามปกติ</p>}
            </div>
          )}
        </Card>

        <Card title="ล็อกหน้าจออัตโนมัติ">
          <div className="stack-sm">
            <div className="settings-chips" role="radiogroup" aria-label="ล็อกเมื่อไม่ได้ใช้">
              {LOCK_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={m === lockValue}
                  className={cx('chip', m === lockValue && 'active')}
                  onClick={() => setDevice({ autoLockMin: m })}
                >
                  {m === 0 ? 'ไม่ล็อก' : `${m} นาที`}
                </button>
              ))}
            </div>
            <p className="settings-note">ถ้าไม่มีใครแตะเครื่องตามเวลาที่ตั้ง จะกลับไปหน้าเลือกชื่อ ต้องใส่ PIN ใหม่ เหมาะกับเครื่องที่วางไว้หน้าร้าน</p>
          </div>
        </Card>

        <Card title="พื้นที่เก็บข้อมูล">
          <div className="stack-sm">
            {storage === null ? (
              <Loading />
            ) : (
              <>
                <div className="row-between">
                  <span className="row nowrap" style={{ gap: 8 }}>
                    <HardDrive size={20} aria-hidden="true" />
                    ใช้ไป {formatBytes(storage.usage)}
                  </span>
                  {storage.persisted === true ? (
                    <Badge tone="success">เก็บถาวร</Badge>
                  ) : storage.persisted === false ? (
                    <Badge tone="warning">อาจถูกลบเมื่อเครื่องเต็ม</Badge>
                  ) : null}
                </div>
                {storage.persisted === false && (
                  <>
                    <p className="settings-note">ข้อมูลร้านเก็บในเครื่องนี้ ถ้าเครื่องพื้นที่เต็ม เบราว์เซอร์อาจลบข้อมูลเอง กดปุ่มด้านล่างเพื่อขอเก็บถาวร และดาวน์โหลดไฟล์สำรองเป็นประจำ</p>
                    <Button onClick={() => void askPersist()} loading={asking}>
                      ขอเก็บข้อมูลถาวร
                    </Button>
                  </>
                )}
              </>
            )}
            <p className="settings-note">ติดตั้งเป็นแอป: เปิดใน Chrome กดเมนู ⋮ แล้วเลือก "เพิ่มลงในหน้าจอหลัก" หรือ "ติดตั้งแอป"</p>
          </div>
        </Card>

        <Card title="ข้อมูลเครื่อง">
          <dl className="settings-facts">
            <dt>รหัสเครื่อง</dt>
            <dd className="settings-code">{device.deviceId}</dd>
            <dt>รุ่นแอป</dt>
            <dd className="num">{APP_VERSION}</dd>
          </dl>
        </Card>
      </div>
    </div>
  )
}
