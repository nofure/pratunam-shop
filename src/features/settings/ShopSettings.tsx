// Shop-wide settings: name, PromptPay, payment options, void rule.
import { useState } from 'react'
import { db, patch } from '../../db'
import { useShop } from '../../hooks'
import { formatPromptPayTarget, promptPayPayload } from '../../lib/promptpay'
import type { ShopConfig } from '../../types'
import { Button, Card, EmptyState, Field, PageHeader, QrCode, Toggle, cx, useToast } from '../../ui'
import { checkPromptPay } from './logic'
import { Loading } from './parts'

type Form = Pick<ShopConfig, 'name' | 'promptPayId' | 'promptPayName' | 'halfHalfEnabled' | 'otherPayEnabled' | 'otherPayLabel' | 'voidNeedsOwner'>

function formOf(s: ShopConfig): Form {
  return {
    name: s.name,
    promptPayId: s.promptPayId,
    promptPayName: s.promptPayName,
    halfHalfEnabled: s.halfHalfEnabled,
    otherPayEnabled: s.otherPayEnabled,
    otherPayLabel: s.otherPayLabel,
    voidNeedsOwner: s.voidNeedsOwner,
  }
}

export default function ShopSettings() {
  const shop = useShop()
  return (
    <div className="page settings-page">
      <PageHeader title="ร้าน" back="/settings" />
      {shop === undefined ? (
        <Loading />
      ) : !shop ? (
        <EmptyState title="ยังไม่มีข้อมูลร้าน" hint="ลองเปิดแอปใหม่อีกครั้ง" />
      ) : (
        <ShopForm key={shop.id} shop={shop} />
      )}
    </div>
  )
}

function ShopForm({ shop }: { shop: ShopConfig }) {
  const toast = useToast()
  const [base, setBase] = useState<Form>(() => formOf(shop))
  const [f, setF] = useState<Form>(() => formOf(shop))
  const [saving, setSaving] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [seenAt, setSeenAt] = useState(shop.updatedAt)

  // Changed on another device (sync) while this page is open: take the new values for the
  // fields not being edited here, keep what the owner is typing.
  if (shop.updatedAt !== seenAt) {
    setSeenAt(shop.updatedAt)
    const next = formOf(shop)
    setF((cur) => {
      const out = { ...cur }
      for (const k of Object.keys(next) as (keyof Form)[]) if (cur[k] === base[k]) (out as Record<string, unknown>)[k] = next[k]
      return out
    })
    setBase(next)
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((cur) => ({ ...cur, [k]: v }))
  const pp = checkPromptPay(f.promptPayId)
  const errors = {
    name: !f.name.trim() ? 'ใส่ชื่อร้าน' : '',
    pp: pp.error,
    otherLabel: f.otherPayEnabled === 1 && !f.otherPayLabel.trim() ? 'ใส่ชื่อวิธีจ่าย' : '',
  }
  const hasErrors = !!(errors.name || errors.pp || errors.otherLabel)

  const normalized = (x: Form): Form => ({
    ...x,
    name: x.name.trim(),
    promptPayId: x.promptPayId.replace(/\D/g, ''),
    promptPayName: x.promptPayName.trim(),
    otherPayLabel: x.otherPayLabel.trim() || 'อื่นๆ',
  })
  const changes = (() => {
    const a = normalized(f)
    const b = normalized(base)
    const out: Partial<Form> = {}
    for (const k of Object.keys(a) as (keyof Form)[]) if (a[k] !== b[k]) (out as Record<string, unknown>)[k] = a[k]
    return out
  })()
  const dirty = Object.keys(changes).length > 0

  const saveForm = async () => {
    if (hasErrors) {
      setShowErrors(true)
      return
    }
    if (!dirty) return
    setSaving(true)
    try {
      // Only the fields changed here, so an edit synced from another device meanwhile isn't overwritten.
      const saved = await patch(db.shop, 'shop', changes)
      if (!saved) throw new Error('shop row missing')
      const next = formOf(saved)
      setSeenAt(saved.updatedAt)
      setBase(next)
      setF(next)
      setShowErrors(false)
      toast('บันทึกแล้ว', 'success')
    } catch (e) {
      console.error('save shop failed', e)
      toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack">
      <Card title="ชื่อร้าน">
        <Field label="ชื่อร้าน" hint="แสดงบนหน้าเข้าสู่ระบบและสรุปยอดที่ส่ง LINE" error={showErrors && errors.name}>
          <input className="input" value={f.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
        </Field>
      </Card>

      <div className="settings-split">
        <Card title="พร้อมเพย์">
          <div className="stack">
            <Field
              label="เบอร์ / เลขบัตร / e-Wallet"
              hint={pp.valid ? pp.typeLabel : 'ไม่ใส่ก็ได้ ถ้าไม่ใส่จะไม่มี QR ตอนรับโอน'}
              error={pp.error}
            >
              <input
                className="input"
                inputMode="numeric"
                autoComplete="off"
                value={f.promptPayId}
                maxLength={20}
                placeholder="เช่น 0812345678"
                onChange={(e) => set('promptPayId', e.target.value)}
              />
            </Field>
            <Field label="ชื่อบัญชี" hint="แสดงใต้ QR ให้ลูกค้าตรวจก่อนโอน">
              <input
                className="input"
                value={f.promptPayName}
                maxLength={60}
                placeholder="เช่น นางสาว ใจดี มีสุข"
                onChange={(e) => set('promptPayName', e.target.value)}
              />
            </Field>
          </div>
        </Card>
        <div className="settings-qr" aria-live="polite">
          {pp.valid ? (
            <>
              <span className="settings-qr-title">ตัวอย่าง QR ของร้าน</span>
              <QrCode text={promptPayPayload(pp.digits)} size={200} label="QR พร้อมเพย์ของร้าน" />
              <span className="settings-qr-sub num">{formatPromptPayTarget(pp.digits)}</span>
              {f.promptPayName.trim() && <span className="settings-qr-sub">{f.promptPayName.trim()}</span>}
              <span className="settings-qr-sub">ตอนขาย ระบบจะใส่ยอดเงินใน QR ให้เอง ลองสแกนด้วยแอปธนาคารเพื่อตรวจชื่อบัญชี</span>
            </>
          ) : (
            <span className="settings-qr-sub">{f.promptPayId.trim() ? 'ตรวจเลขพร้อมเพย์ให้ถูกต้องก่อน จะแสดง QR ตรงนี้' : 'ใส่เลขพร้อมเพย์ จะแสดงตัวอย่าง QR ตรงนี้'}</span>
          )}
        </div>
      </div>

      <Card title="วิธีรับเงิน">
        <div className="stack-sm">
          <p className="settings-note">เงินสดและโอน / QR เปิดใช้ตลอด</p>
          <Toggle
            checked={f.halfHalfEnabled === 1}
            onChange={(v) => set('halfHalfEnabled', v ? 1 : 0)}
            label="รับคนละครึ่ง"
            hint="แสดงปุ่มคนละครึ่งตอนรับเงิน ร้านรับผ่านแอปถุงเงิน"
          />
          <Toggle
            checked={f.otherPayEnabled === 1}
            onChange={(v) => set('otherPayEnabled', v ? 1 : 0)}
            label="วิธีจ่ายอื่น"
            hint="เช่น บัตรเครดิต บัตรสวัสดิการ"
          />
          {f.otherPayEnabled === 1 && (
            <Field label="ชื่อที่แสดงบนปุ่ม" error={showErrors && errors.otherLabel}>
              <input className="input" value={f.otherPayLabel} maxLength={24} placeholder="เช่น บัตรเครดิต" onChange={(e) => set('otherPayLabel', e.target.value)} />
            </Field>
          )}
        </div>
      </Card>

      <Card title="ความปลอดภัย">
        <Toggle
          checked={f.voidNeedsOwner === 1}
          onChange={(v) => set('voidNeedsOwner', v ? 1 : 0)}
          label="ยกเลิกบิลต้องใช้ PIN เจ้าของ"
          hint="คนขายยกเลิกบิลเองไม่ได้ ต้องให้เจ้าของใส่ PIN อนุมัติ"
        />
      </Card>

      <div className={cx('settings-savebar', dirty && 'is-dirty')}>
        {dirty && <span className="settings-savebar-text">มีการแก้ไขที่ยังไม่บันทึก</span>}
        {dirty && (
          <Button
            onClick={() => {
              setF(base)
              setShowErrors(false)
            }}
            disabled={saving}
          >
            คืนค่าเดิม
          </Button>
        )}
        <Button variant="primary" size="lg" onClick={() => void saveForm()} loading={saving} disabled={!dirty}>
          บันทึก
        </Button>
      </div>
    </div>
  )
}
