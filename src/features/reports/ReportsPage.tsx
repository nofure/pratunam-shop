// Owner dashboard: sales, profit, best sellers, sellers, cash differences and stock alerts for a date range.
import { useCallback, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ShoppingBag, Wallet } from 'lucide-react'
import { Card, DateRangePicker, EmptyState, PageHeader, Spinner, cx } from '../../ui'
import type { ID, PayMethod } from '../../types'
import { buildReport, lowStockList, slowMovers, UNKNOWN_BOOTH_NAME, UNKNOWN_STAFF_NAME } from '../../domain/reports'
import { computeStock } from '../../domain/stock'
import { daySummaryText } from '../../domain/summary'
import { PAY_METHOD_LABEL } from '../../constants'
import { inRange, todayKey, type DayRange } from '../../lib/dates'
import {
  billsCsvRows,
  COMPARE_MAX_DAYS,
  csvFileName,
  previousRange,
  rangeDays,
  rangeFromParams,
  rangeLabel,
  tiersCsvRows,
} from './logic'
import { rangeKey, useAllSalesForStock, useBaseData, useRangeData } from './useReportData'
import { BoothCard, CategoryCard, HourCard, KpiCard, MethodCard, ProfitCard, SalesChartCard } from './SalesCards'
import { TierTableCard } from './TierTableCard'
import { CashDiffCard, DiscountVoidCard, StaffCard } from './PeopleCards'
import { LowStockCard, NoStockTrackingCard, SLOW_DAYS, SlowMoversCard } from './StockCards'
import { ReportActions, type CsvOption } from './ReportActions'
import './reports.css'

export default function ReportsPage() {
  const [params, setParams] = useSearchParams()
  const today = todayKey()
  const range = rangeFromParams(params.get('from'), params.get('to'), today)
  const prevRange = rangeDays(range) <= COMPARE_MAX_DAYS ? previousRange(range) : null
  const wantedKey = rangeKey(range, prevRange)

  const base = useBaseData()
  const data = useRangeData(range, prevRange)
  const needStock = base ? base.tiers.some((t) => t.deleted !== 1 && t.trackStock === 1) : undefined
  const stockData = useAllSalesForStock(needStock)
  // useLiveQuery keeps the previous result while a new range loads: show it dimmed until the new one arrives.
  const fresh = data !== undefined && data.key === wantedKey

  // ---- booths & names
  const booths = useMemo(
    () =>
      (base?.booths ?? [])
        .filter((b) => b.deleted !== 1)
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'th')),
    [base],
  )
  const boothParam = params.get('booth')
  const boothId: ID | null = boothParam && booths.some((b) => b.id === boothParam) ? boothParam : null
  const selectedBooth = boothId ? (booths.find((b) => b.id === boothId) ?? null) : null

  const chipBooths = useMemo(() => {
    const withSales = new Set((data?.sales ?? []).filter((s) => s.deleted !== 1).map((s) => s.boothId))
    return booths.filter((b) => b.active === 1 || withSales.has(b.id) || b.id === boothId)
  }, [booths, data, boothId])

  const lookups = useMemo(() => {
    const boothById = new Map((base?.booths ?? []).map((b) => [b.id, b]))
    const staffById = new Map((base?.staff ?? []).map((s) => [s.id, s]))
    const tierById = new Map((base?.tiers ?? []).map((t) => [t.id, t]))
    return {
      tierById,
      boothName: (id: ID) => boothById.get(id)?.name ?? UNKNOWN_BOOTH_NAME,
      staffName: (id: ID) => staffById.get(id)?.name ?? UNKNOWN_STAFF_NAME,
    }
  }, [base])

  const otherLabel = base?.shop?.otherPayLabel?.trim() || PAY_METHOD_LABEL.other
  const methodLabel = useCallback((m: PayMethod) => (m === 'other' ? otherLabel : (PAY_METHOD_LABEL[m] ?? m)), [otherLabel])

  // ---- reports (built for the range the data was loaded for)
  const report = useMemo(() => {
    if (!base || !data) return null
    return buildReport({
      from: data.range.from,
      to: data.range.to,
      boothId,
      sales: data.sales,
      shifts: data.shifts,
      cashMoves: data.cashMoves,
      expenses: data.expenses,
      lots: base.lots,
      adjustments: base.adjustments,
      tiers: base.tiers,
      booths: base.booths,
      staff: base.staff,
    })
  }, [base, data, boothId])

  const prevReport = useMemo(() => {
    if (!base || !data || !data.prev || !data.prevSales) return null
    return buildReport({
      from: data.prev.from,
      to: data.prev.to,
      boothId,
      sales: data.prevSales,
      shifts: [],
      cashMoves: [],
      expenses: [],
      lots: [],
      adjustments: [],
      tiers: base.tiers,
      booths: base.booths,
      staff: base.staff,
    })
  }, [base, data, boothId])

  // ---- stock right now (independent of the date range)
  const stock = useMemo(() => {
    if (!base || !stockData?.needed || !stockData.sales) return null
    return computeStock(base.tiers, base.lots, base.adjustments, stockData.sales)
  }, [base, stockData])

  const stockTiers = useMemo(() => {
    const alive = new Set(booths.map((b) => b.id))
    return (base?.tiers ?? []).filter((t) => t.deleted !== 1 && (boothId ? t.boothId === boothId : alive.has(t.boothId)))
  }, [base, booths, boothId])

  const low = useMemo(() => (stock ? lowStockList(stockTiers, stock) : null), [stock, stockTiers])
  const slow = useMemo(() => (stock ? slowMovers(stockTiers, stock, today, SLOW_DAYS) : null), [stock, stockTiers, today])

  // ---- bills of the range for CSV and discount counts
  const bills = useMemo(
    () => (data ? data.sales.filter((s) => s.deleted !== 1 && (!boothId || s.boothId === boothId)) : []),
    [data, boothId],
  )
  const manualDiscountBills = useMemo(
    () => bills.filter((s) => s.status === 'paid' && s.manualDiscount > 0).length,
    [bills],
  )

  const summary = useMemo(() => {
    if (!report) return null
    return daySummaryText({
      shopName: base?.shop?.name ?? '',
      dayKey: report.from,
      report,
      low: low ?? [],
      otherLabel,
    })
  }, [report, base, low, otherLabel])

  const csvRange: DayRange = data ? data.range : range
  const csv: CsvOption[] = [
    {
      key: 'bills',
      label: 'บิลทั้งหมด',
      hint: `${bills.length} บิล · หนึ่งแถวต่อบิล รวมบิลยกเลิก`,
      fileName: csvFileName('บิล', csvRange, selectedBooth?.name),
      rows: () => billsCsvRows(bills, lookups.boothName, lookups.staffName, methodLabel),
      disabled: bills.length === 0,
    },
    {
      key: 'tiers',
      label: 'ยอดตามปุ่มราคา',
      hint: `${report?.byTier.length ?? 0} รายการ · จำนวน ยอดขาย ทุน กำไร`,
      fileName: csvFileName('ยอดตามปุ่มราคา', csvRange, selectedBooth?.name),
      rows: () => tiersCsvRows(report?.byTier ?? []),
      disabled: !report || report.byTier.length === 0,
    },
  ]

  // ---- controls
  const setRange = (r: DayRange) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('from', r.from)
        next.set('to', r.to)
        return next
      },
      { replace: true },
    )
  const setBooth = (id: ID | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (id) next.set('booth', id)
        else next.delete('booth')
        return next
      },
      { replace: true },
    )

  return (
    <div className="page rep-page">
      <PageHeader title="รายงาน" sub={`${rangeLabel(range)}${selectedBooth ? ` · ${selectedBooth.name}` : ''}`} />

      <Card className="rep-controls">
        <DateRangePicker value={range} onChange={setRange} />
        {chipBooths.length > 1 && (
          <div className="rep-booths" role="group" aria-label="เลือกแผง">
            <button type="button" className={cx('chip', !boothId && 'active')} aria-pressed={!boothId} onClick={() => setBooth(null)}>
              ทุกแผง
            </button>
            {chipBooths.map((b) => (
              <button
                key={b.id}
                type="button"
                className={cx('chip', boothId === b.id && 'active')}
                aria-pressed={boothId === b.id}
                onClick={() => setBooth(b.id)}
              >
                {b.name}
                {b.active !== 1 ? ' (ปิดแล้ว)' : ''}
              </button>
            ))}
          </div>
        )}
      </Card>

      <ReportActions
        summary={summary}
        title={`สรุปยอด ${rangeLabel(csvRange)}`}
        csv={csv}
        busy={!fresh}
      />

      {!base || !data || !report ? (
        <div className="rep-loading" role="status">
          <Spinner size={28} />
          <span>กำลังโหลดรายงาน…</span>
        </div>
      ) : (
        <div className={cx('rep-grid', !fresh && 'rep-stale')} aria-busy={!fresh}>
          {report.totals.bills === 0 && report.voids.length === 0 ? (
            <>
              <Card className="rep-wide">
                <NothingSold
                  includesToday={inRange(today, report)}
                  shopOpen={report.openShifts.some((s) => s.dayKey === today)}
                  boothSelected={boothId !== null}
                />
              </Card>
              {report.expenses.total > 0 && <ProfitCard report={report} />}
              {report.byStaff.some((s) => s.shiftsClosed > 0) && <CashDiffCard report={report} />}
            </>
          ) : (
            <>
              <KpiCard report={report} prev={prevReport} prevRange={data.prev} today={today} />
              <ProfitCard report={report} />
              <SalesChartCard report={report} />
              <MethodCard report={report} otherLabel={otherLabel} />
              {!boothId && report.byBooth.length > 1 && <BoothCard report={report} />}
              <TierTableCard report={report} tierById={lookups.tierById} />
              <CategoryCard report={report} />
              <StaffCard report={report} />
              {report.days > 1 && <HourCard report={report} />}
              <CashDiffCard report={report} />
              <DiscountVoidCard
                report={report}
                manualDiscountBills={manualDiscountBills}
                boothName={lookups.boothName}
                staffName={lookups.staffName}
              />
            </>
          )}
          {needStock === false ? (
            <NoStockTrackingCard />
          ) : (
            <>
              <LowStockCard rows={low} boothName={boothId ? null : lookups.boothName} />
              <SlowMoversCard rows={slow} boothName={boothId ? null : lookups.boothName} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function NothingSold({ includesToday, shopOpen, boothSelected }: { includesToday: boolean; shopOpen: boolean; boothSelected: boolean }) {
  if (includesToday && shopOpen)
    return (
      <EmptyState
        icon={<ShoppingBag size={28} />}
        title="ยังไม่มียอดขาย"
        hint="เปิดร้านแล้ว ขายบิลแรกที่หน้าขาย ยอดจะขึ้นที่นี่ทันที"
        action={
          <Link to="/pos" className="btn btn-primary">
            ไปหน้าขาย
          </Link>
        }
      />
    )
  if (includesToday)
    return (
      <EmptyState
        icon={<Wallet size={28} />}
        title="วันนี้ยังไม่มียอดขาย"
        hint="เปิดร้านที่หน้าปิดยอด ใส่เงินทอนตั้งต้น แล้วเริ่มขาย ยอดจะขึ้นที่นี่ทันที"
        action={
          <Link to="/shift" className="btn btn-primary">
            เปิดร้าน
          </Link>
        }
      />
    )
  return (
    <EmptyState
      title="ไม่มียอดขายในช่วงนี้"
      hint={boothSelected ? 'ลองเลือกช่วงวันอื่น หรือกด “ทุกแผง”' : 'ลองเลือกช่วงวันอื่น'}
    />
  )
}
