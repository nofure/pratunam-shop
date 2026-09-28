// Booths (แผง): add / edit / reorder / deactivate / delete.
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDown, ArrowUp, Plus, Store, Trash2 } from 'lucide-react'
import { alive, db, patch, remove, save } from '../../db'
import { getDevice, setDevice, useDevice } from '../../device'
import { useBooths } from '../../hooks'
import { baht } from '../../lib/format'
import type { Booth, ID } from '../../types'
import { Badge, Button, EmptyState, Field, IconButton, Modal, MoneyInput, PageHeader, Toggle, cx, useConfirm, useToast } from '../../ui'
import { moveItem, nextSort, resequence } from './logic'
import { Loading } from './parts'

async function hasOpenShift(boothId: ID): Promise<boolean> {
  return alive(await db.shifts.where('[boothId+status]').equals([boothId, 'open']).toArray()).length > 0
}

async function salesCount(boothId: ID): Promise<number> {
  return db.sales.where('boothId').equals(boothId).filter((s) => s.deleted !== 1).count()
}

export default function BoothSettings() {
  const booths = useBooths(true)
  const { boothId: deviceBooth } = useDevice()
  const tierCounts = useLiveQuery(async () => {
    const m = new Map<ID, number>()
    for (const t of alive(await db.tiers.toArray())) if (t.active === 1) m.set(t.boothId, (m.get(t.boothId) ?? 0) + 1)
    return m
  }, [])
  const toast = useToast()
  const [editing, setEditing] = useState<Booth | 'new' | null>(null)
  const [moving, setMoving] = useState(false)

  const move = async (list: Booth[], index: number, delta: number) => {
    const ordered = moveItem(list, index, delta)
    if (ordered === list || moving) return
    setMoving(true)
    try {
      const changes = resequence(ordered)
      await db.transaction('rw', db.booths, async () => {
        for (const c of changes) await patch(db.booths, c.id, { sort: c.sort })
      })
    } catch (e) {
      console.error('reorder booths failed', e)
      toast('จัดลำดับไม่สำเร็จ', 'error')
    } finally {
      setMoving(false)
    }
  }

  return (
    <div className="page settings-page">
      <PageHeader
        title="แผง"
        back="/settings"
        actions={
          <Button variant="primary" icon={<Plus size={20} />} onClick={() => setEditing('new')}>
            เพิ่มแผง
          </Button>
        }
      />
      {booths === undefined ? (
        <Loading />
      ) : booths.length === 0 ? (
        <EmptyState
          title="ยังไม่มีแผง"
          hint="เพิ่มแผงก่อน แล้วค่อยเพิ่มปุ่มราคาของแผงนั้น"
          action={
            <Button variant="primary" icon={<Plus size={20} />} onClick={() => setEditing('new')}>
              เพิ่มแผง
            </Button>
          }
        />
      ) : (
        <>
          <div className="list">
            {booths.map((b, i) => (
              <div key={b.id} className={cx('settings-row', b.active !== 1 && 'is-off')}>
                <button type="button" className="settings-row-main" onClick={() => setEditing(b)}>
                  <span className="list-icon">
                    <Store size={22} />
                  </span>
                  <span className="settings-row-text">
                    <span className="settings-row-title">
                      {b.name}
                      {b.id === deviceBooth && <Badge tone="success">เครื่องนี้</Badge>}
                      {b.active !== 1 && <Badge>ปิดใช้งาน</Badge>}
                    </span>
                    <span className="settings-row-sub num">
                      เงินทอน ฿{baht(b.openingFloat)} · {tierCounts?.get(b.id) ?? 0} ปุ่มราคา
                    </span>
                  </span>
                </button>
                <span className="settings-row-actions">
                  <IconButton label={`เลื่อน ${b.name} ขึ้น`} icon={<ArrowUp size={20} />} disabled={i === 0 || moving} onClick={() => void move(booths, i, -1)} />
                  <IconButton
                    label={`เลื่อน ${b.name} ลง`}
                    icon={<ArrowDown size={20} />}
                    disabled={i === booths.length - 1 || moving}
                    onClick={() => void move(booths, i, 1)}
                  />
                </span>
              </div>
            ))}
          </div>
          <p className="settings-note" style={{ marginTop: 12 }}>
            ลำดับนี้ใช้ในหน้าเลือกแผงและรายงาน แตะชื่อแผงเพื่อแก้ไข
          </p>
        </>
      )}
      {editing && booths && (
        <BoothEditor
          key={editing === 'new' ? 'new' : editing.id}
          booth={editing === 'new' ? null : editing}
          all={booths}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function BoothEditor({ booth, all, onClose }: { booth: Booth | null; all: Booth[]; onClose: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [name, setName] = useState(booth?.name ?? '')
  const [float, setFloat] = useState<number | null>(booth?.openingFloat ?? all.find((b) => b.active === 1)?.openingFloat ?? 1000)
  const [active, setActive] = useState(booth ? booth.active === 1 : true)
  const [busy, setBusy] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const others = all.filter((b) => b.id !== booth?.id)
  const errors = {
    name: !name.trim() ? 'ใส่ชื่อแผง' : others.some((b) => b.name.trim() === name.trim()) ? 'มีแผงชื่อนี้แล้ว' : '',
    float: float == null ? 'ใส่เงินทอนตั้งต้น (ใส่ 0 ได้)' : '',
  }
  const lastActive = booth?.active === 1 && others.every((b) => b.active !== 1)

  const submit = async () => {
    if (errors.name || errors.float) {
      setShowErrors(true)
      return
    }
    setBusy(true)
    try {
      if (booth) {
        if (booth.active === 1 && !active) {
          if (lastActive) {
            toast('ต้องมีแผงที่ใช้งานอย่างน้อย 1 แผง', 'error')
            return
          }
          if (await hasOpenShift(booth.id)) {
            toast('แผงนี้ยังเปิดร้านอยู่ ปิดยอดก่อนแล้วค่อยปิดใช้งาน', 'error')
            return
          }
        }
        await patch(db.booths, booth.id, { name: name.trim(), openingFloat: float ?? 0, active: active ? 1 : 0 })
        if (!active && getDevice().boothId === booth.id) setDevice({ boothId: null })
      } else {
        await save<Booth>(db.booths, { name: name.trim(), openingFloat: float ?? 0, sort: nextSort(all), active: active ? 1 : 0 })
      }
      toast('บันทึกแล้ว', 'success')
      onClose()
    } catch (e) {
      console.error('save booth failed', e)
      toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error')
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!booth) return
    if (lastActive) {
      toast('ต้องมีแผงที่ใช้งานอย่างน้อย 1 แผง', 'error')
      return
    }
    setBusy(true)
    try {
      if (await hasOpenShift(booth.id)) {
        toast('แผงนี้ยังเปิดร้านอยู่ ปิดยอดก่อน', 'error')
        return
      }
      const count = await salesCount(booth.id)
      if (count > 0 && booth.active === 1) {
        const off = await confirm({
          title: 'แผงนี้มีประวัติการขาย',
          message: `มี ${count.toLocaleString('en-US')} บิล แนะนำให้ปิดใช้งานแทนการลบ แผงจะหายจากหน้าขาย แต่รายงานเดิมยังครบ`,
          confirmText: 'ปิดใช้งาน',
        })
        if (off) {
          await patch(db.booths, booth.id, { active: 0 })
          if (getDevice().boothId === booth.id) setDevice({ boothId: null })
          toast('ปิดใช้งานแล้ว', 'success')
          onClose()
        }
        return
      }
      const ok = await confirm({
        title: `ลบ ${booth.name}`,
        message:
          count > 0
            ? `แผงนี้มี ${count.toLocaleString('en-US')} บิล ลบแล้วรายงานเก่าจะไม่มีชื่อแผงนี้ ปุ่มราคาของแผงจะถูกลบด้วย`
            : 'ปุ่มราคาของแผงนี้จะถูกลบด้วย',
        confirmText: 'ลบแผง',
        danger: true,
      })
      if (!ok) return
      await db.transaction('rw', [db.booths, db.tiers, db.staff], async () => {
        const tiers = alive(await db.tiers.where('boothId').equals(booth.id).toArray())
        for (const t of tiers) await remove(db.tiers, t.id)
        const staff = alive(await db.staff.toArray()).filter((s) => s.boothId === booth.id)
        for (const s of staff) await patch(db.staff, s.id, { boothId: null })
        await remove(db.booths, booth.id)
      })
      if (getDevice().boothId === booth.id) setDevice({ boothId: null })
      toast('ลบแล้ว', 'success')
      onClose()
    } catch (e) {
      console.error('delete booth failed', e)
      toast('ลบไม่สำเร็จ ลองอีกครั้ง', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={booth ? 'แก้ไขแผง' : 'เพิ่มแผง'}
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
        <Field label="ชื่อแผง" error={showErrors && errors.name}>
          <input className="input" value={name} maxLength={40} autoFocus={!booth} placeholder="เช่น แผงเสื้อยืด" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="เงินทอนตั้งต้น" hint="เงินที่ใส่ลิ้นชักตอนเปิดร้าน (แก้ได้ตอนเปิดร้านแต่ละวัน)" error={showErrors && errors.float}>
          <MoneyInput value={float} onChange={setFloat} size="md" />
        </Field>
        <Toggle
          checked={active}
          onChange={setActive}
          label="ใช้งานอยู่"
          hint={lastActive ? 'ต้องมีแผงที่ใช้งานอย่างน้อย 1 แผง' : 'ปิดแล้วแผงจะไม่แสดงในหน้าเลือกแผง ประวัติยังอยู่'}
          disabled={lastActive && active}
        />
        {booth && (
          <div className="settings-danger-zone">
            <Button variant="ghost" className="settings-btn-danger" icon={<Trash2 size={20} />} onClick={() => void del()} disabled={busy}>
              ลบแผงนี้
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
