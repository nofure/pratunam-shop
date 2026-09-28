// The booth's open shift: live totals, cash in the drawer, cash moves, and the ปิดยอด button.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, History, Info, ReceiptText, Wallet } from 'lucide-react'
import { alive, db } from '../../db'
import { computeShiftTotals } from '../../domain/shift'
import { dayKeyOf, todayKey } from '../../lib/dates'
import { bahtSign, dateTime, num, thaiDate, thaiDateLong, timeHM } from '../../lib/format'
import type { Booth, CashMove, ID, Shift, ShopConfig, Staff } from '../../types'
import { Button, Card, EmptyState, Money, PageHeader, useConfirm, useToast } from '../../ui'
import { CashMoveModal } from './CashMoveModal'
import { CloseShiftModal } from './CloseShiftModal'
import { CashBreakdown, CashMoveList, DiscountLine, Loading, MethodTotals, useStaffNames } from './parts'
import { canDeleteMove, deleteCashMove, isShiftError } from './shiftData'

export function OpenShiftView({
  shift,
  booth,
  shop,
  staff,
  isOwner,
  otherOpen,
  onClosed,
}: {
  shift: Shift
  booth: Booth
  shop: ShopConfig | null | undefined
  staff: Staff
  isOwner: boolean
  /** other open shifts of this booth (only after a sync conflict) */
  otherOpen: Shift[]
  onClosed: (shiftId: ID) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const staffName = useStaffNames()
  const [moveType, setMoveType] = useState<'in' | 'out' | null>(null)
  const [closing, setClosing] = useState(false)

  const data = useLiveQuery(async () => {
    const [sales, moves] = await Promise.all([
      db.sales.where('shiftId').equals(shift.id).toArray(),
      db.cashMoves.where('shiftId').equals(shift.id).toArray(),
    ])
    return { sales: alive(sales), moves: alive(moves) }
  }, [shift.id])

  const totals = useMemo(
    () => (data ? computeShiftTotals(shift.openingFloat, data.sales, data.moves) : null),
    [data, shift.openingFloat],
  )

  const today = todayKey()
  const stale = shift.dayKey < today
  const openedSameDay = dayKeyOf(shift.openedAt) === today
  const actor = { id: staff.id, isOwner }

  const onDeleteMove = async (m: CashMove) => {
    const ok = await confirm({
      title: 'ลบรายการนี้',
      message: `${m.type === 'out' ? 'เงินออก' : 'เงินเข้า'} ${bahtSign(m.amount)} · ${m.reason}`,
      confirmText: 'ลบ',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteCashMove(m.id, actor)
      toast('ลบแล้ว', 'success')
    } catch (err) {
      if (isShiftError(err, 'not_allowed')) {
        toast('ลบได้เฉพาะรายการที่ตัวเองจด หรือให้เจ้าของลบ', 'error')
      } else {
        console.error('delete cash move failed', err)
        toast('ลบไม่สำเร็จ ลองอีกครั้ง', 'error')
      }
    }
  }

  return (
    <div className="page shift-page">
      <PageHeader
        title="ร้านเปิดอยู่"
        sub={`${booth.name} · ${thaiDateLong(shift.dayKey)}`}
        actions={
          <Link to="/shift/history" className="btn btn-ghost">
            <History size={20} aria-hidden="true" />
            <span>ประวัติ</span>
          </Link>
        }
      />
      <p className="shift-opened">
        เปิด {openedSameDay ? timeHM(shift.openedAt) : dateTime(shift.openedAt)} โดย {staffName(shift.staffId)} · เงินทอนตั้งต้น{' '}
        <Money value={shift.openingFloat} />
      </p>

      {stale && (
        <div className="shift-alert is-warning" role="alert">
          <AlertTriangle size={22} aria-hidden="true" />
          <div>
            <strong>ยังไม่ได้ปิดยอดของ{thaiDateLong(shift.dayKey)}</strong>
            <p>ถ้าขายข้ามเที่ยงคืนอยู่ ยอดทั้งหมดจะนับเป็นของวันที่เปิดร้าน เลิกขายแล้วให้นับเงินและกดปิดยอด</p>
          </div>
        </div>
      )}
      {otherOpen.length > 0 && (
        <div className="shift-alert is-info" role="status">
          <Info size={22} aria-hidden="true" />
          <div>
            <strong>แผงนี้มีรอบที่ยังไม่ปิดอีก {num(otherOpen.length)} รอบ</strong>
            <p>
              เปิดจากเครื่องอื่น ({otherOpen.map((s) => `${thaiDate(s.dayKey)} ${timeHM(s.openedAt)}`).join(', ')})
              ปิดยอดรอบนี้แล้วจะเห็นรอบถัดไป
            </p>
          </div>
        </div>
      )}

      {!data || !totals ? (
        <Loading />
      ) : (
        <div className="shift-grid">
          <div className="stack">
            <Card className="shift-sales">
              <div className="row-between">
                <span className="shift-label">ยอดขายรอบนี้</span>
                <Link to="/bills" className="btn btn-ghost shift-link-btn">
                  <ReceiptText size={18} aria-hidden="true" />
                  <span>ดูบิล</span>
                </Link>
              </div>
              <Money value={totals.total} size="xl" className="shift-sales-total" />
              <p className="shift-sales-sub">
                {num(totals.bills)} บิล · {num(totals.pieces, 2)} ชิ้น
              </p>
              <MethodTotals totals={totals} shop={shop} />
              <DiscountLine totals={totals} />
            </Card>
            <Button variant="primary" size="xl" block icon={<Wallet size={26} />} onClick={() => setClosing(true)}>
              ปิดยอด
            </Button>
          </div>

          <div className="stack">
            <Card title="เงินสดที่ควรมีในลิ้นชัก">
              <CashBreakdown openingFloat={shift.openingFloat} totals={totals} />
              <div className="grid-2 shift-move-btns">
                <Button size="lg" icon={<ArrowUpRight size={22} />} onClick={() => setMoveType('out')}>
                  เงินออก
                </Button>
                <Button size="lg" icon={<ArrowDownLeft size={22} />} onClick={() => setMoveType('in')}>
                  เงินเข้า
                </Button>
              </div>
            </Card>

            <Card title="เงินเข้า-ออกระหว่างรอบ" flush>
              {data.moves.length === 0 ? (
                <EmptyState
                  compact
                  icon={null}
                  title="ยังไม่มีรายการ"
                  hint="หยิบเงินจากลิ้นชัก เช่น ค่าข้าว ซื้อถุง ให้กดเงินออก ใส่เงินทอนเพิ่มให้กดเงินเข้า"
                />
              ) : (
                <CashMoveList
                  moves={data.moves}
                  staffName={staffName}
                  canDelete={(m) => canDeleteMove(m, true, actor)}
                  onDelete={(m) => void onDeleteMove(m)}
                  showDate={(m) => (dayKeyOf(m.createdAt) !== shift.dayKey ? thaiDate(dayKeyOf(m.createdAt)) : null)}
                />
              )}
            </Card>
          </div>

          <CashMoveModal
            type={moveType}
            shift={shift}
            staffId={staff.id}
            expectedCash={totals.expectedCash}
            onClose={() => setMoveType(null)}
          />
          <CloseShiftModal
            open={closing}
            onClose={() => setClosing(false)}
            shift={shift}
            totals={totals}
            booth={booth}
            shop={shop}
            staff={staff}
            staffName={staffName}
            onClosed={(id) => {
              setClosing(false)
              onClosed(id)
            }}
          />
        </div>
      )}
    </div>
  )
}
