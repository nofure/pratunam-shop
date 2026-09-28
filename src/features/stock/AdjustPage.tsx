import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { SlidersHorizontal, Trash2 } from 'lucide-react'
import { alive, db, newId, remove, save, saveMany } from '../../db'
import { ADJUST_REASON_LABEL } from '../../constants'
import { useStaffList } from '../../hooks'
import { useSession } from '../../session'
import type { AdjustReason, Adjustment, ID, Tier } from '../../types'
import { todayKey } from '../../lib/dates'
import { bahtSign, num, round2, signed, thaiDate } from '../../lib/format'
import { Button, Card, EmptyState, Field, IconButton, MoneyInput, Segmented, cx, useConfirm, useToast } from '../../ui'
import { BoothBar, Callout, Loading, NoBooth, NoTiers, TierPicker, TierTag } from './common'
import { boothNameOf, useBoothStock, useStockBooth, useTierLookup, type BoothStock } from './data'
import { ADJUST_REASONS, isTransferReason, isWholeNumber, qtyText, reasonSign, suggestTargetTier } from './logic'

export default function AdjustPage() {
  const { boothId, setBoothId } = useStockBooth()
  const raw = useBoothStock(boothId)
  const data = raw && raw.boothId !== boothId ? undefined : raw
  const [params, setParams] = useSearchParams()
  const tierLookup = useTierLookup()
  const [preset, setPreset] = useState<ID | null>(null)

  // /stock/adjust?tier=<id> (from the on-hand page): switch to that tier's booth and select it.
  const wanted = params.get('tier')
  useEffect(() => {
    if (!wanted || !tierLookup) return
    const t = tierLookup.get(wanted)
    if (t && t.deleted !== 1) {
      setBoothId(t.boothId)
      setPreset(t.id)
    }
    setParams(
      (p) => {
        p.delete('tier')
        return p
      },
      { replace: true },
    )
  }, [wanted, tierLookup, setBoothId, setParams])

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
        <div className="stock-cols">
          <AdjustForm key={data.boothId} data={data} preset={preset} onPresetUsed={() => setPreset(null)} />
          <RecentAdjustments boothId={data.boothId} tierLookup={tierLookup} />
        </div>
      )}
    </div>
  )
}

function AdjustForm({ data, preset, onPresetUsed }: { data: BoothStock; preset: ID | null; onPresetUsed: () => void }) {
  const { staff } = useSession()
  const { booths, allBooths } = useStockBooth()
  const toast = useToast()
  const confirm = useConfirm()

  const otherBooths = useMemo(() => booths.filter((b) => b.id !== data.boothId), [booths, data.boothId])
  const [reason, setReason] = useState<AdjustReason>('damaged')
  const [direction, setDirection] = useState<1 | -1>(-1)
  const [tierId, setTierId] = useState<ID | null>(null)
  const [qtyInput, setQtyInput] = useState<number | null>(null)
  const [otherBoothId, setOtherBoothId] = useState<ID | null>(() => otherBooths[0]?.id ?? null)
  const [otherTierId, setOtherTierId] = useState<ID>('')
  const [note, setNote] = useState('')
  const [dayKey, setDayKey] = useState(() => todayKey())
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)

  const transfer = isTransferReason(reason)
  const otherRaw = useBoothStock(transfer ? otherBoothId : null)
  const other = otherRaw && otherRaw.boothId === otherBoothId ? otherRaw : null
  const otherTiers = useMemo(() => (other ? other.tiers.filter((t) => t.active === 1) : []), [other])

  const pickable = useMemo(
    () => data.tiers.filter((t) => t.active === 1 || (data.stock.get(t.id)?.onHand ?? 0) !== 0),
    [data.tiers, data.stock],
  )

  useEffect(() => {
    if (preset && pickable.some((t) => t.id === preset)) {
      setTierId(preset)
      onPresetUsed()
    }
  }, [preset, pickable, onPresetUsed])

  // Keep the other booth valid when booths change.
  useEffect(() => {
    if (otherBoothId && otherBooths.some((b) => b.id === otherBoothId)) return
    setOtherBoothId(otherBooths[0]?.id ?? null)
  }, [otherBooths, otherBoothId])

  const tier: Tier | undefined = tierId ? pickable.find((t) => t.id === tierId) : undefined
  const unit = tier?.unit ?? 'ชิ้น'

  // Suggest the same name + price in the other booth whenever the tier or the other booth changes.
  const otherLoadedFor = other?.boothId ?? null
  useEffect(() => {
    if (!transfer || !tier || !otherLoadedFor) return
    setOtherTierId(suggestTargetTier(tier, otherTiers)?.id ?? '')
    // otherTiers is re-created on every live update; only re-suggest when the selection really changes.
  }, [transfer, tier?.id, otherLoadedFor])

  const otherTier = otherTierId ? otherTiers.find((t) => t.id === otherTierId) : undefined
  const suggested = tier && other ? suggestTargetTier(tier, otherTiers) : null

  const today = todayKey()
  const qty = qtyInput != null && qtyInput > 0 ? qtyInput : null
  const sign = reasonSign(reason, direction)
  const tierError = tier ? null : 'เลือกปุ่มราคา'
  const qtyError = qtyInput == null ? 'ใส่จำนวน' : qty == null ? 'จำนวนต้องมากกว่า 0' : !isWholeNumber(qty) ? 'ต้องเป็นจำนวนเต็ม' : null
  const otherBoothError = transfer && !otherBoothId ? 'เลือกแผง' : null
  const otherTierError = transfer && !otherTier ? 'เลือกปุ่มราคาของแผงนั้น' : null
  const dateError = !dayKey ? 'เลือกวันที่' : dayKey > today ? 'วันที่ต้องไม่เกินวันนี้' : null
  const show = (err: string | null) => (tried ? err : null)

  const onHand = tier ? (data.stock.get(tier.id)?.onHand ?? 0) : 0
  const otherOnHand = otherTier ? (other?.stock.get(otherTier.id)?.onHand ?? 0) : 0
  const otherName = boothNameOf(allBooths, otherBoothId)
  const thisName = boothNameOf(allBooths, data.boothId)

  const submit = async () => {
    setTried(true)
    if (!tier || qty == null || tierError || qtyError || otherBoothError || otherTierError || dateError) {
      toast('กรอกให้ครบก่อนบันทึก', 'error')
      return
    }
    // Taking out more than the system has usually means a typo (or stock that was never received).
    const sourceOnHand = transfer ? (reason === 'transfer_out' ? onHand : otherOnHand) : onHand
    const removing = transfer || sign < 0
    if (removing && qty > sourceOnHand) {
      const ok = await confirm({
        title: 'มากกว่าที่มีในระบบ',
        message: `ในระบบมี ${qtyText(sourceOnHand)} ${unit} แต่จะเอาออก ${num(qty)} ${unit}\nยอดคงเหลือจะติดลบ ถ้าของจริงมีมากกว่านี้ ให้นับสต็อกก่อน`,
        confirmText: 'บันทึกต่อ',
        cancelText: 'กลับไปแก้',
      })
      if (!ok) return
    }
    const cleanNote = note.trim() || null
    const staffId = staff?.id ?? null
    setSaving(true)
    try {
      if (transfer && otherTier) {
        const linkId = newId()
        const src = reason === 'transfer_out' ? tier : otherTier
        const dst = reason === 'transfer_out' ? otherTier : tier
        await db.transaction('rw', db.adjustments, async () => {
          await saveMany<Adjustment>(db.adjustments, [
            { boothId: src.boothId, tierId: src.id, dayKey, qtyChange: -qty, reason: 'transfer_out', countedQty: null, linkId, note: cleanNote, staffId },
            { boothId: dst.boothId, tierId: dst.id, dayKey, qtyChange: qty, reason: 'transfer_in', countedQty: null, linkId, note: cleanNote, staffId },
          ])
        })
        toast(`ย้ายแล้ว ${num(qty)} ${unit}`, 'success')
      } else {
        await save<Adjustment>(db.adjustments, {
          boothId: tier.boothId,
          tierId: tier.id,
          dayKey,
          qtyChange: sign * qty,
          reason,
          countedQty: null,
          linkId: null,
          note: cleanNote,
          staffId,
        })
        toast(`บันทึกแล้ว ${signed(sign * qty)} ${unit}`, 'success')
      }
      setTierId(null)
      setQtyInput(null)
      setNote('')
      setTried(false)
    } catch (e) {
      console.error(e)
      toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error')
    } finally {
      setSaving(false)
    }
  }

  const after = tier && qty != null ? round2(onHand + (transfer ? (reason === 'transfer_out' ? -qty : qty) : sign * qty)) : null
  const otherAfter = transfer && otherTier && qty != null ? round2(otherOnHand + (reason === 'transfer_out' ? qty : -qty)) : null

  return (
    <Card title="ปรับสต็อก" className="stock-form">
      <div className="stack">
        <Field label="เหตุผล">
          <div className="stock-chips" role="group" aria-label="เหตุผล">
            {ADJUST_REASONS.map((r) => {
              const disabled = isTransferReason(r) && otherBooths.length === 0
              return (
                <button
                  key={r}
                  type="button"
                  className={cx('chip', r === reason && 'active')}
                  aria-pressed={r === reason}
                  disabled={disabled}
                  onClick={() => setReason(r)}
                >
                  {ADJUST_REASON_LABEL[r]}
                </button>
              )
            })}
          </div>
        </Field>
        {otherBooths.length === 0 && <p className="muted">ย้ายของระหว่างแผงได้เมื่อมีมากกว่าหนึ่งแผง</p>}

        {reason === 'other' && (
          <Segmented
            aria-label="เพิ่มหรือลด"
            block
            options={[
              { value: -1, label: 'ลดสต็อก' },
              { value: 1, label: 'เพิ่มสต็อก' },
            ]}
            value={direction}
            onChange={(v) => setDirection(v === 1 ? 1 : -1)}
          />
        )}

        <Field label={reason === 'transfer_in' ? `ปุ่มราคาที่รับเข้า (${thisName})` : 'ปุ่มราคา'} error={show(tierError)}>
          <TierPicker tiers={pickable} value={tierId} onChange={setTierId} stock={data.stock} invalid={!!show(tierError)} />
        </Field>

        {transfer && (
          <div className="stock-inline-add stack-sm">
            <Field label={reason === 'transfer_out' ? 'ย้ายไปแผง' : 'ย้ายมาจากแผง'} error={show(otherBoothError)}>
              <div className="stock-chips" role="group" aria-label="แผง">
                {otherBooths.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={cx('chip', b.id === otherBoothId && 'active')}
                    aria-pressed={b.id === otherBoothId}
                    onClick={() => setOtherBoothId(b.id)}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </Field>
            <Field
              label={`ปุ่มราคาที่${otherName}`}
              error={show(otherTierError)}
              hint={
                !tier
                  ? 'เลือกปุ่มราคาด้านบนก่อน'
                  : suggested && suggested.id === otherTierId
                    ? 'เลือกให้แล้วจากชื่อและราคาเดียวกัน'
                    : !suggested && other
                      ? 'แผงนั้นไม่มีปุ่มชื่อและราคาเดียวกัน เลือกเอง หรือเพิ่มปุ่มราคาที่ ตั้งค่า'
                      : undefined
              }
            >
              <select className="select" value={otherTierId} onChange={(e) => setOtherTierId(e.target.value)} disabled={!other}>
                <option value="">{other ? 'เลือกปุ่มราคา' : 'กำลังโหลด…'}</option>
                {otherTiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ฿{t.price}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <Field label={`จำนวน (${unit})`} error={show(qtyError)}>
          <MoneyInput value={qtyInput} onChange={setQtyInput} prefix={false} maxDigits={6} placeholder="0" />
        </Field>

        {tier && after != null && (
          <div className="stock-preview" aria-live="polite">
            <div className="stock-preview-row">
              <span>
                {transfer ? `${thisName} · ` : ''}
                {tier.name} {bahtSign(tier.price)}
              </span>
              <span className="num">
                {qtyText(onHand)} → <strong className={cx(after < 0 && 'tone-danger')}>{qtyText(after)}</strong> {unit}
              </span>
            </div>
            {otherTier && otherAfter != null && (
              <div className="stock-preview-row">
                <span>
                  {otherName} · {otherTier.name} {bahtSign(otherTier.price)}
                </span>
                <span className="num">
                  {qtyText(otherOnHand)} → <strong className={cx(otherAfter < 0 && 'tone-danger')}>{qtyText(otherAfter)}</strong> {otherTier.unit}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="grid-2 stock-date-note">
          <Field label="วันที่" error={show(dateError)}>
            <input className="input" type="date" value={dayKey} max={today} onChange={(e) => setDayKey(e.target.value)} />
          </Field>
          <Field label="หมายเหตุ">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="ไม่ใส่ก็ได้" />
          </Field>
        </div>

        <Button variant="primary" size="lg" block icon={<SlidersHorizontal size={22} />} loading={saving} onClick={() => void submit()}>
          {transfer ? 'บันทึกการย้าย' : 'บันทึกการปรับ'}
        </Button>
      </div>
    </Card>
  )
}

const PAGE = 20

function RecentAdjustments({ boothId, tierLookup }: { boothId: ID; tierLookup: Map<ID, Tier> | undefined }) {
  const { allBooths } = useStockBooth()
  const staffList = useStaffList(true)
  const toast = useToast()
  const confirm = useConfirm()
  const [limit, setLimit] = useState(PAGE)
  const all = useLiveQuery(async () => alive(await db.adjustments.toArray()), [])

  const staffById = useMemo(() => new Map((staffList ?? []).map((s) => [s.id, s.name])), [staffList])
  const byLink = useMemo(() => {
    const m = new Map<ID, Adjustment[]>()
    for (const a of all ?? []) if (a.linkId) m.set(a.linkId, [...(m.get(a.linkId) ?? []), a])
    return m
  }, [all])
  const rows = useMemo(
    () => (all ?? []).filter((a) => a.boothId === boothId).sort((a, b) => b.createdAt - a.createdAt),
    [all, boothId],
  )

  const del = async (a: Adjustment) => {
    const linked = a.linkId ? (byLink.get(a.linkId) ?? [a]) : [a]
    const ok = await confirm({
      title: 'ลบรายการปรับสต็อกนี้',
      message:
        linked.length > 1
          ? 'รายการย้ายของจะลบทั้งฝั่งที่ย้ายออกและฝั่งที่ย้ายเข้า ยอดคงเหลือของทั้งสองแผงจะกลับเป็นเหมือนก่อนย้าย'
          : 'ยอดคงเหลือของปุ่มนี้จะกลับเป็นเหมือนก่อนปรับ',
      confirmText: 'ลบ',
      danger: true,
    })
    if (!ok) return
    try {
      await db.transaction('rw', db.adjustments, async () => {
        for (const x of linked) await remove(db.adjustments, x.id)
      })
      toast('ลบแล้ว', 'success')
    } catch (e) {
      console.error(e)
      toast('ลบไม่สำเร็จ ลองอีกครั้ง', 'error')
    }
  }

  return (
    <Card title="ปรับล่าสุด" flush>
      {all === undefined ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState compact title="ยังไม่มีการปรับสต็อกที่แผงนี้" hint="ของเสีย ของหาย ย้ายแผง และการนับสต็อก จะขึ้นที่นี่" />
      ) : (
        <>
          <div className="stock-flush-list">
            {rows.slice(0, limit).map((a) => {
              const t = tierLookup?.get(a.tierId)
              const partner = a.linkId ? byLink.get(a.linkId)?.find((x) => x.id !== a.id) : undefined
              const parts = [
                thaiDate(a.dayKey),
                a.reason === 'count' && a.countedQty != null ? `นับได้ ${num(a.countedQty, 2)}` : null,
                partner ? `${a.reason === 'transfer_out' ? 'ไป' : 'จาก'}${boothNameOf(allBooths, partner.boothId)}` : null,
                a.staffId ? `โดย ${staffById.get(a.staffId) ?? 'ไม่ทราบชื่อ'}` : null,
              ].filter(Boolean)
              return (
                <div key={a.id} className="list-row">
                  {t ? <TierTag tier={t} size="sm" /> : <span className="stock-tag stock-tag-sm stock-tag-missing">?</span>}
                  <div className="list-main">
                    <span className="list-title">
                      {ADJUST_REASON_LABEL[a.reason] ?? 'ปรับสต็อก'} · {t ? `${t.name} ${bahtSign(t.price)}` : 'ปุ่มราคาที่ไม่พบ'}
                    </span>
                    <span className="list-sub">{parts.join(' · ')}</span>
                    {a.note && <span className="list-sub stock-note">{a.note}</span>}
                  </div>
                  <div className="stock-row-end">
                    <strong className={cx('num stock-move-qty', a.qtyChange < 0 ? 'tone-danger' : 'tone-success')}>{signed(a.qtyChange)}</strong>
                    <IconButton label="ลบรายการนี้" icon={<Trash2 size={20} />} variant="danger" onClick={() => void del(a)} />
                  </div>
                </div>
              )
            })}
          </div>
          {rows.length > limit && (
            <div className="stock-more">
              <Button variant="ghost" block onClick={() => setLimit((n) => n + PAGE)}>
                ดูเพิ่ม ({rows.length - limit})
              </Button>
            </div>
          )}
        </>
      )}
      {rows.some((a) => a.reason === 'count') && (
        <div className="stock-more">
          <Callout>ลบรายการ “นับสต็อก” เมื่อกรอกผิด แล้วนับใหม่ที่หน้า นับสต็อก</Callout>
        </div>
      )}
    </Card>
  )
}
