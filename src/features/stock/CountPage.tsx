import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Eraser } from 'lucide-react'
import { db, saveMany } from '../../db'
import { useSession } from '../../session'
import type { Adjustment, ID } from '../../types'
import { todayKey } from '../../lib/dates'
import { num, round2, signed, thaiDate } from '../../lib/format'
import { Button, EmptyState, Modal, Money, MoneyInput, cx, useConfirm, useToast } from '../../ui'
import { BoothBar, Callout, Loading, NoBooth, NoTiers, TierTag, TierTitle } from './common'
import { useBoothStock, useStockBooth, type BoothStock } from './data'
import { countChanges, parseCountDraft, qtyText } from './logic'

export default function CountPage() {
  const { boothId } = useStockBooth()
  const raw = useBoothStock(boothId)
  const data = raw && raw.boothId !== boothId ? undefined : raw

  if (!boothId) return <NoBooth />
  return (
    <div className="stack">
      <BoothBar />
      {data === undefined ? (
        <Loading />
      ) : data === null ? (
        <NoBooth />
      ) : data.tiers.length === 0 ? (
        <NoTiers />
      ) : (
        <CountForm key={data.boothId} data={data} />
      )}
    </div>
  )
}

// A half-done count survives leaving the page or the phone locking (per device, per booth).
const draftKey = (boothId: ID) => `pratunam.stock.countDraft.v1.${boothId}`

function loadDraft(boothId: ID): Record<ID, number> {
  try {
    return parseCountDraft(localStorage.getItem(draftKey(boothId)))
  } catch {
    return {}
  }
}

function storeDraft(boothId: ID, counts: Record<ID, number>): void {
  try {
    if (Object.keys(counts).length === 0) localStorage.removeItem(draftKey(boothId))
    else localStorage.setItem(draftKey(boothId), JSON.stringify(counts))
  } catch {
    /* storage unavailable — the count still works, it just isn't kept */
  }
}

function DiffText({ diff }: { diff: number }) {
  if (diff === 0) return <span className="stock-count-diff tone-success">ตรง</span>
  return (
    <span className={cx('stock-count-diff num', diff > 0 ? 'tone-info' : 'tone-danger')}>
      {diff > 0 ? 'เกิน' : 'ขาด'} {qtyText(Math.abs(diff))}
    </span>
  )
}

function CountForm({ data }: { data: BoothStock }) {
  const { staff, isOwner } = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const [counts, setCounts] = useState<Record<ID, number>>(() => loadDraft(data.boothId))
  const [restored] = useState(() => Object.keys(counts).length)
  const [reviewing, setReviewing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => storeDraft(data.boothId, counts), [data.boothId, counts])

  const rows = useMemo(
    () => data.tiers.filter((t) => t.trackStock === 1 && (t.active === 1 || (data.stock.get(t.id)?.onHand ?? 0) !== 0)),
    [data],
  )
  const tierById = useMemo(() => new Map(rows.map((t) => [t.id, t])), [rows])
  const ids = useMemo(() => rows.map((t) => t.id), [rows])
  const changes = useMemo(() => countChanges(ids, data.stock, counts), [ids, data.stock, counts])
  const entered = ids.filter((id) => counts[id] != null).length
  const matched = entered - changes.length
  const lastCount = useMemo(() => {
    let last: string | null = null
    for (const a of data.adjustments) if (a.reason === 'count' && (last == null || a.dayKey > last)) last = a.dayKey
    return last
  }, [data.adjustments])

  const setCount = (id: ID, n: number | null) =>
    setCounts((prev) => {
      const next = { ...prev }
      if (n == null) delete next[id]
      else next[id] = n
      return next
    })

  const clearAll = async () => {
    const ok = await confirm({ title: 'ล้างตัวเลขที่นับไว้', message: 'ตัวเลขที่กรอกไว้ทั้งหมดจะหายไป ยอดในระบบไม่เปลี่ยน', confirmText: 'ล้าง', danger: true })
    if (ok) setCounts({})
  }

  const openReview = () => {
    if (changes.length === 0) {
      toast(entered > 0 ? 'ที่นับได้ตรงกับระบบทุกรายการ ไม่ต้องบันทึก' : 'ยังไม่ได้กรอกจำนวนที่นับได้', 'info')
      return
    }
    setReviewing(true)
  }

  const doSave = async () => {
    // Use the numbers on screen right now (they update live if a sale just happened).
    const rowsNow = countChanges(ids, data.stock, counts)
    if (rowsNow.length === 0) {
      setReviewing(false)
      toast('ไม่มีรายการที่ต่างจากระบบ', 'info')
      return
    }
    const dayKey = todayKey()
    setSaving(true)
    try {
      await db.transaction('rw', db.adjustments, async () => {
        await saveMany<Adjustment>(
          db.adjustments,
          rowsNow.map((c) => ({
            boothId: tierById.get(c.tierId)?.boothId ?? data.boothId,
            tierId: c.tierId,
            dayKey,
            qtyChange: c.diff,
            reason: 'count' as const,
            countedQty: c.counted,
            linkId: null,
            note: null,
            staffId: staff?.id ?? null,
          })),
        )
      })
      setCounts({})
      setReviewing(false)
      toast(`บันทึกการนับแล้ว ${rowsNow.length} รายการ`, 'success')
    } catch (e) {
      console.error(e)
      toast('บันทึกไม่สำเร็จ ตัวเลขที่นับยังอยู่ ลองอีกครั้ง', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (rows.length === 0)
    return <EmptyState title="แผงนี้ไม่มีปุ่มที่นับสต็อก" hint="เปิด “นับสต็อก” ของปุ่มราคาได้ที่ ตั้งค่า → ปุ่มราคา" />

  const over = changes.filter((c) => c.diff > 0).reduce((a, c) => a + c.diff, 0)
  const short = changes.filter((c) => c.diff < 0).reduce((a, c) => a + c.diff, 0)
  const valueDiff = changes.reduce((a, c) => a + c.diff * (data.stock.get(c.tierId)?.avgCost ?? 0), 0)

  return (
    <>
      <Callout tone="warning">
        <p className="stock-callout-title">นับตอนร้านปิดหรือช่วงไม่มีลูกค้า</p>
        <p className="muted">ถ้าขายระหว่างนับ ยอดจะคลาดเคลื่อน · กรอกเฉพาะปุ่มที่นับแล้ว ปุ่มที่เว้นว่างไว้จะไม่ถูกเปลี่ยน</p>
      </Callout>
      {restored > 0 && entered > 0 && <p className="muted">มีตัวเลขที่นับค้างไว้ {restored} รายการ นับต่อได้เลย</p>}
      {lastCount && <p className="muted">นับครั้งล่าสุด {thaiDate(lastCount)}</p>}

      <div className="list stock-list">
        {rows.map((t) => {
          const s = data.stock.get(t.id)
          const onHand = s?.onHand ?? 0
          const hasData = !!s && (s.received !== 0 || s.adjusted !== 0 || s.onHand !== 0)
          const counted = counts[t.id] ?? null
          return (
            <div key={t.id} className={cx('list-row stock-count-row', counted != null && 'is-entered')}>
              <TierTag tier={t} size="sm" />
              <div className="list-main">
                <TierTitle tier={t} />
                <span className="list-sub num">
                  ในระบบ {hasData ? `${qtyText(onHand)} ${t.unit}` : 'ยังไม่มียอด'}
                </span>
              </div>
              <div className="stock-count-input">
                <MoneyInput
                  value={counted}
                  onChange={(n) => setCount(t.id, n)}
                  prefix={false}
                  maxDigits={6}
                  placeholder="นับได้"
                  aria-label={`นับได้ ${t.name} ${t.price} บาท (${t.unit})`}
                />
                {counted != null && <DiffText diff={round2(counted - onHand)} />}
              </div>
            </div>
          )
        })}
      </div>

      <div className="stock-actionbar">
        <div className="stock-actionbar-text">
          กรอกแล้ว <strong className="num">{entered}</strong> · ต่างจากระบบ <strong className="num">{changes.length}</strong>
        </div>
        <div className="row nowrap">
          {entered > 0 && (
            <Button variant="ghost" icon={<Eraser size={20} />} onClick={() => void clearAll()}>
              ล้าง
            </Button>
          )}
          <Button variant="primary" size="lg" icon={<ClipboardCheck size={22} />} onClick={openReview} disabled={entered === 0}>
            ตรวจก่อนบันทึก
          </Button>
        </div>
      </div>

      <Modal
        open={reviewing}
        onClose={() => !saving && setReviewing(false)}
        title="ตรวจก่อนบันทึก"
        size="lg"
        closeOnBackdrop={false}
        footer={
          <>
            <Button size="lg" onClick={() => setReviewing(false)} disabled={saving}>
              กลับไปแก้
            </Button>
            <Button variant="primary" size="lg" loading={saving} onClick={() => void doSave()}>
              บันทึก {changes.length} รายการ
            </Button>
          </>
        }
      >
        <div className="stack">
          <p className="text-2">ยอดในระบบจะถูกปรับให้เท่ากับที่นับได้</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>ปุ่มราคา</th>
                  <th className="num">ในระบบ</th>
                  <th className="num">นับได้</th>
                  <th className="num">ต่าง</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => {
                  const t = tierById.get(c.tierId)
                  return (
                    <tr key={c.tierId}>
                      <td>
                        {t?.name} <span className="num muted">{t ? t.price : ''}</span>
                      </td>
                      <td className="num">{qtyText(c.onHand)}</td>
                      <td className="num">{num(c.counted, 2)}</td>
                      <td className={cx('num', c.diff > 0 ? 'tone-info' : 'tone-danger')}>
                        <strong>{signed(c.diff)}</strong>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="stock-review-sum">
            {over > 0 && (
              <span>
                เกิน <strong className="num tone-info">{signed(over)}</strong> ชิ้น
              </span>
            )}
            {short < 0 && (
              <span>
                ขาด <strong className="num tone-danger">{signed(short)}</strong> ชิ้น
              </span>
            )}
            {isOwner && valueDiff !== 0 && (
              <span>
                คิดเป็นทุน <Money value={valueDiff} signed tone={valueDiff < 0 ? 'danger' : 'info'} />
              </span>
            )}
          </div>
          {matched > 0 && <p className="muted">ตรงกับระบบ {matched} รายการ ไม่ต้องบันทึก</p>}
        </div>
      </Modal>
    </>
  )
}
