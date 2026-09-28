// Report cards about people and cash: sellers, cash differences at close, discounts and voided bills.
import { useMemo, useState } from 'react'
import { CircleCheck } from 'lucide-react'
import { Card, EmptyState, Money } from '../../ui'
import type { ID, Sale } from '../../types'
import type { Report } from '../../domain/reports'
import { bahtSign, num, round2, thaiDateShort, timeHM } from '../../lib/format'
import { CashDiff, ShowMore } from './parts'

// ---------- sellers ----------

export function StaffCard({ report }: { report: Report }) {
  const rows = report.byStaff
  return (
    <Card title="คนขาย">
      {rows.length === 0 ? (
        <EmptyState compact icon={null} title="ยังไม่มีข้อมูล" />
      ) : (
        <ul className="rep-rows">
          {rows.map((s) => (
            <li key={s.staffId} className="rep-row">
              <div className="rep-row-main">
                <span className="rep-row-title">{s.name}</span>
                <span className="rep-row-sub">
                  {num(s.bills)} บิล · ปิดยอด {num(s.shiftsClosed)} ครั้ง
                </span>
              </div>
              <div className="rep-row-end">
                <Money value={s.sales} className="rep-row-amount" />
                {s.shiftsClosed > 0 ? (
                  <span className="rep-row-sub">
                    เงินสด <CashDiff diff={s.cashDiffTotal} />
                  </span>
                ) : (
                  <span className="rep-row-sub">ยังไม่ได้ปิดยอด</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// ---------- cash differences ----------

const DIFF_LIMIT = 8

export function CashDiffCard({ report }: { report: Report }) {
  const [open, setOpen] = useState(false)
  const closed = report.byStaff.reduce((a, s) => a + s.shiftsClosed, 0)
  // newest first: the latest close matters most
  const diffs = useMemo(() => [...report.cashDiffs].reverse(), [report.cashDiffs])
  const multiDay = report.days > 1
  const short = round2(diffs.reduce((a, d) => a + (d.diff < 0 ? -d.diff : 0), 0))
  const over = round2(diffs.reduce((a, d) => a + (d.diff > 0 ? d.diff : 0), 0))
  const shown = open ? diffs : diffs.slice(0, DIFF_LIMIT)

  return (
    <Card title="เงินขาด-เกิน">
      {closed === 0 ? (
        <EmptyState compact icon={null} title="ยังไม่มีการปิดยอดในช่วงนี้" hint="ยอดขาด-เกินจะขึ้นหลังคนขายนับเงินและปิดยอด" />
      ) : diffs.length === 0 ? (
        <p className="rep-ok">
          <CircleCheck size={20} aria-hidden="true" />
          เงินสดตรงทุกครั้ง (ปิดยอด {num(closed)} ครั้ง)
        </p>
      ) : (
        <>
          <p className="rep-small rep-small-top">
            ไม่ตรง {num(diffs.length)} จาก {num(closed)} ครั้ง
            {short > 0 && (
              <>
                {' · '}
                <span className="tone-danger">ขาดรวม {bahtSign(short)}</span>
              </>
            )}
            {over > 0 && (
              <>
                {' · '}
                <span className="tone-warning">เกินรวม {bahtSign(over)}</span>
              </>
            )}
          </p>
          <ul className="rep-rows">
            {shown.map((d) => (
              <li key={d.shiftId} className="rep-row">
                <div className="rep-row-main">
                  <span className="rep-row-title">{d.staffName}</span>
                  <span className="rep-row-sub">
                    {multiDay ? `${thaiDateShort(d.dayKey)} · ` : ''}
                    {d.boothName}
                  </span>
                </div>
                <div className="rep-row-end">
                  <CashDiff diff={d.diff} className="rep-row-amount" />
                </div>
              </li>
            ))}
          </ul>
          <ShowMore total={diffs.length} limit={DIFF_LIMIT} open={open} onToggle={() => setOpen((o) => !o)} />
        </>
      )}
    </Card>
  )
}

// ---------- discounts and voided bills ----------

const VOID_LIMIT = 5

export function DiscountVoidCard({
  report,
  manualDiscountBills,
  boothName,
  staffName,
}: {
  report: Report
  /** paid bills in the range that got a bargaining discount */
  manualDiscountBills: number
  boothName: (id: ID) => string
  staffName: (id: ID) => string
}) {
  const [open, setOpen] = useState(false)
  const t = report.totals
  const voids = report.voids
  const showBooth = report.boothId == null && new Set(voids.map((v) => v.boothId)).size > 1
  const multiDay = report.days > 1
  const shown = open ? voids : voids.slice(0, VOID_LIMIT)
  const nothing = t.promoDiscount === 0 && t.manualDiscount === 0 && voids.length === 0

  return (
    <Card title="ส่วนลดและบิลยกเลิก">
      {nothing ? (
        <EmptyState compact icon={null} title="ไม่มีส่วนลดหรือบิลยกเลิก" />
      ) : (
        <>
          <dl className="rep-lines">
            <div className="rep-line">
              <dt>
                <span>ส่วนลดโปร (ซื้อหลายชิ้น)</span>
              </dt>
              <dd>
                <Money value={t.promoDiscount} />
              </dd>
            </div>
            <div className="rep-line">
              <dt>
                <span>ลดให้ลูกค้า (ลูกค้าต่อ)</span>
                {manualDiscountBills > 0 && <span className="rep-line-sub">{num(manualDiscountBills)} บิล</span>}
              </dt>
              <dd>
                <Money value={t.manualDiscount} />
              </dd>
            </div>
            <div className="rep-line">
              <dt>
                <span>บิลยกเลิก</span>
                <span className="rep-line-sub">{num(t.voidBills)} บิล</span>
              </dt>
              <dd>
                <Money value={t.voidTotal} tone={t.voidBills > 0 ? 'danger' : 'default'} />
              </dd>
            </div>
          </dl>
          {voids.length > 0 && (
            <>
              <ul className="rep-rows rep-voids">
                {shown.map((v) => (
                  <VoidRow key={v.id} sale={v} multiDay={multiDay} showBooth={showBooth} boothName={boothName} staffName={staffName} />
                ))}
              </ul>
              <ShowMore total={voids.length} limit={VOID_LIMIT} open={open} onToggle={() => setOpen((o) => !o)} />
            </>
          )}
        </>
      )}
    </Card>
  )
}

function VoidRow({
  sale: v,
  multiDay,
  showBooth,
  boothName,
  staffName,
}: {
  sale: Sale
  multiDay: boolean
  showBooth: boolean
  boothName: (id: ID) => string
  staffName: (id: ID) => string
}) {
  const when = `${multiDay ? thaiDateShort(v.dayKey) + ' ' : ''}${timeHM(v.createdAt)}`
  const by = v.voidedBy && v.voidedBy !== v.staffId ? ` · ยกเลิกโดย ${staffName(v.voidedBy)}` : ''
  return (
    <li className="rep-row">
      <div className="rep-row-main">
        <span className="rep-row-title">
          บิล {v.billNo} · {v.voidReason?.trim() || 'ไม่ระบุเหตุผล'}
        </span>
        <span className="rep-row-sub">
          {when}
          {showBooth ? ` · ${boothName(v.boothId)}` : ''} · {staffName(v.staffId)}
          {by}
        </span>
      </div>
      <div className="rep-row-end">
        <Money value={v.total} className="rep-row-amount rep-struck" />
      </div>
    </li>
  )
}
