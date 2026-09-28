// People who use the app (เจ้าของ / คนขาย): name, role, usual booth, PIN, active.
import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Plus, Trash2 } from 'lucide-react'
import { alive, db, patch, remove, save } from '../../db'
import { useBooths, useStaffList } from '../../hooks'
import { useSession } from '../../session'
import type { Booth, ID, Role, Staff } from '../../types'
import { Badge, Button, EmptyState, Field, Modal, PageHeader, Segmented, Toggle, cx, useConfirm, useToast } from '../../ui'
import { activeOwners, pinConflicts, wouldRemoveLastOwner } from './logic'
import { Avatar, Loading, PinSetter, RoleBadge } from './parts'

class LastOwnerError extends Error {}

export default function StaffSettings() {
  const staff = useStaffList(true)
  const booths = useBooths(true)
  const { staff: me } = useSession()
  const [editing, setEditing] = useState<Staff | 'new' | null>(null)

  const boothName = (id: ID | null) => (id ? (booths?.find((b) => b.id === id)?.name ?? 'แผงที่ลบแล้ว') : 'ทุกแผง')

  return (
    <div className="page settings-page">
      <PageHeader
        title="คนขาย"
        back="/settings"
        actions={
          <Button variant="primary" icon={<Plus size={20} />} onClick={() => setEditing('new')}>
            เพิ่มคน
          </Button>
        }
      />
      {staff === undefined || booths === undefined ? (
        <Loading />
      ) : staff.length === 0 ? (
        <EmptyState title="ยังไม่มีคนขาย" />
      ) : (
        <>
          <div className="list">
            {staff.map((s) => (
              <div key={s.id} className={cx('settings-row', s.active !== 1 && 'is-off')}>
                <button type="button" className="settings-row-main" onClick={() => setEditing(s)}>
                  <Avatar name={s.name} role={s.role} />
                  <span className="settings-row-text">
                    <span className="settings-row-title">
                      {s.name}
                      <RoleBadge role={s.role} />
                      {s.id === me?.id && <Badge tone="success">คุณ</Badge>}
                      {s.active !== 1 && <Badge>ปิดใช้งาน</Badge>}
                    </span>
                    <span className="settings-row-sub">
                      {boothName(s.boothId)} · PIN {s.pin.length} หลัก
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </div>
          <p className="settings-note" style={{ marginTop: 12 }}>
            ทุกคนเข้าแอปด้วยการแตะชื่อแล้วใส่ PIN ของตัวเอง บิลจะบันทึกชื่อคนขาย เจ้าของเห็นรายงานและตั้งค่าได้ คนขายขายและปิดยอดได้
          </p>
        </>
      )}
      {editing && staff && booths && (
        <StaffEditor
          key={editing === 'new' ? 'new' : editing.id}
          person={editing === 'new' ? null : editing}
          all={staff}
          booths={booths}
          meId={me?.id ?? null}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

interface EditorProps {
  person: Staff | null
  all: Staff[]
  booths: Booth[]
  meId: ID | null
  onClose: () => void
}

function StaffEditor({ person, all, booths, meId, onClose }: EditorProps) {
  const toast = useToast()
  const confirm = useConfirm()
  const [name, setName] = useState(person?.name ?? '')
  const [role, setRole] = useState<Role>(person?.role ?? 'staff')
  const [boothId, setBoothId] = useState<ID | ''>(() => (person?.boothId && booths.some((b) => b.id === person.boothId) ? person.boothId : ''))
  const [active, setActive] = useState(person ? person.active === 1 : true)
  const [newPin, setNewPin] = useState<string | null>(null)
  const [changingPin, setChangingPin] = useState(!person)
  const [showPin, setShowPin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const isMe = !!person && person.id === meId
  const soleOwner = !!person && wouldRemoveLastOwner(all, person.id, { role: 'staff' })
  const pin = newPin ?? person?.pin ?? ''
  const nameTaken = all.some((s) => s.id !== person?.id && s.active === 1 && s.name.trim() === name.trim())
  const errors = {
    name: !name.trim() ? 'ใส่ชื่อ' : nameTaken ? 'มีคนชื่อนี้แล้ว ใช้ชื่อเล่นที่ต่างกัน จะได้ไม่สับสนตอนเลือกชื่อ' : '',
    pin: !pin ? 'ตั้ง PIN ก่อน' : '',
  }
  const boothOptions = booths.filter((b) => b.active === 1 || b.id === boothId)

  const conflictText = (p: string, r: Role): string | null => {
    const clash = pinConflicts(all, p, person?.id ?? null)
    if (clash.length === 0) return null
    const names = clash.map((s) => s.name).join(', ')
    const ownerClash = r === 'staff' && clash.some((s) => s.role === 'owner')
    return ownerClash
      ? `PIN นี้ซ้ำกับเจ้าของร้าน (${names}) คนขายจะอนุมัติแทนเจ้าของได้ ควรตั้งใหม่`
      : `PIN นี้ซ้ำกับ ${names} ควรใช้ PIN ต่างกัน`
  }

  const submit = async () => {
    if (errors.name || errors.pin) {
      setShowErrors(true)
      return
    }
    if (changingPin && !newPin && person) {
      toast('ตั้ง PIN ใหม่ให้เสร็จ หรือกด "ไม่เปลี่ยน PIN"', 'error')
      return
    }
    const clash = conflictText(pin, role)
    if (clash && active) {
      const ok = await confirm({ title: 'PIN ซ้ำกับคนอื่น', message: clash, confirmText: 'บันทึกต่อ', cancelText: 'กลับไปแก้' })
      if (!ok) return
    }
    if (isMe && person?.role === 'owner' && role === 'staff') {
      const ok = await confirm({
        title: 'เปลี่ยนตัวเองเป็นคนขาย',
        message: 'บันทึกแล้วคุณจะเข้าเมนูเจ้าของ (รายงาน ตั้งค่า) ไม่ได้ทันที',
        confirmText: 'เปลี่ยน',
        danger: true,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const rec = { name: name.trim(), role, boothId: boothId || null, active: (active ? 1 : 0) as 0 | 1, pin }
      await db.transaction('rw', db.staff, async () => {
        if (person) {
          const fresh = alive(await db.staff.toArray())
          if (wouldRemoveLastOwner(fresh, person.id, { role: rec.role, active: rec.active })) throw new LastOwnerError()
          await patch(db.staff, person.id, rec)
        } else {
          await save<Staff>(db.staff, rec)
        }
      })
      toast(person ? 'บันทึกแล้ว' : `เพิ่ม ${rec.name} แล้ว`, 'success')
      onClose()
    } catch (e) {
      if (e instanceof LastOwnerError) toast('ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คน', 'error')
      else {
        console.error('save staff failed', e)
        toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!person) return
    if (isMe) {
      toast('ลบตัวเองไม่ได้', 'error')
      return
    }
    if (wouldRemoveLastOwner(all, person.id, { deleted: 1 })) {
      toast('ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คน', 'error')
      return
    }
    const ok = await confirm({
      title: `ลบ ${person.name}`,
      message: 'ชื่อนี้จะเข้าแอปไม่ได้อีก บิลและการปิดยอดที่เคยทำยังอยู่ในรายงาน ถ้าแค่หยุดงานชั่วคราว ให้ปิด "ใช้งานอยู่" แทน',
      confirmText: 'ลบ',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await db.transaction('rw', db.staff, async () => {
        const fresh = alive(await db.staff.toArray())
        if (wouldRemoveLastOwner(fresh, person.id, { deleted: 1 })) throw new LastOwnerError()
        await remove(db.staff, person.id)
      })
      toast('ลบแล้ว', 'success')
      onClose()
    } catch (e) {
      if (e instanceof LastOwnerError) toast('ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คน', 'error')
      else {
        console.error('delete staff failed', e)
        toast('ลบไม่สำเร็จ ลองอีกครั้ง', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  const ownerCount = activeOwners(all).length
  const activeLocked = isMe || (soleOwner && active)

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={person ? `แก้ไข ${person.name}` : 'เพิ่มคน'}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            ปิด
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="ชื่อ (ชื่อเล่นก็ได้)" error={showErrors && errors.name}>
          <input className="input" value={name} maxLength={30} autoFocus={!person} placeholder="เช่น น้องบี" onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field
          label="หน้าที่"
          hint={
            soleOwner
              ? 'เจ้าของคนเดียวของร้าน เปลี่ยนเป็นคนขายไม่ได้'
              : role === 'owner'
                ? 'ดูรายงาน ตั้งค่า และอนุมัติยกเลิกบิลได้'
                : 'ขาย ดูบิล เปิดร้าน ปิดยอด'
          }
        >
          <Segmented
            aria-label="หน้าที่"
            block
            options={[
              { value: 'staff', label: 'คนขาย', disabled: soleOwner },
              { value: 'owner', label: 'เจ้าของ' },
            ]}
            value={role}
            onChange={(v) => setRole(v as Role)}
          />
        </Field>

        <Field label="แผงประจำ" hint="ชื่อจะขึ้นก่อนในหน้าเข้าสู่ระบบของเครื่องแผงนี้">
          <select className="select" value={boothId} onChange={(e) => setBoothId(e.target.value)}>
            <option value="">ทุกแผง</option>
            {boothOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.active !== 1 ? ' (ปิดใช้งาน)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="settings-subtle-box stack-sm">
          <div className="row-between">
            <strong className="row nowrap" style={{ gap: 6 }}>
              <KeyRound size={18} aria-hidden="true" /> PIN
            </strong>
            {person && !changingPin && (
              <span className="row nowrap" style={{ gap: 4 }}>
                <span className="num settings-code" aria-live="polite">
                  {showPin ? person.pin : '•'.repeat(person.pin.length)}
                </span>
                <Button variant="ghost" icon={showPin ? <EyeOff size={20} /> : <Eye size={20} />} onClick={() => setShowPin((v) => !v)} aria-label={showPin ? 'ซ่อน PIN' : 'ดู PIN'} />
              </span>
            )}
          </div>
          {changingPin ? (
            newPin ? (
              <div className="settings-pin-done">
                <span>{person ? 'PIN ใหม่พร้อมบันทึก' : 'ตั้ง PIN แล้ว'}</span>
                <Button variant="ghost" onClick={() => setNewPin(null)}>
                  ตั้งใหม่
                </Button>
              </div>
            ) : (
              <>
                <PinSetter allowSix initialLength={person?.pin.length === 6 ? 6 : 4} onDone={setNewPin} warn={(p) => conflictText(p, role)} />
                {showErrors && errors.pin && <p className="settings-note tone-danger">{errors.pin}</p>}
                {person && (
                  <Button variant="ghost" onClick={() => setChangingPin(false)}>
                    ไม่เปลี่ยน PIN
                  </Button>
                )}
              </>
            )
          ) : (
            <Button icon={<KeyRound size={20} />} onClick={() => setChangingPin(true)}>
              เปลี่ยน PIN
            </Button>
          )}
          {newPin && conflictText(newPin, role) && <p className="settings-note tone-warning">{conflictText(newPin, role)}</p>}
        </div>

        <Toggle
          checked={active}
          onChange={setActive}
          disabled={activeLocked}
          label="ใช้งานอยู่"
          hint={
            isMe
              ? 'ปิดการใช้งานของตัวเองไม่ได้'
              : soleOwner
                ? 'เจ้าของคนเดียวของร้าน ปิดการใช้งานไม่ได้'
                : 'ปิดแล้วชื่อจะไม่แสดงในหน้าเข้าสู่ระบบ ประวัติยังอยู่'
          }
        />

        {person && (
          <div className="settings-danger-zone">
            <Button
              variant="ghost"
              className="settings-btn-danger"
              icon={<Trash2 size={20} />}
              onClick={() => void del()}
              disabled={busy || isMe || (person.role === 'owner' && person.active === 1 && ownerCount <= 1)}
            >
              ลบคนนี้
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
