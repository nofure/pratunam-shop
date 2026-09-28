// Report cards about money in: overview, profit, sales over time, payment methods, booths, categories.
import { Link } from 'react-router-dom'
import { PackagePlus } from 'lucide-react'
import { BarChart, Badge, Card, HBarList, Money, Stat } from '../../ui'
import type { PayMethod } from '../../types'
import { EXPENSE_CATEGORIES, type Report } from '../../domain/reports'
import { PAY_METHODS } from '../../domain/shift'
import { EXPENSE_CATEGORY_LABEL, PAY_METHOD_LABEL } from '../../constants'
import { bahtSign, num, thaiDate, thaiDateShort, timeHM } from '../../lib/format'
import type { DayRange } from '../../lib/dates'
import {
  categoryUnit,
  dayStats,
  hourChartData,
  hourSpanLabel,
  marginPct,
  pctChange,
  peakHour,
  rangeLabel,
  salesChartData,
  sharePct,
} from './logic'
import { Delta, Line, Note } from './parts'

// ---------- overview ----------

export function KpiCard({
  report,
  prev,
  prevRange,
  today,
}: {
  report: Report
  /** previous period (null = range too long to compare) */
  prev: Report | null
  prevRange: DayRange | null
  today: string
}) {
  const t = report.totals
  const canCompare = prev !== null && prev.totals.bills > 0
  const delta = (cur: number, before: number) => (canCompare ? <Delta p={pctChange(cur, before)} /> : null)
  const pt = prev?.totals

  return (
    <Card title="ภาพรวม" className="rep-wide">
      <div className="rep-kpis">
        <Stat label="ยอดขาย" value={<Money value={t.sales} />} sub={pt ? delta(t.sales, pt.sales) : null} />
        <Stat label="บิล" value={t.bills} sub={pt ? delta(t.bills, pt.bills) : null} />
        <Stat label="ชิ้น" value={t.pieces} sub={pt ? delta(t.pieces, pt.pieces) : null} />
        <Stat label="เฉลี่ยต่อบิล" value={<Money value={t.avgBill} />} sub={pt ? delta(t.avgBill, pt.avgBill) : null} />
      </div>
      {prev !== null && prevRange !== null && (
        <p className="rep-small">
          {canCompare ? (
            <>
              เทียบกับ {rangeLabel(prevRange)} (ยอดขาย {bahtSign(prev.totals.sales)})
            </>
          ) : (
            <>ช่วงก่อนหน้า ({rangeLabel(prevRange)}) ยังไม่มียอดขาย</>
          )}
        </p>
      )}
      {report.openShifts.length > 0 && (
        <Note tone="warning">
          <strong>ยังไม่ปิดยอด {report.openShifts.length} กะ</strong>
          <ul className="rep-plain-list">
            {report.openShifts.map((s) => (
              <li key={s.shiftId}>
                {s.boothName} · เปิด {s.dayKey !== today ? `${thaiDateShort(s.dayKey)} ` : ''}
                {timeHM(s.openedAt)} โดย {s.staffName}
                {s.dayKey < today ? ' · ลืมปิดยอดหรือเปล่า' : ''}
              </li>
            ))}
          </ul>
        </Note>
      )}
    </Card>
  )
}

// ---------- profit ----------

export function ProfitCard({ report }: { report: Report }) {
  const r = report
  const margin = marginPct(r.grossProfit, r.knownCostSales)
  const cats = EXPENSE_CATEGORIES.filter((c) => r.expenses.byCategory[c] !== 0)
  const hasUnknown = r.cogsUnknownSales > 0

  return (
    <Card
      title="กำไร"
      actions={
        <Link to="/expenses" className="rep-link">
          จดค่าใช้จ่าย
        </Link>
      }
    >
      <dl className="rep-lines">
        <Line label="ยอดขายที่รู้ทุน" value={r.knownCostSales} />
        <Line label="ทุนของที่ขาย" value={-r.cogs} />
        <Line
          label="กำไรขั้นต้น"
          value={r.grossProfit}
          strong
          tone={r.grossProfit < 0 ? 'danger' : undefined}
          extra={margin !== null ? <Badge tone={margin < 0 ? 'danger' : 'success'}>{num(margin, 1)}%</Badge> : null}
        />
        <Line
          label="ค่าใช้จ่าย"
          value={-r.expenses.total}
          sub={r.expenses.fromDrawer > 0 ? `จ่ายจากลิ้นชัก ${bahtSign(r.expenses.fromDrawer)}` : null}
        />
        {cats.map((c) => (
          <Line key={c} label={EXPENSE_CATEGORY_LABEL[c]} value={-r.expenses.byCategory[c]} indent />
        ))}
        <Line
          label="กำไรสุทธิ"
          value={r.netProfit}
          big
          tone={r.netProfit < 0 ? 'danger' : 'success'}
          sub={hasUnknown ? 'ยังไม่รวมกำไรจากยอดที่ไม่รู้ทุน' : null}
        />
      </dl>
      {hasUnknown && (
        <Note>
          <p>มียอดขาย {bahtSign(r.cogsUnknownSales)} ที่ยังไม่รู้ทุน — ใส่ทุนตอนรับของเข้า</p>
          <Link to="/stock/receive" className="btn btn-secondary rep-note-action">
            <PackagePlus size={20} aria-hidden="true" />
            รับของเข้า
          </Link>
        </Note>
      )}
      {r.stockIn.lots > 0 && (
        <p className="rep-small">
          ช่วงนี้รับของเข้า {num(r.stockIn.qty, 2)} ชิ้น ทุน {bahtSign(r.stockIn.cost)} (นับเป็นทุนตอนขายออก ไม่ใช่ค่าใช้จ่าย)
        </p>
      )}
    </Card>
  )
}

// ---------- sales over time ----------

export function SalesChartCard({ report }: { report: Report }) {
  if (report.days <= 1) {
    const data = hourChartData(report.byHour)
    const peak = peakHour(report.byHour)
    return (
      <Card title="ยอดรายชั่วโมง">
        <BarChart data={data} height={200} emptyText="ยังไม่มียอดขาย" ariaLabel="ยอดขายรายชั่วโมง" />
        {peak !== null && (
          <p className="rep-small">
            ขายดีสุดช่วง {hourSpanLabel(peak)} · {bahtSign(report.byHour[peak])}
          </p>
        )}
      </Card>
    )
  }
  const { mode, data } = salesChartData(report.byDay)
  const s = dayStats(report.byDay)
  return (
    <Card title={mode === 'month' ? 'ยอดรายเดือน' : 'ยอดรายวัน'}>
      <BarChart data={data} height={220} ariaLabel={mode === 'month' ? 'ยอดขายรายเดือน' : 'ยอดขายรายวัน'} />
      {s.best && (
        <p className="rep-small">
          ขายดีสุด {thaiDate(s.best.dayKey)} {bahtSign(s.best.sales)} · ขาย {s.sellingDays} วัน เฉลี่ยวันละ{' '}
          {bahtSign(s.avgPerSellingDay)}
        </p>
      )}
    </Card>
  )
}

/** Best hours over a multi-day range (single days show hours in SalesChartCard instead). */
export function HourCard({ report }: { report: Report }) {
  const data = hourChartData(report.byHour)
  const peak = peakHour(report.byHour)
  return (
    <Card title="ช่วงเวลาขายดี">
      <BarChart data={data} height={200} emptyText="ยังไม่มียอดขาย" ariaLabel="ยอดขายตามชั่วโมง" />
      {peak !== null && (
        <p className="rep-small">
          ขายดีสุดช่วง {hourSpanLabel(peak)} · รวมทุกวัน {bahtSign(report.byHour[peak])}
        </p>
      )}
    </Card>
  )
}

// ---------- breakdowns ----------

export function MethodCard({ report, otherLabel }: { report: Report; otherLabel: string }) {
  const label = (m: PayMethod) => (m === 'other' ? otherLabel : PAY_METHOD_LABEL[m])
  const rows = PAY_METHODS.filter((m) => report.byMethod[m] !== 0)
    .map((m) => ({ label: label(m), value: report.byMethod[m], sub: sharePct(report.byMethod[m], report.totals.sales) }))
    .sort((a, b) => b.value - a.value)
  return (
    <Card title="ช่องทางรับเงิน">
      <HBarList rows={rows} emptyText="ยังไม่มียอดขาย" />
    </Card>
  )
}

export function BoothCard({ report }: { report: Report }) {
  const rows = report.byBooth.map((b) => ({
    label: b.name,
    value: b.sales,
    sub: `${num(b.bills)} บิล · ${num(b.pieces, 2)} ชิ้น · ${sharePct(b.sales, report.totals.sales)}`,
  }))
  return (
    <Card title="ยอดตามแผง">
      <HBarList rows={rows} emptyText="ยังไม่มียอดขาย" />
    </Card>
  )
}

export function CategoryCard({ report }: { report: Report }) {
  const rows = report.byCategory.map((c) => ({
    label: c.name,
    value: c.sales,
    sub: `${num(c.qty, 2)} ${categoryUnit(report.byTier, c.name)} · ${sharePct(c.sales, report.totals.sales)}`,
  }))
  return (
    <Card title="หมวดสินค้า">
      <HBarList rows={rows} emptyText="ยังไม่มียอดขาย" />
    </Card>
  )
}
