// Modals used while building a bill: custom price (ราคาอื่น), quantity, and discount (ลูกค้าต่อ).
import { useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { customLine, type CartLine } from '../../domain/pricing'
import { baht, round2 } from '../../lib/format'
import { Button, IconButton, Modal, NumPad, Segmented, parseMoney } from '../../ui'
import { roundDownDiscount } from './util'

// ---------- custom price ----------

const OTHER_NAME = 'อื่นๆ'
const DEFAULT_UNIT = 'ชิ้น'

interface CustomProps {
  /** Category names of the booth's price buttons (in button order, unique). */
  names: string[]
  /** Unit of each category name, e.g. 'ผ้าใบ' → 'คู่'. */
  unitByName: Map<string, string>
  onAdd: (line: CartLine) => void
  onClose: () => void
}

export function CustomPriceModal({ names, unitByName, onAdd, onClose }: CustomProps) {
  const [text, setText] = useState('')
  const [qty, setQty] = useState(1)
  const [name, setName] = useState(OTHER_NAME)
  const price = parseMoney(text) ?? 0
  const valid = price > 0 && qty > 0
  const unit = unitByName.get(name) ?? DEFAULT_UNIT
  const lineTotal = round2(price * qty)

  const add = () => {
    if (!valid) return
    const line = customLine(name, price, unit)
    onAdd({ ...line, qty })
  }

  const choices = [OTHER_NAME, ...names.filter((n) => n !== OTHER_NAME)]
  // Focus the amount (not the close button) so a keyboard's Enter adds the item.
  const focusRef = useRef<HTMLDivElement>(null)

  return (
    <Modal
      open
      onClose={onClose}
      title="ราคาอื่น"
      className="pos-modal"
      initialFocus={focusRef}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            กลับ
          </Button>
          <Button variant="primary" size="lg" disabled={!valid} onClick={add}>
            {valid ? `ใส่ตะกร้า ฿${baht(lineTotal)}` : 'ใส่ตะกร้า'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="pos-custom-top">
          <div className="pos-display" aria-live="polite" ref={focusRef} tabIndex={-1}>
            <span className="pos-display-label">ราคาต่อ{unit}</span>
            <span className={'pos-display-value num' + (text ? ' tone-price' : ' muted')}>฿{text ? baht(price) : '0'}</span>
          </div>
          <div className="pos-qty-box">
            <span className="pos-display-label">จำนวน</span>
            <div className="pos-stepper">
              <IconButton
                label="ลดจำนวน"
                icon={<Minus size={22} />}
                variant="secondary"
                disabled={qty <= 1}
                onClick={() => setQty((q) => Math.max(1, q - 1))}
              />
              <span className="pos-stepper-qty static num" aria-live="polite">
                {qty}
              </span>
              <IconButton
                label="เพิ่มจำนวน"
                icon={<Plus size={22} />}
                variant="secondary"
                disabled={qty >= 999}
                onClick={() => setQty((q) => Math.min(999, q + 1))}
              />
            </div>
          </div>
        </div>
        <div className="pos-chip-scroll" role="group" aria-label="ของอะไร">
          {choices.map((n) => (
            <button
              key={n}
              type="button"
              className={'chip' + (n === name ? ' active' : '')}
              aria-pressed={n === name}
              onClick={() => setName(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <NumPad value={text} onChange={setText} maxLength={6} onEnter={add} />
      </div>
    </Modal>
  )
}

// ---------- quantity ----------

interface QtyProps {
  line: CartLine
  onSet: (qty: number) => void
  onClose: () => void
}

export function QtyModal({ line, onSet, onClose }: QtyProps) {
  const [text, setText] = useState('')
  const qty = text === '' ? null : Number.parseInt(text, 10)
  const remove = qty === 0
  const ok = () => {
    if (qty === null || !Number.isFinite(qty)) return
    onSet(qty)
  }
  const focusRef = useRef<HTMLDivElement>(null)
  return (
    <Modal
      open
      onClose={onClose}
      title={`${line.name} ${baht(line.price)}`}
      className="pos-modal"
      initialFocus={focusRef}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            กลับ
          </Button>
          <Button variant={remove ? 'danger' : 'primary'} size="lg" disabled={qty === null} onClick={ok}>
            {remove ? 'เอาออก' : 'ตกลง'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="pos-display" aria-live="polite" ref={focusRef} tabIndex={-1}>
          <span className="pos-display-label">จำนวน ({line.unit})</span>
          <span className={'pos-display-value num' + (text ? '' : ' muted')}>{text || line.qty}</span>
        </div>
        <NumPad value={text} onChange={setText} maxLength={3} onEnter={ok} />
      </div>
    </Modal>
  )
}

// ---------- discount ----------

type DiscountMode = 'amount' | 'final'

interface DiscountProps {
  /** Bill amount before the manual discount (after quantity promos). */
  base: number
  current: number
  onApply: (discount: number) => void
  onClose: () => void
}

const QUICK_DISCOUNTS = [5, 10, 20, 50]

export function DiscountModal({ base, current, onApply, onClose }: DiscountProps) {
  const [mode, setMode] = useState<DiscountMode>('amount')
  const [text, setText] = useState(() => (current > 0 ? String(Math.min(current, base)) : ''))
  const entered = parseMoney(text)
  const rounding = roundDownDiscount(base)

  let discount = 0
  let error = ''
  if (entered !== null) {
    if (mode === 'amount') {
      discount = entered
      if (entered > base) error = `ลดได้ไม่เกิน ฿${baht(base)}`
    } else {
      discount = round2(base - entered)
      if (entered > base) error = `ราคาต้องไม่เกิน ฿${baht(base)}`
    }
  }
  const valid = error === '' && discount >= 0
  const after = round2(base - (valid ? discount : 0))

  const pick = (v: number) => {
    setMode('amount')
    setText(String(v))
  }
  const apply = () => {
    if (!valid) return
    onApply(entered === null ? 0 : discount)
  }
  const focusRef = useRef<HTMLDivElement>(null)

  return (
    <Modal
      open
      onClose={onClose}
      title="ลด / ต่อราคา"
      className="pos-modal"
      initialFocus={focusRef}
      footer={
        <>
          <Button size="lg" onClick={() => onApply(0)}>
            ไม่ลด
          </Button>
          <Button variant="primary" size="lg" disabled={!valid} onClick={apply}>
            ใช้ราคานี้
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <div className="pos-discount-sum" aria-live="polite" ref={focusRef} tabIndex={-1}>
          <div className="pos-sum-row">
            <span>ยอดเดิม</span>
            <span className="money num">฿{baht(base)}</span>
          </div>
          <div className="pos-discount-entry">
            <span className="pos-display-label">{mode === 'amount' ? 'ลูกค้าต่อ ลดให้' : 'ตกลงขายที่'}</span>
            <span className={'pos-display-value num' + (text ? (mode === 'amount' ? ' tone-warning' : '') : ' muted')}>
              {mode === 'amount' && text ? '−' : ''}฿{text ? baht(entered ?? 0) : '0'}
            </span>
          </div>
          <div className="pos-sum-row pos-discount-after">
            <span>{mode === 'amount' ? 'เหลือ' : 'ลดให้'}</span>
            <span className="money num">
              {mode === 'amount' ? `฿${baht(after)}` : `−฿${baht(valid ? discount : 0)}`}
            </span>
          </div>
          {error && (
            <p className="pos-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="pos-discount-chips" role="group" aria-label="ลดเร็ว">
          {QUICK_DISCOUNTS.map((v) => (
            <button
              key={v}
              type="button"
              className={'chip' + (mode === 'amount' && entered === v ? ' active' : '')}
              aria-pressed={mode === 'amount' && entered === v}
              aria-label={`ลด ${v} บาท`}
              disabled={v >= base}
              onClick={() => pick(v)}
            >
              −{v}
            </button>
          ))}
          <button
            type="button"
            className={'chip' + (mode === 'amount' && rounding > 0 && entered === rounding ? ' active' : '')}
            aria-pressed={mode === 'amount' && rounding > 0 && entered === rounding}
            aria-label={rounding > 0 ? `ปัดเศษ ลด ${baht(rounding)} บาท` : 'ปัดเศษ'}
            disabled={rounding <= 0}
            onClick={() => pick(rounding)}
          >
            ปัดเศษ
          </button>
        </div>
        <Segmented<DiscountMode>
          block
          aria-label="ใส่แบบไหน"
          value={mode}
          onChange={(m) => {
            setMode(m)
            setText('')
          }}
          options={[
            { value: 'amount', label: 'ลดกี่บาท' },
            { value: 'final', label: 'ขายกี่บาท' },
          ]}
        />
        <NumPad value={text} onChange={setText} maxLength={7} onEnter={apply} />
      </div>
    </Modal>
  )
}
