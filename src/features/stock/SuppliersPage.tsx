import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { MapPin, Phone, Plus, Search, Trash2 } from 'lucide-react'
import { alive, db, remove, save } from '../../db'
import type { ID, Supplier } from '../../types'
import { bahtSign, num, thaiDate } from '../../lib/format'
import { Button, EmptyState, Field, Modal, Money, Stat, useConfirm, useToast } from '../../ui'
import { Loading } from './common'
import { useSupplierRows } from './data'
import { supplierStats, type SupplierStat } from './logic'

interface Draft {
  id: ID | null
  name: string
  phone: string
  location: string
  note: string
}

const EMPTY: Draft = { id: null, name: '', phone: '', location: '', note: '' }

export default function SuppliersPage() {
  const rows = useSupplierRows()
  const lots = useLiveQuery(async () => alive(await db.lots.toArray()), [])
  const [editing, setEditing] = useState<Draft | null>(null)
  const [q, setQ] = useState('')

  const stats = useMemo(() => (lots ? supplierStats(lots) : new Map<ID, SupplierStat>()), [lots])
  const suppliers = useMemo(() => {
    const list = alive(rows ?? [])
    // Recently used first, then the rest by name.
    return list.sort((a, b) => {
      const la = stats.get(a.id)?.last ?? ''
      const lb = stats.get(b.id)?.last ?? ''
      return la < lb ? 1 : la > lb ? -1 : a.name.localeCompare(b.name, 'th')
    })
  }, [rows, stats])

  if (rows === undefined || lots === undefined) return <Loading />

  const needle = q.trim().toLowerCase()
  const shown = needle
    ? suppliers.filter((s) => [s.name, s.location ?? '', s.phone ?? '', s.note ?? ''].some((v) => v.toLowerCase().includes(needle)))
    : suppliers
  const total = suppliers.reduce((a, s) => a + (stats.get(s.id)?.total ?? 0), 0)
  const noSupplierTotal = lots.filter((l) => !l.supplierId).reduce((a, l) => a + l.totalCost, 0)

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted stock-lead">ร้านที่ไปซื้อของมาขาย ใช้เลือกตอนรับของเข้า</p>
        <Button variant="primary" icon={<Plus size={20} />} onClick={() => setEditing({ ...EMPTY })}>
          เพิ่มร้าน
        </Button>
      </div>

      {suppliers.length === 0 ? (
        <EmptyState
          title="ยังไม่มีร้านที่ซื้อ"
          hint="เพิ่มร้านไว้ จะรู้ว่าซื้อจากร้านไหนไปเท่าไร และติดต่อได้เร็ว"
          action={
            <Button variant="primary" icon={<Plus size={20} />} onClick={() => setEditing({ ...EMPTY })}>
              เพิ่มร้าน
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid-2">
            <Stat label="ซื้อของรวม (ทุกร้าน)" value={<Money value={total} />} sub={`${suppliers.length} ร้าน`} />
            <Stat label="ไม่ได้ระบุร้าน" value={<Money value={noSupplierTotal} />} sub="จากการรับของเข้า" />
          </div>
          {suppliers.length > 6 && (
            <label className="stock-search">
              <Search size={20} aria-hidden="true" />
              <input
                className="input"
                type="search"
                placeholder="ค้นหาร้าน ที่อยู่ เบอร์โทร"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="ค้นหาร้าน"
              />
            </label>
          )}
          {shown.length === 0 ? (
            <EmptyState compact title={`ไม่พบ “${q.trim()}”`} />
          ) : (
            <div className="list">
              {shown.map((s) => (
                <SupplierRow
                  key={s.id}
                  s={s}
                  stat={stats.get(s.id)}
                  onEdit={() =>
                    setEditing({ id: s.id, name: s.name, phone: s.phone ?? '', location: s.location ?? '', note: s.note ?? '' })
                  }
                />
              ))}
            </div>
          )}
        </>
      )}

      {editing && (
        <SupplierForm
          draft={editing}
          existing={suppliers}
          stat={editing.id ? stats.get(editing.id) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function SupplierRow({ s, stat, onEdit }: { s: Supplier; stat: SupplierStat | undefined; onEdit: () => void }) {
  const phone = s.phone?.replace(/[^\d+]/g, '') ?? ''
  return (
    <div className="list-row stock-supplier-row">
      <button type="button" className="stock-supplier-main" onClick={onEdit}>
        <span className="list-title">{s.name}</span>
        {s.location && (
          <span className="list-sub stock-icon-line">
            <MapPin size={14} aria-hidden="true" />
            {s.location}
          </span>
        )}
        <span className="list-sub num">
          {stat
            ? `ซื้อรวม ${bahtSign(stat.total)} · ${num(stat.count)} ครั้ง · ล่าสุด ${stat.last ? thaiDate(stat.last) : '–'}`
            : 'ยังไม่เคยรับของจากร้านนี้'}
        </span>
        {s.note && <span className="list-sub stock-note">{s.note}</span>}
      </button>
      {phone && (
        <a className="ibtn ibtn-secondary" href={`tel:${phone}`} aria-label={`โทรหา ${s.name}`} title={`โทร ${s.phone}`}>
          <Phone size={20} />
        </a>
      )}
    </div>
  )
}

function SupplierForm({
  draft,
  existing,
  stat,
  onClose,
}: {
  draft: Draft
  existing: Supplier[]
  stat: SupplierStat | undefined
  onClose: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [d, setD] = useState<Draft>(draft)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)

  const name = d.name.trim()
  const dup = existing.find((s) => s.id !== d.id && s.name.trim().toLowerCase() === name.toLowerCase())
  const nameError = !name ? 'ใส่ชื่อร้าน' : dup ? 'มีร้านชื่อนี้อยู่แล้ว' : null
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((p) => ({ ...p, [k]: e.target.value }))

  const submit = async () => {
    setTried(true)
    if (nameError) return
    setSaving(true)
    try {
      const fields = {
        name,
        phone: d.phone.trim() || null,
        location: d.location.trim() || null,
        note: d.note.trim() || null,
      }
      if (d.id) {
        const cur = await db.suppliers.get(d.id)
        if (!cur || cur.deleted === 1) {
          toast('ไม่พบร้านนี้แล้ว อาจถูกลบจากเครื่องอื่น', 'error')
          onClose()
          return
        }
        await save<Supplier>(db.suppliers, { ...cur, ...fields })
      } else {
        await save<Supplier>(db.suppliers, fields)
      }
      toast('บันทึกแล้ว', 'success')
      onClose()
    } catch (e) {
      console.error(e)
      toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error')
    } finally {
      setSaving(false)
    }
  }

  const del = async () => {
    if (!d.id) return
    const ok = await confirm({
      title: `ลบร้าน “${draft.name}”`,
      message: stat
        ? `ประวัติรับของเข้า ${num(stat.count)} ครั้งยังอยู่ครบ และยังเห็นชื่อร้านในประวัติ`
        : 'ร้านนี้ยังไม่เคยใช้ตอนรับของเข้า',
      confirmText: 'ลบ',
      danger: true,
    })
    if (!ok) return
    try {
      await remove(db.suppliers, d.id)
      toast('ลบแล้ว', 'success')
      onClose()
    } catch (e) {
      console.error(e)
      toast('ลบไม่สำเร็จ ลองอีกครั้ง', 'error')
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={d.id ? 'แก้ไขร้าน' : 'เพิ่มร้าน'}
      footer={
        <>
          {d.id && (
            <Button variant="ghost" size="lg" icon={<Trash2 size={20} />} onClick={() => void del()} className="tone-danger">
              ลบ
            </Button>
          )}
          <Button variant="primary" size="lg" loading={saving} onClick={() => void submit()}>
            บันทึก
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="ชื่อร้าน" required error={tried ? nameError : null}>
          <input className="input" value={d.name} onChange={set('name')} maxLength={60} autoFocus={!d.id} />
        </Field>
        <Field label="เบอร์โทร">
          <input className="input" type="tel" inputMode="tel" value={d.phone} onChange={set('phone')} maxLength={20} />
        </Field>
        <Field label="อยู่ที่ไหน" hint="เช่น โบ๊เบ๊ ตึก 3 ชั้น 2">
          <input className="input" value={d.location} onChange={set('location')} maxLength={80} />
        </Field>
        <Field label="หมายเหตุ" hint="เช่น ส่งของวันอังคาร ขั้นต่ำ 5 โหล">
          <textarea className="textarea" value={d.note} onChange={set('note')} maxLength={200} rows={3} />
        </Field>
        {stat && (
          <p className="muted num">
            ซื้อรวม {bahtSign(stat.total)} · {num(stat.qty)} ชิ้น · {num(stat.count)} ครั้ง · ล่าสุด {stat.last ? thaiDate(stat.last) : '–'}
          </p>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}
