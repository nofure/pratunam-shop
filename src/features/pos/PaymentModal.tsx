// Taking the money: cash (with change), PromptPay QR, คนละครึ่ง, or the shop's "other" method.
import { useRef, useState } from 'react'
import { Keyboard, TriangleAlert } from 'lucide-react'
import { cashChange, quickCashOptions } from '../../domain/pricing'
import { baht } from '../../lib/format'
import { formatPromptPayTarget, isValidPromptPayTarget, promptPayPayload } from '../../lib/promptpay'
import type { PayMethod, ShopConfig } from '../../types'
import { Button, Modal, Money, NumPad, QrCode, parseMoney } from '../../ui'
import { methodLabel } from './util'

interface Props {
  method: PayMethod
  total: number
  pieces: number
  shop: ShopConfig
  saving: boolean
  /** cashReceived: amount handed over (cash only; null = exact). */
  onConfirm: (cashReceived: number | null) => void
  onClose: () => void
}

const TITLE: Record<PayMethod, string> = {
  cash: 'รับเงินสด',
  transfer: 'โอน / สแกน QR',
  halfhalf: 'คนละครึ่ง',
  other: '',
}

export default function PaymentModal(props: Props) {
  const { method, shop } = props
  const title = method === 'other' ? methodLabel('other', shop) : TITLE[method]
  if (method === 'cash') return <CashPayment {...props} title={title} />
  return <OtherPayment {...props} title={title} />
}

function OtherPayment(props: Props & { title: string }) {
  const { method, title, onClose } = props
  // Enter on a keyboard confirms (the close button would otherwise take the first focus).
  const confirmRef = useRef<HTMLButtonElement>(null)
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      className="pos-modal pos-pay-modal"
      closeOnBackdrop={false}
      initialFocus={confirmRef}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            กลับ
          </Button>
          <Button ref={confirmRef} variant="primary" size="xl" loading={props.saving} onClick={() => props.onConfirm(null)}>
            {method === 'transfer' ? 'เงินเข้าแล้ว' : 'รับเงินแล้ว'}
          </Button>
        </>
      }
    >
      {method === 'transfer' ? <TransferBody {...props} /> : <SimpleBody {...props} />}
    </Modal>
  )
}

// ---------- cash ----------

function tallScreen(): boolean {
  try {
    return window.matchMedia('(min-height: 760px)').matches
  } catch {
    return false
  }
}

function CashPayment({ total, pieces, saving, onConfirm, onClose, title }: Props & { title: string }) {
  // '' = customer paid the exact amount.
  const [text, setText] = useState('')
  const [fromQuick, setFromQuick] = useState(false)
  const [padOpen, setPadOpen] = useState(tallScreen)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const typed = text === '' ? null : parseMoney(text)
  const received = typed ?? total
  const change = cashChange(total, received)
  const short = change < 0
  const options = quickCashOptions(total)

  const confirm = () => {
    if (short || saving) return
    onConfirm(received)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      className="pos-modal pos-pay-modal"
      closeOnBackdrop={false}
      initialFocus={confirmRef}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            กลับ
          </Button>
          <Button ref={confirmRef} variant="primary" size="xl" loading={saving} disabled={short} onClick={confirm}>
            รับเงินแล้ว
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="pos-due">
          <span className="pos-due-label">ยอดที่ต้องจ่าย · {pieces} ชิ้น</span>
          <Money value={total} size="xl" />
        </div>
        <div className="pos-cash-grid">
          <div className="pos-cash-box">
            <span className="pos-display-label">รับมา</span>
            {typed === null ? (
              <span className="pos-cash-value muted">พอดี</span>
            ) : (
              <span className="pos-cash-value num">฿{baht(received)}</span>
            )}
          </div>
          <div className={'pos-cash-box' + (short ? ' short' : change > 0 ? ' change' : '')} aria-live="polite">
            <span className="pos-display-label">{short ? 'เงินไม่พอ' : 'ทอน'}</span>
            {short ? (
              <span className="pos-cash-value num">ขาด ฿{baht(-change)}</span>
            ) : change > 0 ? (
              <span className="pos-cash-value num">฿{baht(change)}</span>
            ) : (
              <span className="pos-cash-value muted">ไม่ต้องทอน</span>
            )}
          </div>
        </div>
        <div className="pos-quick-cash" role="group" aria-label="รับมาเท่าไร">
          {options.map((v, i) => {
            const active = typed === null ? i === 0 : typed === v
            return (
              <button
                key={v}
                type="button"
                className={'pos-quick' + (active ? ' active' : '')}
                aria-pressed={active}
                onClick={() => {
                  setText(i === 0 ? '' : String(v))
                  setFromQuick(true)
                }}
              >
                {i === 0 ? 'พอดี' : <span className="num">฿{baht(v)}</span>}
              </button>
            )
          })}
        </div>
        {padOpen ? (
          <NumPad
            value={fromQuick ? '' : text}
            onChange={(s) => {
              setFromQuick(false)
              setText(s)
            }}
            maxLength={7}
            onEnter={confirm}
          />
        ) : (
          <Button icon={<Keyboard size={20} />} onClick={() => setPadOpen(true)} block>
            ใส่จำนวนเงินเอง
          </Button>
        )}
      </div>
    </Modal>
  )
}

// ---------- transfer / QR ----------

function TransferBody({ total, shop }: Props) {
  const id = shop.promptPayId ?? ''
  const valid = isValidPromptPayTarget(id)
  if (!valid)
    return (
      <div className="stack pos-center">
        <div className="pos-due">
          <span className="pos-due-label">ยอดโอน</span>
          <Money value={total} size="xl" />
        </div>
        <div className="pos-note warning">
          <TriangleAlert size={22} aria-hidden="true" />
          <div>
            <strong>ร้านยังไม่ได้ตั้งพร้อมเพย์</strong>
            <p>ให้ลูกค้าโอนเข้าบัญชีร้านตามปกติ เช็กว่าเงินเข้าแล้วจึงกดยืนยัน</p>
            <p className="muted">เจ้าของตั้งพร้อมเพย์ได้ที่ เมนู → ตั้งค่า → ร้าน แล้ว QR จะขึ้นพร้อมยอดให้เอง</p>
          </div>
        </div>
      </div>
    )
  return (
    <div className="stack-sm pos-center pos-qr">
      <span className="pos-qr-brand">พร้อมเพย์</span>
      {total > 0 ? (
        <QrCode text={promptPayPayload(id, total)} size={260} label={`QR พร้อมเพย์ ยอด ${baht(total)} บาท`} className="pos-qr-code" />
      ) : (
        <p className="muted">ยอดเป็น 0 ไม่ต้องสแกน</p>
      )}
      {shop.promptPayName && <span className="pos-qr-name">{shop.promptPayName}</span>}
      <span className="muted num">{formatPromptPayTarget(id)}</span>
      <Money value={total} size="xl" />
      <p className="pos-qr-hint">ให้ลูกค้าสแกน ยอดใส่ไว้ให้แล้ว</p>
      <p className="muted pos-small">ดูแจ้งเตือนเงินเข้าในแอปธนาคารก่อนกด "เงินเข้าแล้ว"</p>
    </div>
  )
}

// ---------- คนละครึ่ง / other ----------

function SimpleBody({ method, total, shop }: Props) {
  return (
    <div className="stack pos-center">
      <div className="pos-due">
        <span className="pos-due-label">{method === 'halfhalf' ? 'ยอดที่ต้องได้รับ' : methodLabel('other', shop)}</span>
        <Money value={total} size="xl" />
      </div>
      {method === 'halfhalf' ? (
        <p className="pos-qr-hint">
          รับเงินในแอปถุงเงิน ยอด <span className="num">{baht(total)}</span> บาท
        </p>
      ) : (
        <p className="pos-qr-hint">
          รับชำระแบบ{methodLabel('other', shop)} ยอด <span className="num">{baht(total)}</span> บาท
        </p>
      )}
      <p className="muted pos-small">เช็กว่าได้รับเงินแล้วจึงกดยืนยัน</p>
    </div>
  )
}
