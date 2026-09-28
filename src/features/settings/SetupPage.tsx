// First run: create a new shop (4-step wizard), join an existing shop through sync, or restore a backup file.
import { useRef, useState, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArchiveRestore, ChevronRight, CircleAlert, CircleCheck, FileUp, Link2, Plus, Store, Trash2 } from 'lucide-react'
import { SYNC_TABLES, alive, db, tableOf } from '../../db'
import { getDevice, setDevice } from '../../device'
import { useSession } from '../../session'
import { createInitialData, PHOTO_TEMPLATE } from '../../seed'
import { syncNow, testConnection } from '../../sync'
import { BackupError, importBackup, parseBackup, type ParsedBackup } from '../../lib/backup'
import { promptPayPayload } from '../../lib/promptpay'
import { baht, dateTime } from '../../lib/format'
import { Button, Card, Field, IconButton, MoneyInput, QrCode, Spinner, Toggle, cx, useConfirm, useToast } from '../../ui'
import { WipeError, wipeThisDevice } from './dataOps'
import { checkBoothNames, checkPromptPay, parseSyncShare } from './logic'
import { Loading, PinSetter, TierCard } from './parts'
import { requestPersistentStorage } from './storage'
import './settings.css'

type Mode = 'start' | 'wizard' | 'join' | 'restore'

/** Any rows at all on this device (e.g. part of a shop pulled by a join that did not finish). */
async function hasLocalData(): Promise<boolean> {
  for (const name of SYNC_TABLES) if ((await tableOf(name).count()) > 0) return true
  return false
}

export default function SetupPage() {
  const shop = useLiveQuery(async () => (await db.shop.get('shop')) ?? null, [])
  const [mode, setMode] = useState<Mode>('start')
  // While a flow is finishing it navigates itself; don't let the "already set up" redirect jump first.
  const [hold, setHold] = useState(false)

  if (shop === undefined) return <Loading />
  if (shop && shop.deleted !== 1 && shop.setupDone === 1 && !hold) return <Navigate to="/login" replace />

  const back = () => setMode('start')
  return (
    <div className="setup">
      <div className="setup-inner">
        <header className="setup-brand">
          <span className="setup-logo" aria-hidden="true">
            ฿
          </span>
          <div>
            <h1 className="setup-title">ระบบร้าน</h1>
            <p className="setup-sub">ขาย ปิดยอด สต็อก รายงาน ใช้ได้แม้ไม่มีเน็ต</p>
          </div>
        </header>
        {mode === 'start' && <StartScreen onPick={setMode} />}
        {mode === 'wizard' && <Wizard onExit={back} onHold={setHold} />}
        {mode === 'join' && <JoinShop onExit={back} onHold={setHold} />}
        {mode === 'restore' && <RestoreFromFile onExit={back} onHold={setHold} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- start

function StartScreen({ onPick }: { onPick: (m: Mode) => void }) {
  const choices: { mode: Mode; title: string; sub: string; icon: ReactNode; primary?: boolean }[] = [
    { mode: 'wizard', title: 'เริ่มตั้งค่าร้านใหม่', sub: 'ใช้เครื่องนี้เป็นเครื่องแรกของร้าน ใช้เวลา 2–3 นาที', icon: <Store size={28} />, primary: true },
    { mode: 'join', title: 'เชื่อมกับร้านที่มีอยู่ (เครื่องที่ 2 ขึ้นไป)', sub: 'ใช้ลิงก์และรหัสซิงก์จากเครื่องแรก', icon: <Link2 size={28} /> },
    { mode: 'restore', title: 'กู้คืนจากไฟล์สำรอง', sub: 'มีไฟล์ .json ที่ดาวน์โหลดเก็บไว้', icon: <ArchiveRestore size={28} /> },
  ]
  return (
    <div className="stack">
      <h2 className="setup-step-title">เริ่มใช้งาน</h2>
      <div className="setup-choices">
        {choices.map((c) => (
          <button key={c.mode} type="button" className={cx('setup-choice', c.primary && 'primary')} onClick={() => onPick(c.mode)}>
            <span className="setup-choice-icon">{c.icon}</span>
            <span className="setup-choice-text">
              <span className="setup-choice-title">{c.title}</span>
              <span className="setup-choice-sub">{c.sub}</span>
            </span>
            <ChevronRight size={22} className="muted" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- wizard

const STEP_LABELS = ['ชื่อร้าน', 'เจ้าของ', 'แผงและปุ่มราคา', 'รับเงิน']

function Progress({ step }: { step: number }) {
  return (
    <div className="setup-progress" aria-label={`ขั้นที่ ${step} จาก ${STEP_LABELS.length}`}>
      <div className="setup-progress-bar" aria-hidden="true">
        {STEP_LABELS.map((_, i) => (
          <span key={i} className={cx('setup-progress-seg', i + 1 < step && 'done', i + 1 === step && 'current')} />
        ))}
      </div>
      <div className="setup-progress-text">
        <span>
          ขั้นที่ {step} จาก {STEP_LABELS.length}
        </span>
        <b>{STEP_LABELS[step - 1]}</b>
      </div>
    </div>
  )
}

interface HoldProps {
  onExit: () => void
  onHold: (on: boolean) => void
}

function Wizard({ onExit, onHold }: HoldProps) {
  const navigate = useNavigate()
  const { login } = useSession()
  const toast = useToast()
  const [step, setStep] = useState(1)
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  // Data from an unfinished "เชื่อมกับร้านที่มีอยู่" is on this device: a new shop would mix with it.
  const [leftover, setLeftover] = useState(false)

  const [shopName, setShopName] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerPin, setOwnerPin] = useState<string | null>(null)
  const [template, setTemplate] = useState<'photos' | 'empty'>('photos')
  const [boothNames, setBoothNames] = useState<string[]>([''])
  const [openingFloat, setOpeningFloat] = useState<number | null>(1000)
  const [ppId, setPpId] = useState('')
  const [ppName, setPpName] = useState('')
  const [halfHalf, setHalfHalf] = useState(true)

  const booths = checkBoothNames(boothNames)
  const pp = checkPromptPay(ppId)
  const errors = {
    shopName: !shopName.trim() ? 'ใส่ชื่อร้าน' : shopName.trim().length > 60 ? 'ชื่อร้านยาวเกินไป' : '',
    ownerName: !ownerName.trim() ? 'ใส่ชื่อเจ้าของ' : '',
    ownerPin: !ownerPin ? 'ตั้ง PIN ให้เสร็จก่อน' : '',
    booths: template === 'empty' ? booths.error : '',
    openingFloat: openingFloat == null ? 'ใส่เงินทอนตั้งต้น (ใส่ 0 ได้)' : '',
    pp: pp.error,
  }
  const stepOk = [
    !errors.shopName,
    !errors.ownerName && !errors.ownerPin,
    !errors.booths && !errors.openingFloat,
    !errors.pp,
  ]

  const go = (next: number) => {
    setShowErrors(false)
    setStep(next)
    window.scrollTo({ top: 0 })
  }
  const nextStep = () => {
    if (!stepOk[step - 1]) {
      setShowErrors(true)
      return
    }
    if (step < 4) go(step + 1)
    else void finish()
  }

  const finish = async () => {
    if (saving) return
    setSaving(true)
    onHold(true)
    try {
      if (await hasLocalData()) {
        setLeftover(true)
        setSaving(false)
        onHold(false)
        return
      }
      const owner = await createInitialData({
        shopName: shopName.trim(),
        ownerName: ownerName.trim(),
        ownerPin: ownerPin ?? '',
        promptPayId: pp.valid ? pp.digits : '',
        promptPayName: pp.valid ? ppName.trim() : '',
        halfHalfEnabled: halfHalf,
        template,
        boothNames: booths.names,
        openingFloat: openingFloat ?? 0,
      })
      const created = alive(await db.booths.toArray()).filter((b) => b.active === 1)
      if (created.length === 1) setDevice({ boothId: created[0].id })
      void requestPersistentStorage()
      login(owner)
      toast('ตั้งค่าร้านเสร็จแล้ว', 'success')
      navigate('/pos', { replace: true })
    } catch (e) {
      console.error('setup failed', e)
      toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error')
      setSaving(false)
      onHold(false)
    }
  }

  const tierCount = PHOTO_TEMPLATE.reduce((n, b) => n + b.tiers.length, 0)

  return (
    <div className="stack">
      <Progress step={step} />

      {step === 1 && (
        <Card>
          <div className="stack">
            <h2 className="setup-step-title">ร้านชื่ออะไร</h2>
            <Field label="ชื่อร้าน" error={showErrors && errors.shopName} hint="ชื่อนี้จะอยู่บนสรุปยอดที่ส่งเข้า LINE">
              <input
                className="input input-lg"
                value={shopName}
                maxLength={60}
                autoFocus
                placeholder="เช่น ร้านแม่ประตูน้ำ"
                onChange={(e) => setShopName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && nextStep()}
              />
            </Field>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <div className="stack">
            <h2 className="setup-step-title">เจ้าของร้าน</h2>
            <Field label="ชื่อเจ้าของ" error={showErrors && errors.ownerName}>
              <input className="input input-lg" value={ownerName} maxLength={40} placeholder="เช่น พี่หน่อย" onChange={(e) => setOwnerName(e.target.value)} />
            </Field>
            {ownerPin ? (
              <div className="settings-pin-done">
                <span className="row nowrap">
                  <CircleCheck size={20} aria-hidden="true" /> ตั้ง PIN แล้ว
                </span>
                <Button variant="ghost" onClick={() => setOwnerPin(null)}>
                  ตั้งใหม่
                </Button>
              </div>
            ) : (
              <>
                <p className="settings-note">PIN ใช้เข้าเมนูเจ้าของ ดูรายงาน และอนุมัติการยกเลิกบิล จำไว้ให้ดี</p>
                <PinSetter onDone={setOwnerPin} />
                {showErrors && errors.ownerPin && <p className="settings-note tone-danger">{errors.ownerPin}</p>}
              </>
            )}
          </div>
        </Card>
      )}

      {step === 3 && (
        <>
          <Card>
            <div className="stack">
              <h2 className="setup-step-title">แผงและปุ่มราคา</h2>
              <div className="setup-options" role="radiogroup" aria-label="แบบปุ่มราคา">
                <button type="button" role="radio" aria-checked={template === 'photos'} className={cx('setup-option', template === 'photos' && 'active')} onClick={() => setTemplate('photos')}>
                  <span className="setup-option-title">ใช้ปุ่มราคาตามป้ายในร้าน</span>
                  <span className="setup-option-sub">
                    {PHOTO_TEMPLATE.length} แผง {tierCount} ปุ่ม แก้ทีหลังได้
                  </span>
                </button>
                <button type="button" role="radio" aria-checked={template === 'empty'} className={cx('setup-option', template === 'empty' && 'active')} onClick={() => setTemplate('empty')}>
                  <span className="setup-option-title">ตั้งเอง</span>
                  <span className="setup-option-sub">ใส่ชื่อแผง แล้วเพิ่มปุ่มราคาทีหลัง</span>
                </button>
              </div>

              {template === 'photos' ? (
                <div>
                  {PHOTO_TEMPLATE.map((b) => (
                    <div key={b.name} className="setup-template-booth">
                      <div className="setup-template-name">
                        <Store size={18} aria-hidden="true" /> {b.name}
                      </div>
                      <div className="settings-cards">
                        {b.tiers.map((t, i) => (
                          <TierCard key={i} small name={t.name} price={t.price} promoQty={t.promoQty ?? null} promoPrice={t.promoPrice ?? null} unit={t.unit} color={t.color} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="stack-sm">
                  {boothNames.map((name, i) => (
                    <div key={i} className="setup-booth-row">
                      <input
                        className="input"
                        value={name}
                        maxLength={40}
                        aria-label={`ชื่อแผงที่ ${i + 1}`}
                        placeholder={`เช่น แผง${['เสื้อ', 'กางเกง', 'รองเท้า'][i % 3]}`}
                        onChange={(e) => setBoothNames((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
                      />
                      <IconButton
                        label="ลบแผงนี้"
                        variant="danger"
                        icon={<Trash2 size={20} />}
                        disabled={boothNames.length <= 1}
                        onClick={() => setBoothNames((list) => list.filter((_, j) => j !== i))}
                      />
                    </div>
                  ))}
                  <Button icon={<Plus size={20} />} onClick={() => setBoothNames((list) => [...list, ''])} disabled={boothNames.length >= 20}>
                    เพิ่มแผง
                  </Button>
                  {showErrors && errors.booths && <p className="settings-note tone-danger">{errors.booths}</p>}
                  <p className="settings-note">เพิ่มปุ่มราคาได้ที่ เมนู → ตั้งค่า → ปุ่มราคา</p>
                </div>
              )}
            </div>
          </Card>
          <Card>
            <Field label="เงินทอนตั้งต้นต่อแผง" hint="เงินที่ใส่ลิ้นชักตอนเปิดร้านทุกวัน แก้ได้ตอนเปิดร้าน" error={showErrors && errors.openingFloat}>
              <MoneyInput value={openingFloat} onChange={setOpeningFloat} />
            </Field>
          </Card>
        </>
      )}

      {step === 4 && (
        <>
          <Card>
            <div className="stack">
              <h2 className="setup-step-title">รับเงิน</h2>
              <Field
                label="พร้อมเพย์ (ไม่ใส่ก็ได้)"
                hint={pp.valid ? `${pp.typeLabel} · ลูกค้าสแกน QR จ่ายเข้าบัญชีนี้` : 'เบอร์มือถือ เลขบัตรประชาชน หรือ e-Wallet'}
                error={pp.error}
              >
                <input className="input input-lg" inputMode="numeric" autoComplete="off" value={ppId} maxLength={20} placeholder="เช่น 0812345678" onChange={(e) => setPpId(e.target.value)} />
              </Field>
              {pp.valid && (
                <>
                  <Field label="ชื่อบัญชี" hint="แสดงใต้ QR ให้ลูกค้าตรวจก่อนโอน">
                    <input className="input" value={ppName} maxLength={60} placeholder="เช่น นางสาว ใจดี มีสุข" onChange={(e) => setPpName(e.target.value)} />
                  </Field>
                  <div className="settings-qr">
                    <span className="settings-qr-title">ตัวอย่าง QR</span>
                    <QrCode text={promptPayPayload(pp.digits)} size={180} label="QR พร้อมเพย์ของร้าน" />
                    {ppName.trim() && <span className="settings-qr-sub">{ppName.trim()}</span>}
                    <span className="settings-qr-sub">ตอนขาย ระบบจะใส่ยอดเงินใน QR ให้เอง</span>
                  </div>
                </>
              )}
              <Toggle checked={halfHalf} onChange={setHalfHalf} label="รับคนละครึ่ง" hint="แสดงปุ่มคนละครึ่งตอนรับเงิน (ร้านรับผ่านแอปถุงเงิน)" />
            </div>
          </Card>
          {leftover && <LeftoverDataNotice />}
          <Card>
            <div className="setup-summary">
              <span>ร้าน: {shopName.trim()}</span>
              <span>เจ้าของ: {ownerName.trim()}</span>
              <span>{template === 'photos' ? `${PHOTO_TEMPLATE.length} แผง ${tierCount} ปุ่มราคา` : `${booths.names.length} แผง`}</span>
              <span>เงินทอน ฿{baht(openingFloat ?? 0)} ต่อแผง</span>
            </div>
          </Card>
        </>
      )}

      <div className="setup-nav">
        <Button size="lg" onClick={() => (step === 1 ? onExit() : go(step - 1))} disabled={saving}>
          กลับ
        </Button>
        <Button size="lg" variant="primary" onClick={nextStep} loading={saving}>
          {step < 4 ? 'ถัดไป' : 'เริ่มใช้งาน'}
        </Button>
      </div>
    </div>
  )
}

/** Shown instead of creating a shop when this device already holds (part of) a shop's data. */
function LeftoverDataNotice() {
  const confirm = useConfirm()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const wipe = async () => {
    const ok = await confirm({
      title: 'ล้างข้อมูลในเครื่องนี้',
      message: 'ลบข้อมูลร้านที่ดึงมาไม่ครบออกจากเครื่องนี้ แล้วเริ่มใหม่ ข้อมูลในชีตไม่ถูกลบ',
      confirmText: 'ล้างแล้วเริ่มใหม่',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await wipeThisDevice()
    } catch (e) {
      console.error('wipe failed', e)
      toast(e instanceof WipeError ? 'ปิดแอปนี้ในแท็บหรือหน้าต่างอื่นก่อน แล้วลองอีกครั้ง' : 'ล้างไม่สำเร็จ ลองอีกครั้ง', 'error')
      setBusy(false)
    }
  }
  return (
    <div className="settings-inline-status bad" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <div className="stack-sm">
        <span>
          เครื่องนี้มีข้อมูลร้านที่ดึงมาจากชีตไม่ครบ ตั้งร้านใหม่ไม่ได้ เพราะข้อมูลจะปนกัน ถ้าจะใช้ร้านเดิม ให้กดกลับไปที่ "เชื่อมกับร้านที่มีอยู่" แล้วกดเชื่อมต่ออีกครั้ง
        </span>
        <Button variant="danger" onClick={() => void wipe()} loading={busy}>
          ล้างข้อมูลในเครื่องนี้แล้วเริ่มใหม่
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- join an existing shop

function JoinShop({ onExit, onHold }: HoldProps) {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [phase, setPhase] = useState<'idle' | 'testing' | 'syncing' | 'nodata' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const busy = phase === 'testing' || phase === 'syncing'

  const connect = async () => {
    if (busy) return
    setPhase('testing')
    setMessage('')
    let test: { ok: boolean; message: string }
    try {
      test = await testConnection(url.trim(), key.trim())
    } catch (e) {
      console.error('test connection failed', e)
      test = { ok: false, message: 'เชื่อมต่อไม่ได้ ตรวจลิงก์และอินเทอร์เน็ต' }
    }
    if (!test.ok) {
      setPhase('error')
      setMessage(test.message)
      return
    }
    onHold(true)
    setDevice({ syncUrl: url.trim(), syncKey: key.trim() })
    setPhase('syncing')
    try {
      const st = await syncNow()
      const shop = await db.shop.get('shop')
      if (shop && shop.deleted !== 1 && shop.setupDone === 1) {
        navigate('/login', { replace: true })
        return
      }
      onHold(false)
      if (st.state === 'error' || st.state === 'offline') {
        await forgetLinkIfNothingArrived()
        setPhase('error')
        setMessage(st.error ?? 'ซิงก์ไม่สำเร็จ ลองอีกครั้ง')
      } else {
        setPhase('nodata')
      }
    } catch (e) {
      console.error('join failed', e)
      onHold(false)
      await forgetLinkIfNothingArrived()
      setPhase('error')
      setMessage('ซิงก์ไม่สำเร็จ ลองอีกครั้ง')
    }
  }

  // Nothing could be read from the sheet: switch sync off again, so choosing "เริ่มตั้งค่าร้านใหม่"
  // afterwards can't push a second shop into a sheet that may already hold this shop.
  // (If part of the shop did arrive, sync stays on and "เชื่อมต่ออีกครั้ง" continues from there.)
  const forgetLinkIfNothingArrived = async () => {
    try {
      if (!(await hasLocalData()) && getDevice().syncUrl) setDevice({ syncUrl: '', syncKey: '' })
    } catch (e) {
      console.error('join cleanup failed', e)
    }
  }

  return (
    <div className="stack">
      <h2 className="setup-step-title">เชื่อมกับร้านที่มีอยู่</h2>
      <Card>
        <div className="stack">
          <p className="settings-note">
            ที่เครื่องแรก เปิด เมนู → ตั้งค่า → ซิงก์และ LINE แล้วกด "ส่งลิงก์และรหัสไปเครื่องใหม่" (เช่น ส่งเข้า LINE ของตัวเอง) แล้วคัดลอกมาวางด้านล่าง
          </p>
          <Field label="ลิงก์ Apps Script (ลงท้ายด้วย /exec)" hint="วางข้อความที่ส่งมาทั้งข้อความในช่องนี้ได้ ระบบจะแยกลิงก์และรหัสให้">
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
                // The whole shared message pasted here: split it into link + key.
                const shared = parseSyncShare(e.target.value)
                if (shared) {
                  setUrl(shared.url)
                  setKey(shared.key)
                } else setUrl(e.target.value)
              }}
              disabled={busy}
            />
          </Field>
          <Field label="รหัสซิงก์">
            <input
              className="input"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={busy}
            />
          </Field>
          {phase === 'testing' && (
            <div className="setup-progress-box">
              <Spinner size={20} /> กำลังตรวจลิงก์และรหัส…
            </div>
          )}
          {phase === 'syncing' && (
            <div className="setup-progress-box">
              <Spinner size={20} /> เชื่อมต่อแล้ว กำลังดึงข้อมูลร้าน อาจใช้เวลาสักครู่…
            </div>
          )}
          {phase === 'error' && (
            <div className="settings-inline-status bad" role="alert">
              <CircleAlert size={18} aria-hidden="true" /> {message}
            </div>
          )}
          {phase === 'nodata' && (
            <div className="settings-inline-status warn" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>
                เชื่อมต่อได้ แต่ยังไม่มีข้อมูลร้านในชีตนี้ ให้เครื่องแรกเปิดแอปและซิงก์ก่อน แล้วกดเชื่อมต่ออีกครั้ง ถ้าเครื่องนี้คือเครื่องแรกของร้าน
                ให้กลับไปเลือก "เริ่มตั้งค่าร้านใหม่" ข้อมูลจะซิงก์ขึ้นชีตนี้ให้เอง
              </span>
            </div>
          )}
        </div>
      </Card>
      <div className="setup-nav">
        <Button size="lg" onClick={onExit} disabled={busy}>
          กลับ
        </Button>
        <Button size="lg" variant="primary" onClick={() => void connect()} loading={busy} disabled={!url.trim() || !key.trim()}>
          {phase === 'nodata' || phase === 'error' ? 'เชื่อมต่ออีกครั้ง' : 'เชื่อมต่อ'}
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- restore a backup file

function RestoreFromFile({ onExit, onHold }: HoldProps) {
  const navigate = useNavigate()
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ParsedBackup | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setReading(true)
    setError('')
    setParsed(null)
    setFileName(file.name)
    try {
      const p = parseBackup(await file.text())
      if (!p.shop || p.shop.setupDone !== 1 || p.shop.deleted === 1) setError('ไฟล์นี้ไม่มีข้อมูลการตั้งค่าร้าน เลือกไฟล์อื่น')
      else setParsed(p)
    } catch (e) {
      setError(e instanceof BackupError ? e.message : 'อ่านไฟล์ไม่ได้ เลือกไฟล์อื่น')
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const restore = async () => {
    if (!parsed || saving) return
    setSaving(true)
    onHold(true)
    try {
      const res = await importBackup(parsed)
      toast(`กู้คืนแล้ว ${(res.added + res.updated).toLocaleString('en-US')} รายการ`, 'success')
      navigate('/login', { replace: true })
    } catch (e) {
      console.error('restore failed', e)
      setError(e instanceof BackupError ? e.message : 'กู้คืนไม่สำเร็จ ลองอีกครั้ง')
      setSaving(false)
      onHold(false)
    }
  }

  const c = parsed?.live
  return (
    <div className="stack">
      <h2 className="setup-step-title">กู้คืนจากไฟล์สำรอง</h2>
      <Card>
        <div className="stack">
          <p className="settings-note">เลือกไฟล์ที่ดาวน์โหลดจาก ตั้งค่า → ข้อมูล → ดาวน์โหลดไฟล์สำรอง (ชื่อไฟล์ขึ้นต้นด้วย pratunam-backup)</p>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          <Button size="lg" block icon={<FileUp size={22} />} loading={reading} onClick={() => fileRef.current?.click()} disabled={saving}>
            {parsed ? 'เลือกไฟล์อื่น' : 'เลือกไฟล์สำรอง'}
          </Button>
          {error && (
            <div className="settings-inline-status bad" role="alert">
              <CircleAlert size={18} aria-hidden="true" /> {error}
            </div>
          )}
          {parsed && c && (
            <div className="settings-subtle-box">
              <dl className="settings-facts">
                <dt>ไฟล์</dt>
                <dd>{fileName}</dd>
                <dt>ร้าน</dt>
                <dd>{parsed.shop?.name}</dd>
                {parsed.exportedAt && (
                  <>
                    <dt>สำรองเมื่อ</dt>
                    <dd>{dateTime(parsed.exportedAt)}</dd>
                  </>
                )}
                <dt>ข้อมูล</dt>
                <dd>
                  {c.booths} แผง · {c.tiers} ปุ่มราคา · {c.staff} คน · {c.sales.toLocaleString('en-US')} บิล
                </dd>
              </dl>
            </div>
          )}
        </div>
      </Card>
      <div className="setup-nav">
        <Button size="lg" onClick={onExit} disabled={saving}>
          กลับ
        </Button>
        <Button size="lg" variant="primary" onClick={() => void restore()} loading={saving} disabled={!parsed}>
          กู้คืนข้อมูล
        </Button>
      </div>
    </div>
  )
}
