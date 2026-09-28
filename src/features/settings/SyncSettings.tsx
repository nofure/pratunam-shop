// Multi-device sync (Google Apps Script) and LINE push settings for this device.
import { useState } from 'react'
import { AlertTriangle, CircleAlert, CircleCheck, Cloud, CloudOff, Copy, RefreshCw, Send } from 'lucide-react'
import { setDevice, useDevice } from '../../device'
import { useShop } from '../../hooks'
import { sendLineViaBackend, syncNow, testConnection, useSyncStatus, type SyncStatus } from '../../sync'
import { shareOrCopy } from '../../lib/share'
import { dateTime } from '../../lib/format'
import { Badge, Button, Card, Field, PageHeader, Toggle, useConfirm, useToast, type BadgeTone } from '../../ui'
import { SYNC_SHARE_TITLE, parseSyncShare, syncShareText } from './logic'

const CODE_GS_URL = 'https://raw.githubusercontent.com/nofure/pratunam-shop/main/backend/Code.gs'
const GUIDE_URL = 'https://github.com/nofure/pratunam-shop/blob/main/docs/sync-setup.md'

const STATE_TEXT: Record<SyncStatus['state'], { label: string; tone: BadgeTone }> = {
  off: { label: 'ปิดอยู่', tone: 'neutral' },
  idle: { label: 'รอซิงก์', tone: 'info' },
  syncing: { label: 'กำลังซิงก์', tone: 'info' },
  ok: { label: 'ซิงก์แล้ว', tone: 'success' },
  error: { label: 'ซิงก์ไม่สำเร็จ', tone: 'danger' },
  offline: { label: 'ออฟไลน์', tone: 'warning' },
}

type Result = { ok: boolean; message: string } | null

function ResultBox({ result }: { result: Result }) {
  if (!result) return null
  return (
    <div className={`settings-inline-status ${result.ok ? 'ok' : 'bad'}`} role="status">
      {result.ok ? <CircleCheck size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
      <span>{result.message}</span>
    </div>
  )
}

export default function SyncSettings() {
  const device = useDevice()
  const status = useSyncStatus()
  const shop = useShop()
  const toast = useToast()
  const confirm = useConfirm()
  const [url, setUrl] = useState(device.syncUrl)
  const [key, setKey] = useState(device.syncKey)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<Result>(null)
  const [lineBusy, setLineBusy] = useState(false)
  const [lineResult, setLineResult] = useState<Result>(null)

  const configured = !!device.syncUrl.trim()
  const dirty = url.trim() !== device.syncUrl.trim() || key.trim() !== device.syncKey.trim()
  const st = STATE_TEXT[status.state]
  const busySync = status.state === 'syncing'

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await testConnection(url.trim(), key.trim()))
    } finally {
      setTesting(false)
    }
  }

  const saveAndSync = async () => {
    if (!url.trim() || !key.trim()) {
      setTestResult({ ok: false, message: !url.trim() ? 'ใส่ลิงก์ Apps Script ก่อน' : 'ใส่รหัสซิงก์ก่อน' })
      return
    }
    setSaving(true)
    try {
      const res = await testConnection(url.trim(), key.trim())
      setTestResult(res)
      if (!res.ok) {
        const keep = await confirm({
          title: 'ยังเชื่อมต่อไม่ได้',
          message: `${res.message}\nบันทึกไว้ก่อนได้ แอปจะลองซิงก์เองเมื่อเชื่อมต่อได้`,
          confirmText: 'บันทึกไว้ก่อน',
          cancelText: 'กลับไปแก้',
        })
        if (!keep) return
      }
      setDevice({ syncUrl: url.trim(), syncKey: key.trim() })
      toast('บันทึกแล้ว กำลังซิงก์', 'success')
      const after = await syncNow()
      if (after.state === 'ok') toast('ซิงก์เสร็จแล้ว', 'success')
      else if (after.error) toast(after.error, 'error')
    } finally {
      setSaving(false)
    }
  }

  const turnOff = async () => {
    const ok = await confirm({
      title: 'ปิดการซิงก์ในเครื่องนี้',
      message:
        (status.pending > 0 ? `ยังมี ${status.pending} รายการที่ยังไม่ได้ส่งขึ้นชีต ข้อมูลยังอยู่ในเครื่องนี้ และจะส่งเมื่อเปิดซิงก์อีกครั้ง\n` : '') +
        'เครื่องนี้จะไม่รับส่งข้อมูลกับเครื่องอื่น และส่ง LINE อัตโนมัติไม่ได้',
      confirmText: 'ปิดการซิงก์',
      danger: true,
    })
    if (!ok) return
    setDevice({ syncUrl: '', syncKey: '' })
    setUrl('')
    setKey('')
    setTestResult(null)
    toast('ปิดการซิงก์แล้ว', 'info')
  }

  const shareForOtherDevice = async () => {
    const res = await shareOrCopy(syncShareText(device.syncUrl, device.syncKey), SYNC_SHARE_TITLE)
    if (res === 'copied') toast('คัดลอกแล้ว วางส่งให้เครื่องใหม่ เช่น ทาง LINE ของตัวเอง', 'success')
  }

  const testLine = async () => {
    setLineBusy(true)
    setLineResult(null)
    try {
      const name = shop?.name ?? 'ร้าน'
      setLineResult(await sendLineViaBackend(`ทดสอบส่ง LINE จาก ${name}\n${dateTime(Date.now())}`))
    } finally {
      setLineBusy(false)
    }
  }

  return (
    <div className="page settings-page">
      <PageHeader title="ซิงก์และ LINE" back="/settings" />
      <div className="stack">
        <Card
          title="สถานะ"
          actions={
            <Badge tone={st.tone} icon={status.state === 'off' ? <CloudOff /> : status.state === 'error' ? <AlertTriangle /> : <Cloud />}>
              {st.label}
            </Badge>
          }
        >
          {configured ? (
            <div className="stack-sm">
              <dl className="settings-facts">
                <dt>ซิงก์ล่าสุด</dt>
                <dd>{status.lastSyncAt ? dateTime(status.lastSyncAt) : 'ยังไม่เคย'}</dd>
                <dt>รอส่ง</dt>
                <dd className="num">{status.pending} รายการ</dd>
              </dl>
              {status.error && (
                <div className="settings-inline-status bad" role="alert">
                  <CircleAlert size={18} aria-hidden="true" /> {status.error}
                </div>
              )}
              <Button icon={<RefreshCw size={20} className={busySync ? 'spin' : undefined} />} onClick={() => void syncNow()} disabled={busySync}>
                {busySync ? 'กำลังซิงก์…' : 'ซิงก์ตอนนี้'}
              </Button>
            </div>
          ) : (
            <p className="settings-note">
              ตอนนี้ใช้เครื่องเดียว ข้อมูลอยู่ในเครื่องนี้เท่านั้น ถ้ามีหลายเครื่อง หรืออยากให้สรุปยอดเด้งเข้า LINE เอง ให้ตั้งค่าด้านล่าง
            </p>
          )}
        </Card>

        <Card title="ตั้งค่าการซิงก์">
          <div className="stack">
            <Field label="ลิงก์ Apps Script" hint="ลิงก์ที่ลงท้ายด้วย /exec">
              <input
                className="input"
                type="url"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={url}
                placeholder="https://script.google.com/macros/s/…/exec"
                onChange={(e) => {
                  const shared = parseSyncShare(e.target.value)
                  if (shared) {
                    setUrl(shared.url)
                    setKey(shared.key)
                  } else setUrl(e.target.value)
                  setTestResult(null)
                }}
              />
            </Field>
            <Field label="รหัสซิงก์" hint="ต้องตรงกับ SYNC_KEY ใน Apps Script ทุกเครื่องใช้รหัสเดียวกัน">
              <input
                className="input"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value)
                  setTestResult(null)
                }}
              />
            </Field>
            <ResultBox result={testResult} />
            <div className="settings-actions">
              <Button onClick={() => void test()} loading={testing} disabled={saving || !url.trim()}>
                ทดสอบการเชื่อมต่อ
              </Button>
              <Button variant="primary" onClick={() => void saveAndSync()} loading={saving} disabled={testing || (!dirty && configured)}>
                บันทึก
              </Button>
            </div>
            {configured && (
              <div className="settings-actions">
                <Button icon={<Copy size={20} />} onClick={() => void shareForOtherDevice()}>
                  ส่งลิงก์และรหัสไปเครื่องใหม่
                </Button>
                <Button variant="ghost" className="settings-btn-danger" icon={<CloudOff size={20} />} onClick={() => void turnOff()}>
                  ปิดการซิงก์
                </Button>
              </div>
            )}
            {configured && <p className="settings-note">ลิงก์และรหัสซิงก์เป็นความลับ ใครมีทั้งสองอย่างจะอ่านข้อมูลร้านได้ทั้งหมด</p>}
          </div>
        </Card>

        <Card title="LINE">
          <div className="stack-sm">
            <Toggle
              checked={device.lineNotify}
              onChange={(v) => setDevice({ lineNotify: v })}
              label="ส่งสรุปเข้า LINE อัตโนมัติตอนปิดยอด"
              hint={configured ? 'ต้องตั้งค่า LINE ใน Apps Script ก่อน ถ้าไม่มีเน็ตจะส่งให้เองเมื่อกลับมาออนไลน์' : 'ใช้ได้เมื่อตั้งค่าการซิงก์แล้ว ถ้ายังไม่ตั้ง ใช้ปุ่มแชร์ LINE ตอนปิดยอดแทน'}
            />
            <Button icon={<Send size={20} />} onClick={() => void testLine()} loading={lineBusy} disabled={!configured}>
              ทดสอบส่ง LINE
            </Button>
            <ResultBox result={lineResult} />
          </div>
        </Card>

        <Card title="วิธีตั้งค่า (ทำครั้งเดียว ที่คอมพิวเตอร์จะง่ายสุด)">
          <ol className="settings-steps">
            <li>สร้าง Google Sheet ใหม่ด้วยบัญชี Google ของเจ้าของร้าน</li>
            <li>
              เมนู ส่วนขยาย → Apps Script ลบโค้ดเดิม แล้ววางโค้ดทั้งหมดจาก{' '}
              <a href={CODE_GS_URL} target="_blank" rel="noreferrer">
                ไฟล์ Code.gs
              </a>
            </li>
            <li>ตั้งรหัสลับ SYNC_KEY ที่ การตั้งค่าโปรเจ็กต์ → พร็อพเพอร์ตี้ของสคริปต์ (หรือเรียกใช้ setup ให้สร้างให้)</li>
            <li>เลือกฟังก์ชัน setup แล้วกด เรียกใช้ และกดอนุญาตสิทธิ์</li>
            <li>การทำให้ใช้งานได้ → รายการใหม่ → เว็บแอป เรียกใช้ในฐานะ "ฉัน" ผู้มีสิทธิ์ "ทุกคน"</li>
            <li>คัดลอกลิงก์ที่ลงท้าย /exec มาวางด้านบน ใส่รหัสซิงก์ กดทดสอบ แล้วกดบันทึก</li>
            <li>เครื่องอื่น: หน้าตั้งค่าร้านครั้งแรก เลือก "เชื่อมกับร้านที่มีอยู่" แล้วใส่ลิงก์และรหัสเดียวกัน</li>
          </ol>
          <p className="settings-note" style={{ marginTop: 12 }}>
            ขั้นตอนละเอียดพร้อมวิธีตั้งค่า LINE:{' '}
            <a href={GUIDE_URL} target="_blank" rel="noreferrer">
              คู่มือตั้งค่าซิงก์และ LINE
            </a>
          </p>
        </Card>
      </div>
    </div>
  )
}
