// One bill: full details and voiding (ยกเลิกบิล) with an owner PIN when the shop requires it.
import { useEffect, useState } from 'react'
import { Ban, Lock, TriangleAlert } from 'lucide-react'
import { VOID_REASONS } from '../../constants'
import { clearPinLock, pinLockSeconds, registerWrongPin } from '../auth/pinLock'
import { LOGIN_MAX_TRIES } from '../settings/logic'
import { baht, dateTime, timeHM } from '../../lib/format'
import { findOwnerByPin } from '../../session'
import type { ID, Sale, Shift, ShopConfig } from '../../types'
import { Badge, Button, Field, Modal, Money, PinPad, useToast } from '../../ui'
import { posErrorText, voidSale } from './saleService'
import { METHOD_TONE, methodLabel, promoText } from './util'

interface Props {
  sale: Sale
  /** The bill's shift; undefined when it is not on this device (treated as closed). */
  shift: Shift | undefined
  shop: ShopConfig | undefined
  boothName: string
  staffName: (id: ID | null) => string
  isOwner: boolean
  sessionStaffId: ID
  /** PIN lengths of active owners (for the PIN pad). */
  ownerPinLengths: number[]
  onClose: () => void
}

type Step = 'view' | 'reason' | 'pin'

const OTHER_REASON = 'อื่นๆ'

export default function BillDetailModal({
  sale,
  shift,
  shop,
  boothName,
  staffName,
  isOwner,
  sessionStaffId,
  ownerPinLengths,
  onClose,
}: Props) {
  const toast = useToast()
  const [step, setStep] = useState<Step>('view')
  const [reason, setReason] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinTries, setPinTries] = useState(0)
  const [busy, setBusy] = useState(false)
  // Wrong owner PINs share the login screen's cooldown (5 wrong → wait 30 s).
  const [lockSec, setLockSec] = useState(() => pinLockSeconds())

  useEffect(() => {
    if (step !== 'pin' || lockSec <= 0) return
    const t = window.setInterval(() => {
      const left = pinLockSeconds()
      setLockSec(left)
      if (left <= 0) setPinError(null)
    }, 500)
    return () => window.clearInterval(t)
  }, [step, lockSec])

  const isPaid = sale.status === 'paid'
  const shiftClosed = !shift || shift.status === 'closed'
  const blocked = shiftClosed && !isOwner
  const needsPin = shop?.voidNeedsOwner === 1 && !isOwner
  const noteRequired = reason === OTHER_REASON
  const reasonReady = reason !== null && (!noteRequired || note.trim() !== '')
  const reasonText = reason ? (note.trim() ? `${reason} · ${note.trim()}` : reason) : ''
  const pinLen = ownerPinLengths.length ? Math.max(...ownerPinLengths) : 4

  const doVoid = async (approverId: ID) => {
    if (busy) return
    setBusy(true)
    try {
      await voidSale(sale.id, reasonText, approverId)
      toast(`ยกเลิกบิล #${sale.billNo} แล้ว`, 'success')
      onClose()
    } catch (e) {
      console.error('[pos] void failed', e)
      toast(posErrorText(e), 'error')
      setBusy(false)
    }
  }

  const submitReason = () => {
    if (!reasonReady || busy) return
    if (needsPin) {
      setPinError(null)
      setStep('pin')
    } else {
      void doVoid(sessionStaffId)
    }
  }

  const checkPin = async (pin: string, final: boolean) => {
    if (busy || pinLockSeconds() > 0) return
    const owner = await findOwnerByPin(pin)
    if (owner) {
      clearPinLock()
      setPinError(null)
      await doVoid(owner.id)
    } else if (final) {
      const lock = registerWrongPin()
      if (lock.until) {
        setLockSec(pinLockSeconds())
        setPinError(`ใส่ PIN ผิด ${LOGIN_MAX_TRIES} ครั้ง รอสักครู่แล้วลองใหม่`)
      } else {
        setPinError('PIN ไม่ถูกต้อง')
      }
      setPinTries((n) => n + 1)
    }
  }

  // ---------- step: owner PIN ----------
  if (step === 'pin')
    return (
      <Modal
        open
        onClose={onClose}
        title={`ยกเลิกบิล #${sale.billNo}`}
        className="pos-modal"
        closeOnBackdrop={false}
        footer={
          <Button size="lg" onClick={() => setStep('reason')} disabled={busy}>
            กลับ
          </Button>
        }
      >
        <div className="stack">
          <p className="pos-pin-hint">
            <Lock size={18} aria-hidden="true" /> ให้เจ้าของร้านใส่ PIN เพื่อยืนยันการยกเลิก
          </p>
          <PinPad
            length={pinLen}
            title={lockSec > 0 ? `ลองใหม่ได้ใน ${lockSec} วินาที` : null}
            error={pinError}
            errorKey={pinTries}
            disabled={busy || lockSec > 0}
            onChange={(pin) => {
              // Owners with a shorter PIN than the pad length are matched as soon as it fits.
              if (pin.length < pinLen && ownerPinLengths.includes(pin.length)) void checkPin(pin, false)
            }}
            onComplete={(pin) => void checkPin(pin, true)}
          />
        </div>
      </Modal>
    )

  // ---------- step: reason ----------
  if (step === 'reason')
    return (
      <Modal
        open
        onClose={onClose}
        title={`ยกเลิกบิล #${sale.billNo}`}
        className="pos-modal"
        closeOnBackdrop={false}
        footer={
          <>
            <Button size="lg" onClick={() => setStep('view')} disabled={busy}>
              กลับ
            </Button>
            <Button variant="danger" size="lg" disabled={!reasonReady} loading={busy} onClick={submitReason}>
              {needsPin ? 'ต่อไป' : 'ยกเลิกบิล'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <div className="pos-void-head">
            <span>
              บิล #{sale.billNo} · {timeHM(sale.createdAt)} · {methodLabel(sale.method, shop)}
            </span>
            <Money value={sale.total} size="lg" />
          </div>
          <div className="stack-sm" role="radiogroup" aria-label="เหตุผลที่ยกเลิก">
            <span className="field-label">ยกเลิกเพราะอะไร</span>
            {VOID_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                className={'pos-reason' + (reason === r ? ' active' : '')}
                onClick={() => setReason(r)}
              >
                <span className="pos-reason-dot" aria-hidden="true" />
                {r}
              </button>
            ))}
          </div>
          <Field
            label={noteRequired ? 'เล่าสั้นๆ ว่าเกิดอะไรขึ้น' : 'หมายเหตุ (ไม่ใส่ก็ได้)'}
            required={noteRequired}
          >
            <input
              className="input"
              value={note}
              maxLength={120}
              onChange={(e) => setNote(e.target.value)}
              placeholder={noteRequired ? 'เช่น ลูกค้าขอเปลี่ยนไซส์' : ''}
            />
          </Field>
          {shiftClosed && isOwner && (
            <div className="pos-note warning">
              <TriangleAlert size={20} aria-hidden="true" />
              <div>
                <strong>กะนี้ปิดยอดไปแล้ว</strong>
                <p>ยอดที่ปิดไว้จะไม่เปลี่ยน แต่รายงานจะไม่นับบิลนี้ ถ้าคืนเงินสดจากลิ้นชักตอนนี้ ให้จดเงินออกที่หน้าปิดยอดด้วย</p>
              </div>
            </div>
          )}
          <p className="muted pos-small">ยกเลิกแล้วย้อนกลับไม่ได้ ยอดของบิลนี้จะไม่นับเป็นยอดขาย</p>
        </div>
      </Modal>
    )

  // ---------- step: view ----------
  const canVoid = isPaid && !blocked
  return (
    <Modal
      open
      onClose={onClose}
      title={`บิล #${sale.billNo}`}
      className="pos-modal"
      footer={
        canVoid ? (
          <>
            <Button size="lg" onClick={onClose}>
              ปิด
            </Button>
            <Button variant="danger" size="lg" icon={<Ban size={20} />} onClick={() => setStep('reason')}>
              ยกเลิกบิล
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="stack">
        <div className="pos-bill-info">
          <div className="row">
            <Badge tone={METHOD_TONE[sale.method] ?? 'neutral'}>{methodLabel(sale.method, shop)}</Badge>
            {!isPaid && <Badge tone="danger">ยกเลิกแล้ว</Badge>}
          </div>
          <span className="text-2">{dateTime(sale.createdAt)}</span>
          <span className="text-2">
            {boothName} · ขายโดย {staffName(sale.staffId)}
          </span>
        </div>

        {!isPaid && (
          <div className="pos-note danger">
            <Ban size={20} aria-hidden="true" />
            <div>
              <strong>ยกเลิกแล้ว{sale.voidReason ? ` · ${sale.voidReason}` : ''}</strong>
              <p>
                {sale.voidedAt ? dateTime(sale.voidedAt) : ''}
                {sale.voidedBy ? ` · โดย ${staffName(sale.voidedBy)}` : ''}
              </p>
            </div>
          </div>
        )}

        <ul className={'pos-detail-items' + (isPaid ? '' : ' pos-struck-all')}>
          {sale.items.map((it, i) => {
            const promo = promoText(it.promoQty, it.promoPrice, it.unit)
            const promoUsed = it.lineTotal < it.fullTotal
            return (
              <li key={i} className="pos-detail-item">
                <div className="pos-detail-main">
                  <span className="pos-detail-name">
                    {it.name}
                    {it.tierId === null && <span className="muted"> (ราคาอื่น)</span>}
                  </span>
                  <span className="muted num">
                    {baht(it.price)} × {it.qty} {it.unit}
                    {promoUsed && promo ? ` · โปร ${promo}` : ''}
                  </span>
                </div>
                <div className="pos-detail-amt">
                  <Money value={it.lineTotal} />
                  {promoUsed && <s className="muted num pos-small">฿{baht(it.fullTotal)}</s>}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="pos-summary">
          <div className="pos-sum-row">
            <span>รวม {sale.pieces} ชิ้น</span>
            <Money value={sale.subtotal} />
          </div>
          {sale.promoDiscount > 0 && (
            <div className="pos-sum-row tone-success">
              <span>ลดตามโปร</span>
              <span className="money num">−฿{baht(sale.promoDiscount)}</span>
            </div>
          )}
          {sale.manualDiscount > 0 && (
            <div className="pos-sum-row tone-warning">
              <span>ลูกค้าต่อ</span>
              <span className="money num">−฿{baht(sale.manualDiscount)}</span>
            </div>
          )}
          <div className="pos-sum-total">
            <span className="pos-sum-total-label">ยอดสุทธิ</span>
            <Money value={sale.total} size="xl" className={isPaid ? '' : 'pos-struck'} />
          </div>
          {sale.method === 'cash' && sale.cashReceived != null && (
            <div className="pos-sum-row">
              <span>
                รับมา <span className="num">฿{baht(sale.cashReceived)}</span>
              </span>
              <span>
                ทอน <strong className="num">฿{baht(sale.change ?? 0)}</strong>
              </span>
            </div>
          )}
        </div>

        {isPaid && blocked && (
          <div className="pos-note">
            <Lock size={20} aria-hidden="true" />
            <div>
              <strong>ปิดยอดไปแล้ว</strong>
              <p>บิลนี้อยู่ในกะที่ปิดยอดแล้ว ยกเลิกได้เฉพาะเจ้าของร้าน</p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
