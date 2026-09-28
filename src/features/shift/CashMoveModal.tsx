// เงินออก / เงินเข้า sheet: preset chips, amount, reason, expense category (cash-out only).
import { useId, useRef, useState, type FormEvent } from 'react'
import { CASH_IN_PRESETS, CASH_OUT_PRESETS, EXPENSE_CATEGORY_LABEL } from '../../constants'
import { bahtSign, round2 } from '../../lib/format'
import type { ExpenseCategory, Shift } from '../../types'
import { Button, Field, Modal, MoneyInput, cx, useToast } from '../../ui'
import { addCashMove, isShiftError } from './shiftData'

type MoveType = 'in' | 'out'

interface Preset {
  reason: string
  category: ExpenseCategory | null
}

const CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORY_LABEL) as ExpenseCategory[]

export interface CashMoveModalProps {
  /** null = closed */
  type: MoveType | null
  shift: Shift
  staffId: string
  /** cash that should be in the drawer now (warns when taking out more) */
  expectedCash: number
  onClose: () => void
}

export function CashMoveModal(props: CashMoveModalProps) {
  if (!props.type) return null
  return <CashMoveSheet {...props} type={props.type} />
}

function CashMoveSheet({ type, shift, staffId, expectedCash, onClose }: CashMoveModalProps & { type: MoveType }) {
  const toast = useToast()
  const formId = useId()
  const amountRef = useRef<HTMLInputElement>(null)
  const [amount, setAmount] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState<ExpenseCategory | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const out = type === 'out'
  const presets: Preset[] = out ? CASH_OUT_PRESETS : CASH_IN_PRESETS.map((r) => ({ reason: r, category: null }))

  const choose = (p: Preset) => {
    setReason(p.reason)
    setReasonError(null)
    if (out) setCategory(p.category)
    if (amount === null) requestAnimationFrame(() => amountRef.current?.focus())
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy) return
    const a = amount === null ? 0 : round2(amount)
    const r = reason.trim()
    let ok = true
    if (!(a > 0)) {
      setAmountError('ใส่จำนวนเงิน')
      ok = false
    }
    if (!r) {
      setReasonError('ใส่รายละเอียด หรือกดเลือกด้านบน')
      ok = false
    }
    if (!ok) return
    setBusy(true)
    try {
      await addCashMove({ shiftId: shift.id, staffId, type, amount: a, reason: r, category: out ? category : null })
      toast(`บันทึก${out ? 'เงินออก' : 'เงินเข้า'} ${bahtSign(a)} แล้ว`, 'success')
      onClose()
    } catch (err) {
      if (isShiftError(err, 'not_open')) {
        toast('รอบนี้ปิดยอดไปแล้ว บันทึกไม่ได้', 'error')
        onClose()
      } else {
        console.error('cash move failed', err)
        toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error')
        setBusy(false)
      }
    }
  }

  const overDrawer = out && amount !== null && round2(amount) > round2(expectedCash)

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={out ? 'เงินออกจากลิ้นชัก' : 'เงินเข้าลิ้นชัก'}
      footer={
        <>
          <Button size="lg" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" form={formId} variant="primary" size="lg" loading={busy}>
            บันทึก
          </Button>
        </>
      }
    >
      <form id={formId} className="stack" onSubmit={(e) => void submit(e)}>
        <div className="stack-sm">
          <span className="shift-label">{out ? 'เอาเงินไปทำอะไร' : 'เงินอะไร'}</span>
          <div className="shift-chips" role="group" aria-label="เลือกรายการที่ใช้บ่อย">
            {presets.map((p) => {
              const active = reason.trim() === p.reason
              return (
                <button
                  key={p.reason}
                  type="button"
                  className={cx('chip', active && 'active')}
                  aria-pressed={active}
                  onClick={() => choose(p)}
                >
                  {p.reason}
                </button>
              )
            })}
          </div>
        </div>

        <Field label="จำนวนเงิน" error={amountError}>
          <MoneyInput
            ref={amountRef}
            value={amount}
            onChange={(n) => {
              setAmount(n)
              if (n !== null && n > 0) setAmountError(null)
            }}
          />
        </Field>
        {overDrawer && (
          <p className="shift-inline-warn" role="status">
            มากกว่าเงินสดที่ควรมีในลิ้นชักตอนนี้ ({bahtSign(expectedCash)}) ตรวจจำนวนอีกครั้ง
          </p>
        )}

        <Field label="รายละเอียด" error={reasonError}>
          <input
            className="input"
            value={reason}
            maxLength={80}
            enterKeyHint="done"
            placeholder={out ? 'เช่น ค่าข้าว ซื้อถุง' : 'เช่น เติมเงินทอน'}
            onChange={(e) => {
              setReason(e.target.value)
              if (e.target.value.trim()) setReasonError(null)
            }}
          />
        </Field>

        {out && (
          <Field label="นับเป็นค่าใช้จ่ายร้าน" hint="เลือกหมวดถ้าเป็นค่าใช้จ่าย จะไปรวมในรายงานกำไร">
            <select
              className="select"
              value={category ?? ''}
              onChange={(e) => setCategory(e.target.value ? (e.target.value as ExpenseCategory) : null)}
            >
              <option value="">ไม่ใช่ค่าใช้จ่าย (เช่น เจ้าของเก็บเงิน)</option>
              {CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {EXPENSE_CATEGORY_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        )}
      </form>
    </Modal>
  )
}
