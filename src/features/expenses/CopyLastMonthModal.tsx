// "คัดลอกจากเดือนก่อน": duplicate last month's rent / electric / wage entries in one tap.
import { useRef, useState } from 'react'
import type { DayKey, Expense, ID } from '../../types'
import { db, saveMany } from '../../db'
import { bahtSign, thaiDateShort, thaiMonth } from '../../lib/format'
import { Badge, Button, Modal, Money, useToast } from '../../ui'
import { sumAmount, type CopyCandidate } from './logic'
import { categoryLabel } from './parts'

export interface CopyLastMonthModalProps {
  candidates: CopyCandidate[]
  fromMonth: DayKey
  toMonth: DayKey
  /** Booth name when the page is filtered to one booth. */
  scope: string | null
  boothName: (id: ID | null) => string
  /** Booths that still exist; entries of removed booths start unticked. */
  boothExists: (id: ID | null) => boolean
  staffId: ID | null
  onClose: () => void
  onDone: (copied: Expense[]) => void
}

export default function CopyLastMonthModal({
  candidates,
  fromMonth,
  toMonth,
  scope,
  boothName,
  boothExists,
  staffId,
  onClose,
  onDone,
}: CopyLastMonthModalProps) {
  const toast = useToast()
  const [picked, setPicked] = useState<Set<ID>>(
    () => new Set(candidates.filter((c) => !c.exists && boothExists(c.source.boothId)).map((c) => c.source.id)),
  )
  const [busy, setBusyState] = useState(false)
  const busyRef = useRef(false)
  const setBusy = (b: boolean) => {
    busyRef.current = b
    setBusyState(b)
  }

  // Candidates can change underneath (sync); only count ticks that are still listed.
  const chosen = candidates.filter((c) => picked.has(c.source.id))
  const total = sumAmount(chosen.map((c) => c.source))
  const allPicked = candidates.length > 0 && chosen.length === candidates.length

  const toggle = (id: ID) =>
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const copy = async () => {
    if (busyRef.current || chosen.length === 0) return
    setBusy(true)
    try {
      const recs: Omit<Expense, 'id' | 'createdAt' | 'updatedAt' | 'deviceId' | 'deleted' | 'synced'>[] = chosen.map((c) => ({
        boothId: c.source.boothId,
        dayKey: c.targetDay,
        category: c.source.category,
        amount: c.source.amount,
        note: c.source.note,
        staffId,
      }))
      const saved = await db.transaction('rw', db.expenses, () => saveMany(db.expenses, recs))
      onDone(saved)
    } catch (err) {
      console.error('expenses: copy failed', err)
      toast('คัดลอกไม่สำเร็จ ลองอีกครั้ง', 'error')
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="คัดลอกจากเดือนก่อน"
      footer={
        <Button variant="primary" size="lg" block loading={busy} disabled={chosen.length === 0} onClick={() => void copy()}>
          {chosen.length === 0 ? 'เลือกรายการที่จะคัดลอก' : `คัดลอก ${chosen.length} รายการ · ${bahtSign(total)}`}
        </Button>
      }
    >
      <div className="stack">
        <p className="exp-copy-intro">
          {`ค่าเช่า ค่าไฟ ค่าจ้าง${scope ? `ของ${scope}` : ''} เดือน${thaiMonth(fromMonth)} ใส่ลงเดือน${thaiMonth(toMonth)} `}
          {'วันที่เดียวกัน ถ้ายอดเปลี่ยน แตะที่รายการเพื่อแก้ทีหลัง'}
        </p>
        {candidates.length > 1 && (
          <div className="row-between">
            <span className="muted">
              เลือกแล้ว {chosen.length} จาก {candidates.length}
            </span>
            <Button
              variant="ghost"
              onClick={() => setPicked(allPicked ? new Set() : new Set(candidates.map((c) => c.source.id)))}
            >
              {allPicked ? 'ไม่เลือกเลย' : 'เลือกทั้งหมด'}
            </Button>
          </div>
        )}
        {candidates.length === 0 && <p className="muted">เดือนก่อนไม่มีค่าเช่า ค่าไฟ หรือค่าจ้างให้คัดลอก</p>}
        <ul className="list exp-copy-list" hidden={candidates.length === 0}>
          {candidates.map((c) => {
            const id = c.source.id
            const checked = picked.has(id)
            const booth = boothName(c.source.boothId)
            return (
              <li key={id}>
                <label className={'exp-copy-row' + (checked ? ' checked' : '')}>
                  <input type="checkbox" className="exp-check" checked={checked} onChange={() => toggle(id)} />
                  <span className="list-main">
                    <span className="list-title">
                      {categoryLabel(c.source.category)}
                      {c.exists && (
                        <Badge tone="info" className="exp-copy-badge">
                          มีในเดือนนี้แล้ว
                        </Badge>
                      )}
                    </span>
                    <span className="list-sub">
                      {booth}
                      {c.source.note ? ` · ${c.source.note}` : ''}
                    </span>
                    <span className="list-sub num">
                      {thaiDateShort(c.source.dayKey)} → {thaiDateShort(c.targetDay)}
                    </span>
                  </span>
                  <Money value={c.source.amount} className="exp-amount" />
                </label>
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}
