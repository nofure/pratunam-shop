import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PackagePlus, Plus, X } from 'lucide-react'
import { db, save } from '../../db'
import { useStaffList } from '../../hooks'
import { useSession } from '../../session'
import type { ID, Lot, Supplier, Tier } from '../../types'
import { todayKey } from '../../lib/dates'
import { bahtSign, num } from '../../lib/format'
import { Button, Card, EmptyState, Field, IconButton, MoneyInput, Money, Segmented, useConfirm, useToast } from '../../ui'
import { BoothBar, Callout, Loading, LotRow, NoBooth, NoTiers, TierPicker, useDeleteLot } from './common'
import { aliveSuppliersSorted, boothNameOf, useBoothStock, useStockBooth, useSupplierRows, useTierLookup, type BoothStock } from './data'
import {
  avgCostAfter,
  isWholeNumber,
  lotCosts,
  margin,
  piecesFromInput,
  promoText,
  promoUnitPrice,
  type CostMode,
  type LotCosts,
} from './logic'

export default function ReceivePage() {
  const { boothId, setBoothId } = useStockBooth()
  const raw = useBoothStock(boothId)
  const data = raw && raw.boothId !== boothId ? undefined : raw
  const [params, setParams] = useSearchParams()
  const tierLookup = useTierLookup()
  const [preset, setPreset] = useState<ID | null>(null)

  // /stock/receive?tier=<id> (from the on-hand page): switch to that tier's booth and select it.
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
        <ReceiveForm key={data.boothId} data={data} preset={preset} onPresetUsed={() => setPreset(null)} />
      )}
    </div>
  )
}

function MarginLine({ label, salePrice, unitCost, unit }: { label: string; salePrice: number; unitCost: number; unit: string }) {
  const m = margin(salePrice, unitCost)
  const tone = m.profit < 0 ? 'danger' : m.profit === 0 ? 'warning' : 'success'
  return (
    <div className="stock-margin-row">
      <span className="stock-margin-label">{label}</span>
      <span className="stock-margin-value">
        {m.profit < 0 ? 'ขาดทุน' : 'กำไร'}
        {unit}ละ <Money value={Math.abs(m.profit)} tone={tone} />
        {m.pct != null && <span className={`num tone-${tone}`}> ({num(Math.abs(m.pct), 1)}%)</span>}
      </span>
    </div>
  )
}

function ReceiveForm({ data, preset, onPresetUsed }: { data: BoothStock; preset: ID | null; onPresetUsed: () => void }) {
  const { staff } = useSession()
  const { allBooths } = useStockBooth()
  const toast = useToast()
  const confirm = useConfirm()
  const deleteLot = useDeleteLot()
  const supplierRows = useSupplierRows()
  const staffList = useStaffList(true)

  const [dayKey, setDayKey] = useState(() => todayKey())
  const [tierId, setTierId] = useState<ID | null>(null)
  const [qtyInput, setQtyInput] = useState<number | null>(null)
  const [dozen, setDozen] = useState(false)
  const [costMode, setCostMode] = useState<CostMode>('unit')
  const [costInput, setCostInput] = useState<number | null>(null)
  const [supplierId, setSupplierId] = useState<ID>('')
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)

  const [addingSup, setAddingSup] = useState(false)
  const [supName, setSupName] = useState('')
  const [supLocation, setSupLocation] = useState('')
  const [supError, setSupError] = useState<string | null>(null)
  const [supSaving, setSupSaving] = useState(false)

  const pickable = useMemo(() => data.tiers.filter((t) => t.active === 1), [data.tiers])

  useEffect(() => {
    if (preset && pickable.some((t) => t.id === preset)) {
      setTierId(preset)
      onPresetUsed()
    }
  }, [preset, pickable, onPresetUsed])

  const suppliers = useMemo(() => (supplierRows ? aliveSuppliersSorted(supplierRows) : []), [supplierRows])
  const supplierById = useMemo(() => new Map((supplierRows ?? []).map((s) => [s.id, s])), [supplierRows])
  const staffById = useMemo(() => new Map((staffList ?? []).map((s) => [s.id, s.name])), [staffList])
  const tierById = useMemo(() => new Map(data.tiers.map((t) => [t.id, t])), [data.tiers])

  const tier: Tier | undefined = tierId ? pickable.find((t) => t.id === tierId) : undefined
  const unit = tier?.unit ?? 'ตัว'
  const today = todayKey()

  const qty = piecesFromInput(qtyInput, dozen)
  const qtyError =
    qtyInput == null ? 'ใส่จำนวน' : qty == null ? 'จำนวนต้องมากกว่า 0' : !isWholeNumber(qty) ? `จำนวน${unit}ต้องเป็นจำนวนเต็ม` : null
  const costs: LotCosts | null = qtyError ? null : lotCosts(costMode, qty, costInput)
  const costError = costInput == null ? 'ใส่ทุน' : !(costInput > 0) ? 'ทุนต้องมากกว่า 0' : null
  const dateError = !dayKey ? 'เลือกวันที่' : dayKey > today ? 'วันที่ต้องไม่เกินวันนี้' : null
  const tierError = tier ? null : 'เลือกปุ่มราคาที่รับของเข้า'

  const recent = useMemo(() => [...data.lots].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10), [data.lots])

  const switchCostMode = (mode: CostMode) => {
    if (mode === costMode) return
    if (costs) setCostInput(mode === 'unit' ? costs.unitCost : costs.totalCost)
    setCostMode(mode)
  }

  const addSupplier = async () => {
    const name = supName.trim()
    if (!name) {
      setSupError('ใส่ชื่อร้าน')
      return
    }
    const dup = suppliers.find((s) => s.name.trim().toLowerCase() === name.toLowerCase())
    if (dup) {
      setSupplierId(dup.id)
      setAddingSup(false)
      setSupName('')
      setSupLocation('')
      toast('มีร้านนี้อยู่แล้ว เลือกให้แล้ว', 'info')
      return
    }
    setSupSaving(true)
    try {
      const rec = await save<Supplier>(db.suppliers, { name, phone: null, location: supLocation.trim() || null, note: null })
      setSupplierId(rec.id)
      setAddingSup(false)
      setSupName('')
      setSupLocation('')
      setSupError(null)
      toast('เพิ่มร้านแล้ว', 'success')
    } catch (e) {
      console.error(e)
      toast('เพิ่มร้านไม่สำเร็จ ลองอีกครั้ง', 'error')
    } finally {
      setSupSaving(false)
    }
  }

  const submit = async () => {
    setTried(true)
    if (!tier || qtyError || costError || dateError || !costs || qty == null) {
      toast('กรอกให้ครบก่อนบันทึก', 'error')
      return
    }
    if (costs.unitCost >= tier.price) {
      const ok = await confirm({
        title: 'ทุนไม่ต่ำกว่าราคาขาย',
        message: `ทุน${unit}ละ ${bahtSign(costs.unitCost)} แต่ขาย ${bahtSign(tier.price)} ขายแล้วจะไม่ได้กำไร\nตรวจว่าใส่ทุนต่อ${unit} หรือทุนรวมทั้งล็อตถูกช่อง`,
        confirmText: 'บันทึกต่อ',
        cancelText: 'กลับไปแก้',
      })
      if (!ok) return
    }
    if (qty > 2000) {
      const ok = await confirm({
        title: 'จำนวนเยอะผิดปกติ',
        message: `${num(qty)} ${unit} ถูกต้องไหม`,
        confirmText: 'ถูกต้อง บันทึก',
        cancelText: 'กลับไปแก้',
      })
      if (!ok) return
    }
    setSaving(true)
    try {
      await save<Lot>(db.lots, {
        boothId: tier.boothId,
        tierId: tier.id,
        dayKey,
        qty,
        unitCost: costs.unitCost,
        totalCost: costs.totalCost,
        supplierId: supplierId || null,
        note: note.trim() || null,
        staffId: staff?.id ?? null,
      })
      toast(`รับเข้าแล้ว ${tier.name} ${num(qty)} ${unit}`, 'success')
      // Keep date and supplier: several price tiers usually come from the same trip.
      setTierId(null)
      setQtyInput(null)
      setDozen(false)
      setCostInput(null)
      setNote('')
      setTried(false)
    } catch (e) {
      console.error(e)
      toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error')
    } finally {
      setSaving(false)
    }
  }

  const show = (err: string | null) => (tried ? err : null)
  const promoUnit = tier ? promoUnitPrice(tier) : null
  const stockNow = tier ? data.stock.get(tier.id) : undefined
  const newAvg = tier && costs && qty ? avgCostAfter(data.lots, tier.id, qty, costs.unitCost) : null

  return (
    <div className="stock-cols">
      <Card title="รับของเข้า" className="stock-form">
        <div className="stack">
          {pickable.length === 0 ? (
            <Callout tone="warning">ปุ่มราคาของแผงนี้ถูกซ่อนหมด เปิดปุ่มราคาได้ที่ ตั้งค่า</Callout>
          ) : (
            <Field label="ปุ่มราคา" error={show(tierError)}>
              <TierPicker tiers={pickable} value={tierId} onChange={setTierId} stock={data.stock} invalid={!!show(tierError)} />
            </Field>
          )}

          <Field
            label={`จำนวนที่รับเข้า (${dozen ? 'โหล' : unit})`}
            error={show(qtyError)}
            hint={dozen && qty != null && !qtyError ? `= ${num(qty)} ${unit}` : dozen ? '1 โหล = 12' : undefined}
          >
            <MoneyInput value={qtyInput} onChange={setQtyInput} prefix={false} allowDecimal={dozen} maxDigits={6} placeholder="0" />
          </Field>
          <Segmented
            aria-label="หน่วยของจำนวน"
            block
            options={[
              { value: 'pcs', label: `นับเป็น${unit}` },
              { value: 'dozen', label: 'นับเป็นโหล (×12)' },
            ]}
            value={dozen ? 'dozen' : 'pcs'}
            onChange={(v) => setDozen(v === 'dozen')}
          />

          <Segmented
            aria-label="วิธีใส่ทุน"
            block
            options={[
              { value: 'unit', label: `ทุนต่อ${unit}` },
              { value: 'total', label: 'ทุนรวมทั้งล็อต' },
            ]}
            value={costMode}
            onChange={switchCostMode}
          />
          <Field
            label={costMode === 'unit' ? `ทุนต่อ${unit} (บาท)` : 'ทุนรวมทั้งล็อต (บาท)'}
            error={show(costError)}
            hint={
              costs
                ? costMode === 'unit'
                  ? `รวมทั้งล็อต ${bahtSign(costs.totalCost)}`
                  : `ตก${unit}ละ ${bahtSign(costs.unitCost)}`
                : undefined
            }
          >
            <MoneyInput value={costInput} onChange={setCostInput} allowDecimal />
          </Field>

          <Field label="ร้านที่ซื้อ" hint={addingSup ? undefined : 'ไม่ใส่ก็ได้'}>
            <div className="row nowrap">
              <select
                className="select"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                disabled={supplierRows === undefined}
                aria-label="ร้านที่ซื้อ"
              >
                <option value="">ไม่ระบุ</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.location ? ` · ${s.location}` : ''}
                  </option>
                ))}
              </select>
              {!addingSup && (
                <Button icon={<Plus size={20} />} onClick={() => setAddingSup(true)} className="stock-nowrap">
                  ร้านใหม่
                </Button>
              )}
            </div>
          </Field>
          {addingSup && (
            <div className="stock-inline-add stack-sm">
              <div className="row-between">
                <strong>เพิ่มร้านใหม่</strong>
                <IconButton label="ปิดการเพิ่มร้าน" icon={<X size={20} />} onClick={() => setAddingSup(false)} />
              </div>
              <Field label="ชื่อร้าน" error={supError} required>
                <input
                  className="input"
                  value={supName}
                  onChange={(e) => {
                    setSupName(e.target.value)
                    setSupError(null)
                  }}
                  maxLength={60}
                  autoFocus
                />
              </Field>
              <Field label="อยู่ที่ไหน" hint="เช่น โบ๊เบ๊ ตึก 3">
                <input className="input" value={supLocation} onChange={(e) => setSupLocation(e.target.value)} maxLength={80} />
              </Field>
              <Button variant="primary" onClick={() => void addSupplier()} loading={supSaving}>
                เพิ่มร้าน
              </Button>
            </div>
          )}

          <div className="grid-2 stock-date-note">
            <Field label="วันที่รับของ" error={show(dateError)}>
              <input className="input" type="date" value={dayKey} max={today} onChange={(e) => setDayKey(e.target.value)} />
            </Field>
            <Field label="หมายเหตุ">
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="ไม่ใส่ก็ได้" />
            </Field>
          </div>

          {tier && costs && (
            <div className="stock-margin" aria-live="polite">
              <MarginLine label={`ขายปกติ ${bahtSign(tier.price)}`} salePrice={tier.price} unitCost={costs.unitCost} unit={unit} />
              {promoUnit != null && (
                <MarginLine
                  label={`ขายโปร ${promoText(tier)} (ตก${unit}ละ ${bahtSign(promoUnit)})`}
                  salePrice={promoUnit}
                  unitCost={costs.unitCost}
                  unit={unit}
                />
              )}
              {stockNow?.avgCost != null && newAvg != null && (
                <div className="stock-margin-row muted">
                  <span>ทุนเฉลี่ยตอนนี้ {bahtSign(stockNow.avgCost)}</span>
                  <span>หลังรับเข้า {bahtSign(newAvg)}</span>
                </div>
              )}
            </div>
          )}

          {tier && qty != null && !qtyError && costs && (
            <p className="stock-summary">
              รับ {tier.name} {bahtSign(tier.price)} · {num(qty)} {unit} · ทุนรวม {bahtSign(costs.totalCost)}
            </p>
          )}

          <Button variant="primary" size="lg" block icon={<PackagePlus size={22} />} loading={saving} onClick={() => void submit()} disabled={pickable.length === 0}>
            บันทึกรับของเข้า
          </Button>
        </div>
      </Card>

      <Card
        title="รับเข้าล่าสุด"
        flush
        actions={
          <Link to="/stock/lots" className="btn btn-ghost">
            ดูทั้งหมด
          </Link>
        }
      >
        {recent.length === 0 ? (
          <EmptyState compact title="ยังไม่มีการรับของเข้าที่แผงนี้" hint="รายการที่บันทึกจะขึ้นที่นี่ ลบได้ถ้าใส่ผิด" />
        ) : (
          <div className="stock-flush-list">
            {recent.map((l) => {
              const t = tierById.get(l.tierId)
              return (
                <LotRow
                  key={l.id}
                  lot={l}
                  tier={t}
                  supplierName={l.supplierId ? (supplierById.get(l.supplierId)?.name ?? null) : null}
                  staffName={l.staffId ? (staffById.get(l.staffId) ?? null) : null}
                  boothName={l.boothId !== data.boothId ? boothNameOf(allBooths, l.boothId) : null}
                  onDelete={() => void deleteLot(l, t)}
                />
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
