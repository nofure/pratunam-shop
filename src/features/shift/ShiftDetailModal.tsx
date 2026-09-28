// Full details of one shift (closed: frozen numbers; open: live numbers) with share buttons.
import { useLiveQuery } from 'dexie-react-hooks'
import { alive, db } from '../../db'
import { DENOMINATIONS, PAY_METHOD_LABEL } from '../../constants'
import { denominationTotal, topItems } from '../../domain/shift'
import { useShop } from '../../hooks'
import { dayKeyOf } from '../../lib/dates'
import { baht, bahtSign, dateTime, num, round2, thaiDate } from '../../lib/format'
import { useSession } from '../../session'
import type { CashMove, ID, Sale, Shift, ShopConfig } from '../../types'
import { Badge, EmptyState, Modal, Money, useConfirm, useToast } from '../../ui'
import {
  CashBreakdown,
  CashMoveList,
  DiscountLine,
  Loading,
  MethodTotals,
  ShareButtons,
  useBoothNames,
  useStaffNames,
} from './parts'
import { buildShiftText, canDeleteMove, deleteCashMove, denominationKind, isShiftError, shiftTotalsOf } from './shiftData'

export function ShiftDetailModal({ shiftId, onClose }: { shiftId: ID | null; onClose: () => void }) {
  if (!shiftId) return null
  return <DetailSheet shiftId={shiftId} onClose={onClose} />
}

function DetailSheet({ shiftId, onClose }: { shiftId: ID; onClose: () => void }) {
  const shop = useShop()
  const staffName = useStaffNames()
  const boothName = useBoothNames()

  const data = useLiveQuery(async () => {
    const shift = await db.shifts.get(shiftId)
    if (!shift || shift.deleted === 1) return null
    const [sales, moves] = await Promise.all([
      db.sales.where('shiftId').equals(shiftId).toArray(),
      db.cashMoves.where('shiftId').equals(shiftId).toArray(),
    ])
    return { shift, sales: alive(sales), moves: alive(moves) }
  }, [shiftId])

  const title = data ? `${boothName(data.shift.boothId)} · ${thaiDate(data.shift.dayKey)}` : 'รายละเอียดรอบขาย'
  const text = data
    ? buildShiftText({
        shop,
        boothName: boothName(data.shift.boothId),
        staffName,
        shift: data.shift,
        sales: data.sales,
        moves: data.moves,
      })
    : null

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={title}
      footer={text ? <ShareButtons text={text} title={title} size="md" /> : undefined}
    >
      {data === undefined ? (
        <Loading />
      ) : data === null ? (
        <EmptyState compact title="ไม่พบข้อมูลรอบนี้" hint="อาจถูกลบจากเครื่องอื่น" />
      ) : (
        <DetailBody shift={data.shift} sales={data.sales} moves={data.moves} shop={shop} staffName={staffName} />
      )}
    </Modal>
  )
}

function DetailBody({
  shift,
  sales,
  moves,
  shop,
  staffName,
}: {
  shift: Shift
  sales: Sale[]
  moves: CashMove[]
  shop: ShopConfig | null | undefined
  staffName: (id: ID | null | undefined) => string
}) {
  const { staff, isOwner } = useSession()
  const toast = useToast()
  const confirm = useConfirm()
  const closed = shift.status === 'closed'
  const totals = shiftTotalsOf(shift, sales, moves)
  const top = topItems(sales, 5)
  const actor = staff ? { id: staff.id, isOwner } : null
  const denoms = shift.denominations
  const denomRows = denoms ? DENOMINATIONS.filter((v) => (denoms[String(v)] ?? 0) > 0) : []

  const onDeleteMove = async (m: CashMove) => {
    if (!actor) return
    const ok = await confirm({
      title: 'ลบรายการนี้',
      message: `${m.type === 'out' ? 'เงินออก' : 'เงินเข้า'} ${bahtSign(m.amount)} · ${m.reason}${
        closed ? '\nรอบนี้ปิดยอดแล้ว ยอดที่ปิดไว้จะไม่เปลี่ยน ลบเฉพาะรายการนี้ออกจากรายงาน' : ''
      }`,
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

  const checks: { key: string; label: string; amount: number; ok: boolean; okText: string }[] = []
  if (closed && round2(totals.byMethod.transfer) > 0)
    checks.push({
      key: 't',
      label: PAY_METHOD_LABEL.transfer,
      amount: totals.byMethod.transfer,
      ok: shift.transferChecked === 1,
      okText: 'ตรงกับแอปธนาคาร',
    })
  if (closed && round2(totals.byMethod.halfhalf) > 0)
    checks.push({
      key: 'h',
      label: PAY_METHOD_LABEL.halfhalf,
      amount: totals.byMethod.halfhalf,
      ok: shift.halfhalfChecked === 1,
      okText: 'ตรงกับแอปถุงเงิน',
    })

  return (
    <div className="stack-lg">
      <div className="stack-sm">
        <div className="row">
          {closed ? <Badge tone="success">ปิดยอดแล้ว</Badge> : <Badge tone="info">ยังไม่ปิดยอด</Badge>}
        </div>
        <p className="shift-times">
          เปิด {dateTime(shift.openedAt)} โดย {staffName(shift.staffId)}
          {closed && shift.closedAt ? (
            <>
              <br />
              ปิด {dateTime(shift.closedAt)} โดย {staffName(shift.closedBy)}
            </>
          ) : null}
        </p>
      </div>

      <section className="stack-sm">
        <h3 className="shift-section-title">ยอดขาย</h3>
        <Money value={totals.total} size="xl" />
        <p className="shift-sales-sub">
          {num(totals.bills)} บิล · {num(totals.pieces, 2)} ชิ้น
        </p>
        <MethodTotals totals={totals} shop={shop} />
        <DiscountLine totals={totals} />
      </section>

      <section className="stack-sm">
        <h3 className="shift-section-title">เงินสดในลิ้นชัก</h3>
        <CashBreakdown
          openingFloat={shift.openingFloat}
          totals={totals}
          expected={closed ? shift.expectedCash : null}
          counted={closed ? shift.countedCash : null}
        />
      </section>

      {closed && (
        <section className="stack-sm">
          <h3 className="shift-section-title">นับเงินสด</h3>
          {denoms && denomRows.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>แบงก์ / เหรียญ</th>
                    <th className="num">จำนวน</th>
                    <th className="num">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {denomRows.map((v) => (
                    <tr key={v}>
                      <td>
                        {denominationKind(v)} {baht(v)}
                      </td>
                      <td className="num">{num(denoms[String(v)] ?? 0)}</td>
                      <td className="num">{bahtSign(v * (denoms[String(v)] ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>รวม</td>
                    <td />
                    <td className="num">{bahtSign(denominationTotal(denoms))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="muted">ใส่ยอดรวมเลย ไม่ได้นับแยกแบงก์</p>
          )}
        </section>
      )}

      {checks.length > 0 && (
        <section className="stack-sm">
          <h3 className="shift-section-title">เช็กเงินโอน / คนละครึ่ง</h3>
          <dl className="shift-kv">
            {checks.map((c) => (
              <div key={c.key} className="shift-kv-row">
                <dt>
                  {c.label} <Money value={c.amount} />
                </dt>
                <dd>{c.ok ? <Badge tone="success">{c.okText}</Badge> : <Badge tone="warning">ยังไม่ได้เช็ก</Badge>}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {shift.note?.trim() && (
        <section className="stack-sm">
          <h3 className="shift-section-title">หมายเหตุ</h3>
          <p className="shift-note">{shift.note}</p>
        </section>
      )}

      <section className="stack-sm">
        <h3 className="shift-section-title">เงินเข้า-ออก</h3>
        {moves.length === 0 ? (
          <p className="muted">ไม่มีรายการ</p>
        ) : (
          <div className="shift-box-flush">
            <CashMoveList
              moves={moves}
              staffName={staffName}
              canDelete={(m) => canDeleteMove(m, !closed, actor)}
              onDelete={(m) => void onDeleteMove(m)}
              showDate={(m) => (dayKeyOf(m.createdAt) !== shift.dayKey ? thaiDate(dayKeyOf(m.createdAt)) : null)}
            />
          </div>
        )}
      </section>

      {top.length > 0 && (
        <section className="stack-sm">
          <h3 className="shift-section-title">ขายดี</h3>
          <ol className="shift-top">
            {top.map((t) => (
              <li key={`${t.tierId ?? 'c'}-${t.name}-${t.price}`}>
                <span className="shift-top-name">
                  {t.name} {baht(t.price)}
                </span>
                <span className="num">
                  {num(t.qty, 2)} {t.unit}
                </span>
                <Money value={t.total} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
