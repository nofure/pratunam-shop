// Price buttons (ปุ่มราคา) per booth, shown like the POS price cards.
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Copy, LayoutGrid, ListOrdered, Plus, Store, Trash2 } from 'lucide-react'
import { alive, db, patch, remove, save, saveMany } from '../../db'
import { useDevice } from '../../device'
import { useAllTiers, useBooths, useTiers } from '../../hooks'
import { UNITS } from '../../constants'
import { PHOTO_TEMPLATE } from '../../seed'
import { baht, round2 } from '../../lib/format'
import type { Booth, ID, Tier, TierColor } from '../../types'
import { Button, EmptyState, Field, IconButton, Modal, MoneyInput, PageHeader, Toggle, cx, useConfirm, useToast } from '../../ui'
import { findDuplicateTier, moveItem, nextSort, promoSaving, resequence, tierNameSuggestions, validateTierForm } from './logic'
import { ColorSwatches, Loading, TierCard } from './parts'

const TEMPLATE_NAMES = PHOTO_TEMPLATE.flatMap((b) => b.tiers.map((t) => t.name))

export default function TierSettings() {
  const booths = useBooths(true)
  const { boothId: deviceBooth } = useDevice()
  const [params, setParams] = useSearchParams()
  const wanted = params.get('booth')
  const booth: Booth | null = booths
    ? (booths.find((b) => b.id === wanted) ?? booths.find((b) => b.id === deviceBooth) ?? booths.find((b) => b.active === 1) ?? booths[0] ?? null)
    : null
  const tiers = useTiers(booth?.id ?? null, true)
  const allTiers = useAllTiers()
  const toast = useToast()
  const [editing, setEditing] = useState<Tier | 'new' | null>(null)
  const [ordering, setOrdering] = useState(false)
  const [moving, setMoving] = useState(false)
  const [importing, setImporting] = useState(false)

  const pickBooth = (id: ID) => setParams({ booth: id }, { replace: true })

  const move = async (list: Tier[], index: number, delta: number) => {
    const ordered = moveItem(list, index, delta)
    if (ordered === list || moving) return
    setMoving(true)
    try {
      await db.transaction('rw', db.tiers, async () => {
        for (const c of resequence(ordered)) await patch(db.tiers, c.id, { sort: c.sort })
      })
    } catch (e) {
      console.error('reorder tiers failed', e)
      toast('จัดลำดับไม่สำเร็จ', 'error')
    } finally {
      setMoving(false)
    }
  }

  if (booths === undefined) {
    return (
      <div className="page settings-page settings-page-wide">
        <PageHeader title="ปุ่มราคา" back="/settings" />
        <Loading />
      </div>
    )
  }

  return (
    <div className="page settings-page settings-page-wide">
      <PageHeader
        title="ปุ่มราคา"
        back="/settings"
        sub={booth ? booth.name : undefined}
        actions={
          booth ? (
            <Button variant="primary" icon={<Plus size={20} />} onClick={() => setEditing('new')}>
              เพิ่ม
            </Button>
          ) : undefined
        }
      />

      {booths.length === 0 || !booth ? (
        <EmptyState
          title="ยังไม่มีแผง"
          hint="เพิ่มแผงก่อน แล้วค่อยเพิ่มปุ่มราคา"
          action={
            <Link to="/settings/booths" className="btn btn-primary">
              ไปที่หน้าแผง
            </Link>
          }
        />
      ) : (
        <div className="stack">
          {booths.length > 1 && (
            <div className="settings-chips settings-chips-scroll" role="tablist" aria-label="เลือกแผง">
              {booths.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="tab"
                  aria-selected={b.id === booth.id}
                  className={cx('chip', b.id === booth.id && 'active')}
                  onClick={() => pickBooth(b.id)}
                >
                  <Store size={16} aria-hidden="true" />
                  {b.name}
                  {b.active !== 1 && ' (ปิด)'}
                </button>
              ))}
            </div>
          )}

          {tiers === undefined ? (
            <Loading />
          ) : tiers.length === 0 ? (
            <EmptyState
              title={`${booth.name} ยังไม่มีปุ่มราคา`}
              hint="เพิ่มทีละปุ่ม หรือเริ่มจากแบบป้ายราคาในร้าน แล้วค่อยแก้"
              action={
                <div className="settings-actions">
                  <Button variant="primary" icon={<Plus size={20} />} onClick={() => setEditing('new')}>
                    เพิ่มปุ่มราคา
                  </Button>
                  <Button icon={<LayoutGrid size={20} />} onClick={() => setImporting(true)}>
                    ใช้แบบป้ายในร้าน
                  </Button>
                </div>
              }
            />
          ) : (
            <>
              <div className="row-between">
                <span className="settings-muted">
                  {ordering ? 'กดลูกศรเพื่อย้ายปุ่ม ลำดับนี้คือลำดับในหน้าขาย' : `${tiers.length} ปุ่ม · แตะปุ่มเพื่อแก้ไข`}
                </span>
                <Button
                  variant={ordering ? 'primary' : 'secondary'}
                  icon={<ListOrdered size={20} />}
                  onClick={() => setOrdering((v) => !v)}
                >
                  {ordering ? 'เสร็จ' : 'จัดลำดับ'}
                </Button>
              </div>
              <div className="settings-cards">
                {tiers.map((t, i) =>
                  ordering ? (
                    <div key={t.id} className="settings-card-wrap">
                      <TierCard name={t.name} price={t.price} promoQty={t.promoQty} promoPrice={t.promoPrice} unit={t.unit} color={t.color} inactive={t.active !== 1} />
                      <div className="settings-card-move">
                        <IconButton label={`ย้าย ${t.name} ${baht(t.price)} ไปก่อน`} icon={<ArrowLeft size={20} />} disabled={i === 0 || moving} onClick={() => void move(tiers, i, -1)} />
                        <IconButton
                          label={`ย้าย ${t.name} ${baht(t.price)} ไปหลัง`}
                          icon={<ArrowRight size={20} />}
                          disabled={i === tiers.length - 1 || moving}
                          onClick={() => void move(tiers, i, 1)}
                        />
                      </div>
                    </div>
                  ) : (
                    <TierCard
                      key={t.id}
                      name={t.name}
                      price={t.price}
                      promoQty={t.promoQty}
                      promoPrice={t.promoPrice}
                      unit={t.unit}
                      color={t.color}
                      inactive={t.active !== 1}
                      onClick={() => setEditing(t)}
                    />
                  ),
                )}
              </div>
              {!ordering && (
                <div className="row">
                  <Button icon={<LayoutGrid size={20} />} onClick={() => setImporting(true)}>
                    เพิ่มจากแบบป้ายในร้าน
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {editing && booth && tiers && (
        <TierEditor
          key={editing === 'new' ? 'new' : editing.id}
          tier={editing === 'new' ? null : editing}
          booth={booth}
          boothTiers={tiers}
          allTiers={allTiers ?? []}
          onClose={() => setEditing(null)}
          onOpen={(t) => setEditing(t)}
        />
      )}
      {importing && booth && tiers && <TemplateImport booth={booth} boothTiers={tiers} onClose={() => setImporting(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------- editor

interface EditorProps {
  tier: Tier | null
  booth: Booth
  boothTiers: Tier[]
  allTiers: Tier[]
  onClose: () => void
  onOpen: (t: Tier) => void
}

function TierEditor({ tier, booth, boothTiers, allTiers, onClose, onOpen }: EditorProps) {
  const toast = useToast()
  const confirm = useConfirm()
  const commonUnit = useMemo(() => {
    const count = new Map<string, number>()
    for (const t of boothTiers) count.set(t.unit, (count.get(t.unit) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? UNITS[0]
  }, [boothTiers])

  const [name, setName] = useState(tier?.name ?? '')
  const [price, setPrice] = useState<number | null>(tier?.price ?? null)
  const [promoOn, setPromoOn] = useState(tier ? tier.promoQty != null && tier.promoPrice != null : false)
  const [promoQty, setPromoQty] = useState<number | null>(tier?.promoQty ?? 3)
  const [promoPrice, setPromoPrice] = useState<number | null>(tier?.promoPrice ?? null)
  const [unit, setUnit] = useState(tier?.unit ?? commonUnit)
  const [color, setColor] = useState<TierColor>(tier?.color ?? 'yellow')
  const [trackStock, setTrackStock] = useState(tier ? tier.trackStock === 1 : true)
  const [lowStock, setLowStock] = useState<number | null>(tier ? tier.lowStock : 5)
  const [active, setActive] = useState(tier ? tier.active === 1 : true)
  const [busy, setBusy] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const errors = validateTierForm({ name, price, promoOn, promoQty, promoPrice, unit })
  const hasErrors = Object.keys(errors).length > 0
  const suggestions = useMemo(() => tierNameSuggestions(allTiers, TEMPLATE_NAMES), [allTiers])
  const units = UNITS.includes(unit) ? UNITS : [...UNITS, unit]
  const saving = promoOn ? promoSaving(price, promoQty, promoPrice) : 0
  const listId = `tier-names-${tier?.id ?? 'new'}`

  const submit = async () => {
    if (hasErrors) {
      setShowErrors(true)
      return
    }
    const dup = findDuplicateTier(boothTiers, booth.id, name, price, tier?.id ?? null)
    if (dup) {
      const ok = await confirm({
        title: 'มีปุ่มนี้อยู่แล้ว',
        message: `${booth.name} มีปุ่ม "${dup.name} ${baht(dup.price)}" อยู่แล้ว ต้องการบันทึกซ้ำไหม`,
        confirmText: 'บันทึกซ้ำ',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const rec = {
        boothId: booth.id,
        name: name.trim(),
        price: round2(price ?? 0),
        promoQty: promoOn ? promoQty : null,
        promoPrice: promoOn && promoPrice != null ? round2(promoPrice) : null,
        unit,
        color,
        active: (active ? 1 : 0) as 0 | 1,
        trackStock: (trackStock ? 1 : 0) as 0 | 1,
        lowStock: trackStock ? lowStock : null,
      }
      if (tier) await patch(db.tiers, tier.id, rec)
      else await save<Tier>(db.tiers, { ...rec, sort: nextSort(boothTiers) })
      toast('บันทึกแล้ว', 'success')
      onClose()
    } catch (e) {
      console.error('save tier failed', e)
      toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error')
    } finally {
      setBusy(false)
    }
  }

  const duplicate = async () => {
    if (!tier) return
    setBusy(true)
    try {
      const created = await db.transaction('rw', db.tiers, async () => {
        const list = alive(await db.tiers.where('boothId').equals(tier.boothId).toArray()).sort((a, b) => a.sort - b.sort)
        const src = list.find((t) => t.id === tier.id) ?? tier
        const copy = await save<Tier>(db.tiers, {
          boothId: src.boothId,
          name: src.name,
          price: src.price,
          promoQty: src.promoQty,
          promoPrice: src.promoPrice,
          unit: src.unit,
          color: src.color,
          sort: src.sort,
          active: src.active,
          trackStock: src.trackStock,
          lowStock: src.lowStock,
        })
        const idx = list.findIndex((t) => t.id === src.id)
        const ordered = idx < 0 ? [...list, copy] : [...list.slice(0, idx + 1), copy, ...list.slice(idx + 1)]
        for (const c of resequence(ordered)) await patch(db.tiers, c.id, { sort: c.sort })
        return (await db.tiers.get(copy.id)) ?? copy
      })
      toast('ทำสำเนาแล้ว แก้ราคาของปุ่มใหม่ได้เลย', 'success')
      onOpen(created)
    } catch (e) {
      console.error('duplicate tier failed', e)
      toast('ทำสำเนาไม่สำเร็จ', 'error')
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    if (!tier) return
    const ok = await confirm({
      title: `ลบปุ่ม ${tier.name} ${baht(tier.price)}`,
      message: 'ปุ่มจะหายจากหน้าขาย บิลเก่า รายงาน และประวัติสต็อกยังอยู่ครบ ถ้าแค่หยุดขายชั่วคราว ให้ปิด "ใช้งานอยู่" แทน',
      confirmText: 'ลบปุ่ม',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await remove(db.tiers, tier.id)
      toast('ลบแล้ว', 'success')
      onClose()
    } catch (e) {
      console.error('delete tier failed', e)
      toast('ลบไม่สำเร็จ', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      closeOnBackdrop={false}
      title={tier ? 'แก้ไขปุ่มราคา' : `เพิ่มปุ่มราคา · ${booth.name}`}
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
        <div className="settings-tier-preview" aria-hidden="true">
          <TierCard
            name={name.trim()}
            price={price}
            promoQty={promoOn ? promoQty : null}
            promoPrice={promoOn ? promoPrice : null}
            unit={unit}
            color={color}
            inactive={!active}
          />
        </div>

        <div className="grid-2">
          <Field label="ชื่อสินค้า" error={showErrors && errors.name}>
            <input
              className="input"
              value={name}
              list={listId}
              maxLength={40}
              autoFocus={!tier}
              placeholder="เช่น เสื้อยืด"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="ราคา (บาท)" error={showErrors && errors.price}>
            <MoneyInput value={price} onChange={setPrice} size="md" />
          </Field>
        </div>
        <datalist id={listId}>
          {suggestions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {tier && price != null && price !== tier.price && <p className="settings-note">บิลเก่ายังเป็นราคาเดิม ราคาใหม่ใช้กับบิลต่อจากนี้</p>}

        <div className="settings-subtle-box stack-sm">
          <Toggle checked={promoOn} onChange={setPromoOn} label="มีโปรจำนวน" hint="เช่น 39 บาท · 3 ตัว 100" />
          {promoOn && (
            <>
              <div className="settings-promo-row">
                <Field label={`จำนวน (${unit})`} error={showErrors && errors.promoQty}>
                  <MoneyInput value={promoQty} onChange={setPromoQty} size="md" prefix={false} maxDigits={2} />
                </Field>
                <Field label="ราคาโปร (บาท)" error={showErrors && errors.promoPrice}>
                  <MoneyInput value={promoPrice} onChange={setPromoPrice} size="md" />
                </Field>
              </div>
              {!errors.promoQty && !errors.promoPrice && !errors.price && promoQty != null && promoPrice != null && price != null && (
                <p className="settings-note tone-success">
                  ซื้อ {promoQty} {unit} จ่าย {baht(promoPrice)} บาท (ปกติ {baht(round2(price * promoQty))} ลด {baht(saving)})
                </p>
              )}
            </>
          )}
        </div>

        <Field label="หน่วย">
          <div className="settings-chips" role="radiogroup" aria-label="หน่วย">
            {units.map((u) => (
              <button key={u} type="button" role="radio" aria-checked={u === unit} className={cx('chip', u === unit && 'active')} onClick={() => setUnit(u)}>
                {u}
              </button>
            ))}
          </div>
        </Field>

        <Field label="สีปุ่ม (ให้เหมือนป้ายราคาในร้าน)">
          <ColorSwatches value={color} onChange={setColor} />
        </Field>

        <div className="settings-subtle-box stack-sm">
          <Toggle checked={trackStock} onChange={setTrackStock} label="นับสต็อก" hint="ดูของคงเหลือ และเตือนเมื่อใกล้หมด" />
          {trackStock && (
            <Field label="เตือนเมื่อเหลือไม่เกิน" hint="เว้นว่างถ้าไม่ต้องการเตือน">
              <MoneyInput value={lowStock} onChange={setLowStock} size="md" prefix={false} maxDigits={4} placeholder="ไม่เตือน" />
            </Field>
          )}
        </div>

        <Toggle checked={active} onChange={setActive} label="ใช้งานอยู่" hint="ปิดไว้ถ้าหยุดขายชั่วคราว ปุ่มจะไม่แสดงในหน้าขาย" />

        {tier && (
          <div className="settings-danger-zone">
            <Button icon={<Copy size={20} />} onClick={() => void duplicate()} disabled={busy}>
              ทำสำเนา
            </Button>
            <Button variant="ghost" className="settings-btn-danger" icon={<Trash2 size={20} />} onClick={() => void del()} disabled={busy}>
              ลบปุ่มนี้
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- start from the shop's price-card template

function TemplateImport({ booth, boothTiers, onClose }: { booth: Booth; boothTiers: Tier[]; onClose: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const add = async (index: number) => {
    const tb = PHOTO_TEMPLATE[index]
    const fresh = tb.tiers.filter((t) => !findDuplicateTier(boothTiers, booth.id, t.name, t.price, null))
    if (fresh.length === 0) {
      toast('แผงนี้มีปุ่มเหล่านี้ครบแล้ว', 'info')
      return
    }
    setBusy(true)
    try {
      const start = nextSort(boothTiers)
      await saveMany<Tier>(
        db.tiers,
        fresh.map((t, i) => ({
          boothId: booth.id,
          name: t.name,
          price: t.price,
          promoQty: t.promoQty ?? null,
          promoPrice: t.promoPrice ?? null,
          unit: t.unit,
          color: t.color,
          sort: start + i,
          active: 1 as const,
          trackStock: 1 as const,
          lowStock: 5,
        })),
      )
      toast(`เพิ่ม ${fresh.length} ปุ่มแล้ว`, 'success')
      onClose()
    } catch (e) {
      console.error('template import failed', e)
      toast('เพิ่มไม่สำเร็จ ลองอีกครั้ง', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open size="lg" onClose={onClose} title={`เพิ่มปุ่มให้ ${booth.name}`}>
      <div className="stack">
        <p className="settings-note">เลือกชุดปุ่มตามป้ายราคาในร้าน ปุ่มที่มีอยู่แล้ว (ชื่อและราคาเดียวกัน) จะไม่ถูกเพิ่มซ้ำ</p>
        {PHOTO_TEMPLATE.map((tb, i) => (
          <div key={tb.name} className="settings-subtle-box stack-sm">
            <div className="row-between">
              <strong>{tb.name}</strong>
              <Button variant="primary" onClick={() => void add(i)} loading={busy}>
                เพิ่ม {tb.tiers.length} ปุ่ม
              </Button>
            </div>
            <div className="settings-cards">
              {tb.tiers.map((t, j) => (
                <TierCard key={j} small name={t.name} price={t.price} promoQty={t.promoQty ?? null} promoPrice={t.promoPrice ?? null} unit={t.unit} color={t.color} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
