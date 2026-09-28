// Shown right after ปิดยอด (and from "ดูสรุป"): the LINE text plus share / next-step buttons.
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { CircleAlert, CircleCheck, ShoppingBag, Store } from 'lucide-react'
import { alive, db } from '../../db'
import { cashDiffText, cashDiffTone } from '../../domain/shift'
import { num, thaiDateLong, timeHM } from '../../lib/format'
import type { Booth, ID, ShopConfig } from '../../types'
import { Button, Card, EmptyState, Money, PageHeader, cx } from '../../ui'
import { Loading, ShareButtons, useStaffNames } from './parts'
import { buildShiftText, shiftTotalsOf } from './shiftData'

export function ShiftSummary({
  shiftId,
  booth,
  shop,
  onNew,
}: {
  shiftId: ID
  booth: Booth
  shop: ShopConfig | null | undefined
  /** "เปิดร้านรอบใหม่" */
  onNew: () => void
}) {
  const navigate = useNavigate()
  const staffName = useStaffNames()

  const data = useLiveQuery(async () => {
    const shift = await db.shifts.get(shiftId)
    if (!shift || shift.deleted === 1) return null
    const [sales, moves] = await Promise.all([
      db.sales.where('shiftId').equals(shiftId).toArray(),
      db.cashMoves.where('shiftId').equals(shiftId).toArray(),
    ])
    return { shift, sales: alive(sales), moves: alive(moves) }
  }, [shiftId])

  if (data === undefined) return <Loading />
  if (data === null) {
    return (
      <div className="page">
        <EmptyState
          title="ไม่พบข้อมูลรอบนี้"
          action={
            <Button variant="primary" onClick={onNew}>
              กลับ
            </Button>
          }
        />
      </div>
    )
  }

  const { shift, sales, moves } = data
  const totals = shiftTotalsOf(shift, sales, moves)
  const text = buildShiftText({ shop, boothName: booth.name, staffName, shift, sales, moves })
  const closed = shift.status === 'closed'
  const diff = shift.cashDiff
  const tone = diff === null ? 'ok' : cashDiffTone(diff)

  return (
    <div className="page shift-page">
      <PageHeader title={closed ? 'ปิดยอดแล้ว' : 'สรุปรอบขาย'} sub={`${booth.name} · ${thaiDateLong(shift.dayKey)}`} />

      <div className="shift-grid">
        <div className="stack">
          <div className={cx('shift-done', `is-${tone}`)} role="status">
            {tone === 'ok' ? <CircleCheck size={36} aria-hidden="true" /> : <CircleAlert size={36} aria-hidden="true" />}
            <div>
              <div className="shift-done-title">
                {diff === null ? 'ยังไม่ได้นับเงิน' : tone === 'ok' ? 'เงินสดตรง' : `เงินสด${cashDiffText(diff)} บาท`}
              </div>
              <div className="shift-done-sub">
                {closed && shift.closedAt
                  ? `ปิด ${timeHM(shift.closedAt)} โดย ${staffName(shift.closedBy)}`
                  : `เปิด ${timeHM(shift.openedAt)} โดย ${staffName(shift.staffId)}`}
              </div>
            </div>
          </div>

          <div className="grid-2">
            <div className="shift-box">
              <span className="shift-label">ยอดขาย</span>
              <Money value={totals.total} size="lg" />
              <span className="muted">
                {num(totals.bills)} บิล · {num(totals.pieces, 2)} ชิ้น
              </span>
            </div>
            <div className="shift-box">
              <span className="shift-label">เงินสดนับได้</span>
              {shift.countedCash !== null ? <Money value={shift.countedCash} size="lg" /> : <span className="muted">–</span>}
              {shift.expectedCash !== null && (
                <span className="muted">
                  ควรมี <Money value={shift.expectedCash} />
                </span>
              )}
            </div>
          </div>

          <Card title="ข้อความสรุป">
            <pre className="shift-text">{text}</pre>
          </Card>
        </div>

        <div className="stack">
          <div className="shift-share">
            <ShareButtons text={text} title={`สรุปยอด ${booth.name}`} />
          </div>
          <Button size="lg" block icon={<ShoppingBag size={22} />} onClick={() => navigate('/pos')}>
            กลับหน้าขาย
          </Button>
          <Button size="lg" block icon={<Store size={22} />} onClick={onNew}>
            เปิดร้านรอบใหม่
          </Button>
        </div>
      </div>
    </div>
  )
}
