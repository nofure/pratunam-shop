// Backup / restore, CSV export, training data, go-live reset and wiping this device.
import { useEffect, useRef, useState } from 'react'
import { CircleAlert, Download, Eraser, FileSpreadsheet, FileUp, FlaskConical, Power } from 'lucide-react'
import { db } from '../../db'
import { useDevice } from '../../device'
import { useShop } from '../../hooks'
import { useSyncStatus } from '../../sync'
import { BackupError, backupFilename, backupJson, exportBackup, importBackup, parseBackup, saleItemsCsv, salesCsv, type ParsedBackup } from '../../lib/backup'
import { DEMO_STAFF_NAME, DEMO_STAFF_PIN, DemoError, generateDemoData } from '../../lib/demo'
import { downloadText } from '../../lib/share'
import { dateTime } from '../../lib/format'
import { todayKey } from '../../lib/dates'
import { Button, Card, Field, Modal, PageHeader, Toggle, useConfirm, useToast } from '../../ui'
import {
  SALES_TABLES,
  SALES_TABLE_LABEL,
  WipeError,
  clearDeviceDrafts,
  clearSalesData,
  countSalesData,
  isDemoStaffName,
  unsyncedCount,
  wipeThisDevice,
  type SalesTable,
} from './dataOps'
import { LAST_BACKUP_KEY, readLocal, writeLocal } from './storage'

const CONFIRM_WORD = 'ล้าง'

function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

export default function DataSettings() {
  const toast = useToast()
  const confirm = useConfirm()
  const shop = useShop()
  const device = useDevice()
  const sync = useSyncStatus()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [lastBackup, setLastBackup] = useState<number | null>(() => Number(readLocal(LAST_BACKUP_KEY)) || null)
  const [restore, setRestore] = useState<{ parsed: ParsedBackup; fileName: string } | null>(null)
  const [resetOpen, setResetOpen] = useState(false)

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  const downloadBackup = () =>
    run('backup', async () => {
      try {
        const file = await exportBackup()
        downloadText(backupFilename(file.exportedAt), backupJson(file), 'application/json')
        writeLocal(LAST_BACKUP_KEY, String(file.exportedAt))
        setLastBackup(file.exportedAt)
        toast('ดาวน์โหลดไฟล์สำรองแล้ว', 'success')
      } catch (e) {
        console.error('backup failed', e)
        toast('สร้างไฟล์สำรองไม่สำเร็จ', 'error')
      }
    })

  const pickRestore = (file: File | undefined) =>
    run('read', async () => {
      if (!file) return
      try {
        const parsed = parseBackup(await file.text())
        setRestore({ parsed, fileName: file.name })
      } catch (e) {
        toast(e instanceof BackupError ? e.message : 'อ่านไฟล์ไม่ได้', 'error')
      } finally {
        if (fileRef.current) fileRef.current.value = ''
      }
    })

  const doRestore = () =>
    run('restore', async () => {
      if (!restore) return
      try {
        const res = await importBackup(restore.parsed)
        setRestore(null)
        const parts = [`เพิ่ม ${fmt(res.added)}`, `อัปเดต ${fmt(res.updated)}`]
        if (res.skipped) parts.push(`ข้าม ${fmt(res.skipped)} (ในเครื่องใหม่กว่า)`)
        toast(`กู้คืนแล้ว · ${parts.join(' · ')}`, 'success')
      } catch (e) {
        console.error('restore failed', e)
        toast(e instanceof BackupError ? e.message : 'กู้คืนไม่สำเร็จ ลองอีกครั้ง', 'error')
      }
    })

  const exportCsv = (kind: 'bills' | 'items') =>
    run(`csv-${kind}`, async () => {
      try {
        const [sales, booths, staff] = await Promise.all([db.sales.toArray(), db.booths.toArray(), db.staff.toArray()])
        const live = sales.filter((s) => s.deleted !== 1)
        if (live.length === 0) {
          toast('ยังไม่มีบิล', 'info')
          return
        }
        const ctx = { booths, staff, shop }
        const text = kind === 'bills' ? salesCsv(live, ctx) : saleItemsCsv(live, ctx)
        downloadText(`pratunam-${kind === 'bills' ? 'bills' : 'items'}-${todayKey()}.csv`, text)
        toast(`ดาวน์โหลดแล้ว ${fmt(live.length)} บิล`, 'success')
      } catch (e) {
        console.error('csv failed', e)
        toast('สร้างไฟล์ไม่สำเร็จ', 'error')
      }
    })

  const makeDemo = async () => {
    if (busy) return
    const ok = await confirm({
      title: 'สร้างข้อมูลทดลอง 14 วัน',
      message:
        `ใช้ฝึกขาย ปิดยอด และดูรายงาน จะเพิ่มบิล การปิดยอด รับของเข้า และค่าใช้จ่ายของ 14 วันที่ผ่านมา (ไม่ยุ่งกับวันนี้)\n` +
        `ถ้ายังไม่มีคนขาย จะเพิ่ม "${DEMO_STAFF_NAME}" PIN ${DEMO_STAFF_PIN}\n` +
        `ก่อนใช้งานจริง กด "เริ่มใช้งานจริง: ล้างข้อมูลการขาย" ด้านล่าง` +
        (device.syncUrl ? '\nเครื่องนี้ซิงก์อยู่ ข้อมูลทดลองจะขึ้นชีตและเครื่องอื่นด้วย' : ''),
      confirmText: 'สร้างข้อมูลทดลอง',
    })
    if (!ok) return
    await run('demo', async () => {
      try {
        const r = await generateDemoData({ days: 14 })
        if (r.shifts === 0) toast('มีข้อมูลของ 14 วันที่ผ่านมาอยู่แล้ว ไม่ได้สร้างเพิ่ม', 'info')
        else toast(`สร้างแล้ว ${fmt(r.sales)} บิล ${r.shifts} รอบปิดยอด`, 'success')
      } catch (e) {
        console.error('demo failed', e)
        toast(e instanceof DemoError ? e.message : 'สร้างข้อมูลทดลองไม่สำเร็จ', 'error')
      }
    })
  }

  const wipe = async () => {
    if (busy) return
    let pending = 0
    try {
      pending = await unsyncedCount()
    } catch {
      pending = 0
    }
    const syncOn = !!device.syncUrl
    const risk = syncOn
      ? pending > 0
        ? `ยังมี ${fmt(pending)} รายการที่ยังไม่ได้ซิงก์ขึ้นชีต จะหายไปถาวร กด "ซิงก์ตอนนี้" ให้เสร็จก่อน`
        : 'ข้อมูลที่ซิงก์แล้วยังอยู่ในชีต เชื่อมเครื่องนี้กลับได้ทีหลัง'
      : 'เครื่องนี้ไม่ได้ซิงก์ ข้อมูลร้านทั้งหมดอยู่ในเครื่องนี้เท่านั้น จะหายไปถาวร ดาวน์โหลดไฟล์สำรองก่อน'
    const first = await confirm({
      title: 'ล้างเครื่องนี้ทั้งหมด',
      message: `ลบข้อมูลร้านและการตั้งค่าทั้งหมดออกจากเครื่องนี้ แล้วกลับไปหน้าตั้งค่าครั้งแรก\n${risk}`,
      confirmText: 'ล้างเครื่องนี้',
      danger: true,
    })
    if (!first) return
    const second = await confirm({
      title: 'แน่ใจแล้วใช่ไหม',
      message: syncOn && pending === 0 ? 'ย้อนกลับไม่ได้' : 'ย้อนกลับไม่ได้ ข้อมูลที่ไม่ได้สำรองจะหายถาวร',
      confirmText: 'ล้างเลย',
      danger: true,
    })
    if (!second) return
    await run('wipe', async () => {
      try {
        await wipeThisDevice()
      } catch (e) {
        console.error('wipe failed', e)
        toast(e instanceof WipeError ? 'ปิดแอปนี้ในแท็บหรือหน้าต่างอื่นก่อน แล้วลองอีกครั้ง' : 'ล้างไม่สำเร็จ ลองอีกครั้ง', 'error')
      }
    })
  }

  return (
    <div className="page settings-page">
      <PageHeader title="ข้อมูล" back="/settings" />
      <div className="stack">
        <Card title="สำรองข้อมูล">
          <div className="stack-sm">
            <p className="settings-note">
              ดาวน์โหลดไฟล์เก็บทุกอย่างของร้าน (รวมรายการที่ลบแล้ว) เก็บไว้ใน Google Drive หรือส่งเข้า LINE ของตัวเอง ควรทำทุกสัปดาห์
              {!device.syncUrl && ' เครื่องนี้ไม่ได้ซิงก์ ไฟล์สำรองคือทางเดียวที่กู้ข้อมูลได้ถ้าเครื่องหาย'}
            </p>
            <p className="settings-muted">{lastBackup ? `สำรองล่าสุดในเครื่องนี้: ${dateTime(lastBackup)}` : 'ยังไม่เคยสำรองจากเครื่องนี้'}</p>
            <Button variant="primary" icon={<Download size={20} />} onClick={() => void downloadBackup()} loading={busy === 'backup'} disabled={!!busy && busy !== 'backup'}>
              ดาวน์โหลดไฟล์สำรอง
            </Button>
          </div>
        </Card>

        <Card title="กู้คืนจากไฟล์สำรอง">
          <div className="stack-sm">
            <p className="settings-note">รวมข้อมูลในไฟล์เข้ากับข้อมูลในเครื่อง รายการเดียวกันจะใช้ฉบับที่แก้ล่าสุด ข้อมูลในเครื่องไม่ถูกลบ</p>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => void pickRestore(e.target.files?.[0])} />
            <Button icon={<FileUp size={20} />} onClick={() => fileRef.current?.click()} loading={busy === 'read'} disabled={!!busy && busy !== 'read'}>
              เลือกไฟล์สำรอง
            </Button>
          </div>
        </Card>

        <Card title="ส่งออกไปเปิดใน Excel / Google Sheets">
          <div className="stack-sm">
            <p className="settings-note">ไฟล์ CSV ของบิลทั้งหมด (รวมบิลที่ยกเลิก) เปิดด้วย Excel หรือ Google Sheets ได้ ภาษาไทยไม่เพี้ยน</p>
            <div className="settings-actions">
              <Button icon={<FileSpreadsheet size={20} />} onClick={() => void exportCsv('bills')} loading={busy === 'csv-bills'} disabled={!!busy && busy !== 'csv-bills'}>
                บิลทั้งหมด
              </Button>
              <Button icon={<FileSpreadsheet size={20} />} onClick={() => void exportCsv('items')} loading={busy === 'csv-items'} disabled={!!busy && busy !== 'csv-items'}>
                รายการสินค้า
              </Button>
            </div>
          </div>
        </Card>

        <Card title="ข้อมูลทดลอง (สำหรับฝึก)">
          <div className="stack-sm">
            <p className="settings-note">สร้างยอดขายสมมุติ 14 วันจากแผงและปุ่มราคาของร้าน ให้คนขายฝึกใช้ และเจ้าของลองดูรายงาน</p>
            <Button icon={<FlaskConical size={20} />} onClick={() => void makeDemo()} loading={busy === 'demo'} disabled={!!busy && busy !== 'demo'}>
              สร้างข้อมูลทดลอง 14 วัน
            </Button>
          </div>
        </Card>

        <Card title="เริ่มใช้งานจริง">
          <div className="stack-sm">
            <p className="settings-note">
              ลบบิล การปิดยอด เงินเข้า-ออก รับของเข้า ปรับสต็อก และค่าใช้จ่ายทั้งหมด เก็บการตั้งค่าร้าน แผง ปุ่มราคา และคนขายไว้ ใช้หลังฝึกเสร็จ
              {sync.state !== 'off' && ' การลบจะซิงก์ไปทุกเครื่อง'}
            </p>
            <Button variant="danger" icon={<Eraser size={20} />} onClick={() => setResetOpen(true)} disabled={!!busy}>
              ล้างข้อมูลการขาย
            </Button>
          </div>
        </Card>

        <Card title="ล้างเครื่องนี้ทั้งหมด">
          <div className="stack-sm">
            <p className="settings-note">ลบทุกอย่างของแอปออกจากเครื่องนี้ ใช้เมื่อจะเลิกใช้เครื่องนี้ หรือตั้งค่าผิดร้าน</p>
            <Button variant="ghost" className="settings-btn-danger" icon={<Power size={20} />} onClick={() => void wipe()} loading={busy === 'wipe'} disabled={!!busy && busy !== 'wipe'}>
              ล้างเครื่องนี้ทั้งหมด
            </Button>
          </div>
        </Card>
      </div>

      {restore && (
        <Modal
          open
          onClose={() => busy !== 'restore' && setRestore(null)}
          title="กู้คืนจากไฟล์สำรอง"
          footer={
            <>
              <Button onClick={() => setRestore(null)} disabled={busy === 'restore'}>
                กลับ
              </Button>
              <Button variant="primary" onClick={() => void doRestore()} loading={busy === 'restore'}>
                กู้คืนข้อมูล
              </Button>
            </>
          }
        >
          <div className="stack">
            <dl className="settings-facts">
              <dt>ไฟล์</dt>
              <dd>{restore.fileName}</dd>
              <dt>ร้าน</dt>
              <dd>{restore.parsed.shop?.name ?? 'ไม่มีข้อมูลร้าน'}</dd>
              {restore.parsed.exportedAt && (
                <>
                  <dt>สำรองเมื่อ</dt>
                  <dd>{dateTime(restore.parsed.exportedAt)}</dd>
                </>
              )}
              <dt>ข้อมูล</dt>
              <dd>
                {restore.parsed.live.booths} แผง · {restore.parsed.live.tiers} ปุ่มราคา · {restore.parsed.live.staff} คน · {fmt(restore.parsed.live.sales)} บิล
              </dd>
            </dl>
            {restore.parsed.shop && shop && restore.parsed.shop.name.trim() !== shop.name.trim() && (
              <div className="settings-inline-status warn">
                <CircleAlert size={18} aria-hidden="true" />
                <span>ชื่อร้านในไฟล์ ({restore.parsed.shop.name}) ไม่ตรงกับร้านในเครื่อง ({shop.name}) ตรวจว่าเลือกไฟล์ถูก</span>
              </div>
            )}
            {restore.parsed.invalid > 0 && <p className="settings-note tone-warning">มี {fmt(restore.parsed.invalid)} รายการในไฟล์ที่เสียหาย จะข้ามไป</p>}
            <p className="settings-note">รายการที่ในเครื่องแก้ใหม่กว่าไฟล์จะไม่ถูกทับ{device.syncUrl ? ' ข้อมูลที่กู้คืนจะซิงก์ขึ้นชีตด้วย' : ''}</p>
          </div>
        </Modal>
      )}

      {resetOpen && <ResetSalesModal onClose={() => setResetOpen(false)} onBackup={() => void downloadBackup()} backingUp={busy === 'backup'} />}
    </div>
  )
}

function ResetSalesModal({ onClose, onBackup, backingUp }: { onClose: () => void; onBackup: () => void; backingUp: boolean }) {
  const toast = useToast()
  const [counts, setCounts] = useState<Record<SalesTable, number> | null>(null)
  const [demoStaff, setDemoStaff] = useState<number | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [typed, setTyped] = useState('')
  const [offDemo, setOffDemo] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([countSalesData(), db.staff.toArray()])
      .then(([c, staff]) => {
        if (!alive) return
        setCounts(c)
        setDemoStaff(staff.filter((s) => s.deleted !== 1 && s.active === 1 && s.role === 'staff' && isDemoStaffName(s.name)).length)
      })
      .catch((e) => {
        console.error('count failed', e)
        if (alive) setLoadError(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const total = counts ? SALES_TABLES.reduce((n, t) => n + counts[t], 0) : 0
  const ready = typed.trim() === CONFIRM_WORD && !!counts

  const submit = async () => {
    if (!ready || saving) return
    setSaving(true)
    try {
      const res = await clearSalesData({ deactivateDemoStaff: offDemo && (demoStaff ?? 0) > 0 })
      await clearDeviceDrafts()
      const n = SALES_TABLES.reduce((sum, t) => sum + res.counts[t], 0)
      toast(`ล้างแล้ว ${fmt(n)} รายการ พร้อมใช้งานจริง`, 'success')
      onClose()
    } catch (e) {
      console.error('reset failed', e)
      toast('ล้างไม่สำเร็จ ลองอีกครั้ง', 'error')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      closeOnBackdrop={false}
      title="ล้างข้อมูลการขาย"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            กลับ
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={saving} disabled={!ready}>
            ล้างข้อมูลการขาย
          </Button>
        </>
      }
    >
      <div className="stack">
        {loadError ? (
          <p className="settings-note tone-danger">นับข้อมูลไม่สำเร็จ ปิดแล้วลองอีกครั้ง</p>
        ) : !counts ? (
          <p className="settings-muted">กำลังนับข้อมูล…</p>
        ) : (
          <div className="settings-subtle-box">
            <dl className="settings-facts">
              {SALES_TABLES.map((t) => (
                <FragmentRow key={t} label={SALES_TABLE_LABEL[t]} value={`${fmt(counts[t])} รายการ`} />
              ))}
            </dl>
          </div>
        )}
        <p className="settings-note">
          ทั้งหมด {fmt(total)} รายการจะถูกลบ ร้านที่เปิดอยู่ตอนนี้จะต้องเปิดร้านใหม่ การตั้งค่าร้าน แผง ปุ่มราคา คนขาย และร้านที่ซื้อของยังอยู่
        </p>
        <Button icon={<Download size={20} />} onClick={onBackup} loading={backingUp} disabled={saving}>
          ดาวน์โหลดไฟล์สำรองก่อน
        </Button>
        {(demoStaff ?? 0) > 0 && <Toggle checked={offDemo} onChange={setOffDemo} label="ปิดการใช้งานคนขายทดลอง" hint={`${demoStaff} คน ชื่อที่มีคำว่า (ทดลอง)`} />}
        <Field label={`พิมพ์คำว่า "${CONFIRM_WORD}" เพื่อยืนยัน`}>
          <input className="input" value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} disabled={saving} />
        </Field>
      </div>
    </Modal>
  )
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </>
  )
}
