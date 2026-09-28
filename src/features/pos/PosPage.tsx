// ขาย — the screen sellers use all day: price buttons → cart → take the money.
import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronRight, ChevronUp, ReceiptText, ShoppingBasket, Store, TriangleAlert } from 'lucide-react'
import { alive, db } from '../../db'
import { useDevice } from '../../device'
import { useCurrentBooth, useOpenShift, useShop, useTiers } from '../../hooks'
import { useSession } from '../../session'
import { addLine, computeCart, lineFromTier, setLineQty, type CartLine } from '../../domain/pricing'
import { todayKey } from '../../lib/dates'
import { baht, bahtSign, thaiDateShort, timeHM } from '../../lib/format'
import type { Booth, ID, PayMethod, Shift, ShopConfig, Tier } from '../../types'
import { Button, EmptyState, Modal, Money, Spinner, useConfirm, useToast } from '../../ui'
import { clearCart, useCart } from './cartStore'
import { CartLines, CartSummary, PayButtons } from './CartView'
import { CustomPriceModal, DiscountModal, QtyModal } from './CartModals'
import PaymentModal from './PaymentModal'
import PosErrorBoundary from './PosErrorBoundary'
import PriceGrid from './PriceGrid'
import { posErrorText, recordSale } from './saleService'
import { useMedia, WIDE_QUERY } from './useMedia'
import { tapFeedback } from './util'
import './pos.css'

export default function PosPage() {
  return (
    <PosErrorBoundary>
      <PosScreen />
    </PosErrorBoundary>
  )
}

function PageLoading() {
  return (
    <div className="page-loading">
      <Spinner size={28} />
    </div>
  )
}

function PosScreen() {
  const { boothId } = useDevice()
  const booth = useCurrentBooth()
  const shop = useShop()
  const shift = useOpenShift(boothId)
  const tiers = useTiers(boothId)
  const { staff, isOwner } = useSession()

  if (!boothId || booth === null)
    return (
      <div className="page">
        <EmptyState icon={<Store size={28} />} title="เครื่องนี้ยังไม่ได้เลือกแผง" hint="แตะชื่อแผงด้านบนเพื่อเลือก" />
      </div>
    )

  // Live queries keep their previous result for a moment after the booth changes — wait for fresh data.
  const stale =
    (booth !== undefined && booth.id !== boothId) ||
    (shift != null && shift.boothId !== boothId) ||
    (tiers !== undefined && tiers.some((t) => t.boothId !== boothId))
  if (booth === undefined || shop === undefined || shift === undefined || tiers === undefined || stale || !staff)
    return <PageLoading />

  if (!shift) return <NoShift />

  return (
    <Register key={boothId} booth={booth} shop={shop} shift={shift} tiers={tiers} staffId={staff.id} isOwner={isOwner} />
  )
}

function NoShift() {
  return (
    <div className="page pos-noshift">
      <div className="pos-noshift-card">
        <span className="pos-noshift-icon" aria-hidden="true">
          <Store size={40} />
        </span>
        <h1 className="pos-noshift-title">ยังไม่ได้เปิดร้าน</h1>
        <p className="text-2">เปิดร้านและนับเงินทอนก่อน แล้วค่อยเริ่มขาย</p>
        <Link to="/shift" className="btn btn-primary btn-xl btn-block">
          เปิดร้าน
        </Link>
      </div>
    </div>
  )
}

/** Cart lines follow the current price buttons (the owner may have changed a price since). */
function freshLines(lines: CartLine[], tiers: Tier[]): CartLine[] {
  if (lines.length === 0) return lines
  const byId = new Map(tiers.map((t) => [t.id, t]))
  let changed = false
  const out = lines.map((l) => {
    const t = l.tierId ? byId.get(l.tierId) : undefined
    if (!t) return l
    const f = lineFromTier(t)
    if (f.name === l.name && f.unit === l.unit && f.price === l.price && f.promoQty === l.promoQty && f.promoPrice === l.promoPrice)
      return l
    changed = true
    return { ...f, key: l.key, qty: l.qty }
  })
  return changed ? out : lines
}

interface RegisterProps {
  booth: Booth
  shop: ShopConfig
  shift: Shift
  tiers: Tier[]
  staffId: ID
  isOwner: boolean
}

function Register({ booth, shop, shift, tiers, staffId, isOwner }: RegisterProps) {
  const [cart, update] = useCart(booth.id)
  const toast = useToast()
  const confirm = useConfirm()
  const wide = useMedia(WIDE_QUERY)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [discountOpen, setDiscountOpen] = useState(false)
  const [qtyKey, setQtyKey] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState<PayMethod | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const lines = useMemo(() => freshLines(cart.lines, tiers), [cart.lines, tiers])
  const totals = useMemo(() => computeCart(lines, cart.discount), [lines, cart.discount])
  const empty = totals.items.length === 0
  const baseBeforeDiscount = Math.max(0, totals.subtotal - totals.promoDiscount)

  const qtyByTier = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lines) if (l.tierId) m.set(l.tierId, (m.get(l.tierId) ?? 0) + l.qty)
    return m
  }, [lines])

  const names = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of tiers) {
      const n = t.name.trim()
      if (n && !seen.has(n)) seen.set(n, t.unit)
    }
    return seen
  }, [tiers])

  const lastBill = useLiveQuery(async () => {
    const rows = alive(await db.sales.where('shiftId').equals(shift.id).toArray())
    if (rows.length === 0) return null
    rows.sort((a, b) => b.billNo - a.billNo || b.createdAt - a.createdAt)
    return rows[0]
  }, [shift.id])

  const addTier = useCallback(
    (t: Tier) => {
      tapFeedback()
      update((c) => ({ ...c, lines: addLine(c.lines, lineFromTier(t)) }))
    },
    [update],
  )

  const setQty = useCallback(
    (key: string, qty: number) => update((c) => ({ ...c, lines: setLineQty(c.lines, key, qty) })),
    [update],
  )

  const clearAll = async () => {
    if (empty) return
    const ok = await confirm({
      title: 'ล้างตะกร้า',
      message: `เอาของ ${totals.pieces} ชิ้นออกทั้งหมด`,
      confirmText: 'ล้าง',
      danger: true,
    })
    if (!ok) return
    clearCart(booth.id)
    setSheetOpen(false)
  }

  const startPay = (m: PayMethod) => {
    if (empty) return
    setPayMethod(m)
  }

  const finishPay = async (cashReceived: number | null) => {
    if (savingRef.current || !payMethod) return
    savingRef.current = true
    setSaving(true)
    try {
      const sale = await recordSale({
        boothId: booth.id,
        staffId,
        lines,
        manualDiscount: cart.discount,
        method: payMethod,
        cashReceived,
      })
      clearCart(booth.id)
      setPayMethod(null)
      setSheetOpen(false)
      tapFeedback(30)
      const change = sale.method === 'cash' && sale.change ? ` · ทอน ${bahtSign(sale.change)}` : ''
      toast(`บันทึกบิล #${sale.billNo} · ${bahtSign(sale.total)}${change}`, 'success')
    } catch (e) {
      console.error('[pos] save sale failed', e)
      toast(posErrorText(e), 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const qtyLine = qtyKey ? lines.find((l) => l.key === qtyKey) ?? null : null
  const staleShift = shift.dayKey < todayKey()

  const cartLines = <CartLines lines={lines} onQty={setQty} onEditQty={(l) => setQtyKey(l.key)} />
  const cartSummary = (
    <CartSummary
      totals={totals}
      onDiscount={() => setDiscountOpen(true)}
      onClearDiscount={() => update((c) => ({ ...c, discount: 0 }))}
      onClear={() => void clearAll()}
    />
  )
  const payButtons = <PayButtons shop={shop} disabled={empty || saving} onPay={startPay} />

  return (
    <div className={'pos-page' + (wide ? ' wide' : '')}>
      <div className="pos-main">
        {staleShift && (
          <div className="pos-banner" role="status">
            <TriangleAlert size={22} aria-hidden="true" />
            <div className="pos-banner-text">
              <strong>ร้านเปิดค้างไว้ตั้งแต่ {thaiDateShort(shift.dayKey)}</strong>
              <span>ยังไม่ได้ปิดยอด บิลที่ขายตอนนี้จะนับเป็นของวันนั้น</span>
            </div>
            <Link to="/shift" className="btn btn-secondary pos-banner-btn">
              ปิดยอด
            </Link>
          </div>
        )}

        {lastBill && (
          <Link to="/bills" className="pos-last">
            <ReceiptText size={18} aria-hidden="true" />
            <span className="pos-last-text">
              บิลล่าสุด <strong className="num">#{lastBill.billNo}</strong>{' '}
              <span className={'num' + (lastBill.status === 'void' ? ' pos-struck' : '')}>฿{baht(lastBill.total)}</span>
              {lastBill.status === 'void' && <span className="tone-danger"> ยกเลิกแล้ว</span>}
              <span className="muted"> · {timeHM(lastBill.createdAt)}</span>
            </span>
            <ChevronRight size={18} aria-hidden="true" className="muted" />
          </Link>
        )}

        {tiers.length === 0 && (
          <EmptyState
            compact
            title="แผงนี้ยังไม่มีปุ่มราคา"
            hint={
              isOwner
                ? 'ตั้งปุ่มราคาตามป้ายราคาที่แผง ระหว่างนี้ใช้ "ราคาอื่น" ขายได้'
                : 'ให้เจ้าของเพิ่มปุ่มราคาในตั้งค่า ระหว่างนี้ใช้ "ราคาอื่น" ขายได้'
            }
            action={
              isOwner ? (
                <Link to="/settings/tiers" className="btn btn-primary">
                  ตั้งปุ่มราคา
                </Link>
              ) : undefined
            }
          />
        )}

        <PriceGrid tiers={tiers} qtyByTier={qtyByTier} onAdd={addTier} onCustom={() => setCustomOpen(true)} />
      </div>

      {wide ? (
        <aside className="pos-panel" aria-label="ตะกร้า">
          <div className="pos-panel-head">
            <ShoppingBasket size={20} aria-hidden="true" />
            <span>ตะกร้า</span>
            {!empty && <span className="pos-panel-count num">{totals.pieces} ชิ้น</span>}
          </div>
          <div className="pos-panel-lines">{cartLines}</div>
          <div className="pos-panel-foot">
            {cartSummary}
            {payButtons}
          </div>
        </aside>
      ) : (
        <div className="pos-bar">
          <button
            type="button"
            className="pos-bar-sum"
            onClick={() => {
              if (!empty) setSheetOpen(true)
            }}
            aria-label={empty ? 'ตะกร้าว่าง' : `ดูตะกร้า ${totals.pieces} ชิ้น ยอด ${baht(totals.total)} บาท`}
          >
            {empty ? (
              <span className="pos-bar-empty">แตะปุ่มราคาเพื่อขาย</span>
            ) : (
              <>
                <span className="pos-bar-pieces">
                  <ShoppingBasket size={18} aria-hidden="true" />
                  <span className="num">{totals.pieces} ชิ้น</span>
                  <ChevronUp size={18} aria-hidden="true" />
                </span>
                <Money value={totals.total} size="lg" />
              </>
            )}
          </button>
          <Button variant="primary" size="lg" className="pos-bar-pay" disabled={empty} onClick={() => setSheetOpen(true)}>
            รับเงิน
          </Button>
        </div>
      )}

      {!wide && (
        <Modal
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={empty ? 'ตะกร้า' : `ตะกร้า · ${totals.pieces} ชิ้น`}
          className="pos-sheet"
          footer={empty ? undefined : payButtons}
        >
          {cartLines}
          {!empty && cartSummary}
        </Modal>
      )}

      {customOpen && (
        <CustomPriceModal
          names={[...names.keys()]}
          unitByName={names}
          onClose={() => setCustomOpen(false)}
          onAdd={(line) => {
            tapFeedback()
            update((c) => ({ ...c, lines: addLine(c.lines, line) }))
            setCustomOpen(false)
          }}
        />
      )}

      {qtyLine && (
        <QtyModal
          line={qtyLine}
          onClose={() => setQtyKey(null)}
          onSet={(q) => {
            setQty(qtyLine.key, q)
            setQtyKey(null)
          }}
        />
      )}

      {discountOpen && (
        <DiscountModal
          base={baseBeforeDiscount}
          current={totals.manualDiscount}
          onClose={() => setDiscountOpen(false)}
          onApply={(d) => {
            update((c) => ({ ...c, discount: d }))
            setDiscountOpen(false)
          }}
        />
      )}

      {payMethod && !empty && (
        <PaymentModal
          method={payMethod}
          total={totals.total}
          pieces={totals.pieces}
          shop={shop}
          saving={saving}
          onClose={() => {
            if (!savingRef.current) setPayMethod(null)
          }}
          onConfirm={(r) => void finishPay(r)}
        />
      )}
    </div>
  )
}
