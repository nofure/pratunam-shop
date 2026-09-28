// /shift/history — closed shifts grouped by business day. Owner: every booth, month by month,
// plus the shifts still open. Staff: this device's booth, last 30 days.
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { alive, db } from '../../db'
import { useDevice } from '../../device'
import { computeShiftTotals } from '../../domain/shift'
import { useBooths } from '../../hooks'
import { addDays, addMonths, dayKeyOf, endOfMonth, startOfMonth, todayKey } from '../../lib/dates'
import { bahtSign, dateTime, num, round2, thaiDate, thaiDateLong, thaiMonth, timeHM } from '../../lib/format'
import { useSession } from '../../session'
import type { DayKey, ID, Shift, ShiftTotals } from '../../types'
import { Badge, Card, EmptyState, IconButton, Money, PageHeader, cx } from '../../ui'
import { ShiftDetailModal } from './ShiftDetailModal'
import { DiffBadge, Loading, ShiftErrorBoundary, useBoothNames, useStaffNames } from './parts'
import './shift.css'

type BoothFilter = ID | 'all'

interface HistoryData {
  closed: Shift[]
  open: { shift: Shift; totals: ShiftTotals }[]
}

export default function ShiftHistoryPage() {
  return (
    <ShiftErrorBoundary>
      <HistoryInner />
    </ShiftErrorBoundary>
  )
}

function HistoryInner() {
  const { isOwner } = useSession()
  const { boothId: deviceBoothId } = useDevice()
  const booths = useBooths(true)
  const staffName = useStaffNames()
  const boothName = useBoothNames()
  const today = todayKey()
  const thisMonth = startOfMonth(today)
  // Links from other pages (e.g. a drawer cash-out on the expenses page): ?shift=<id>&day=<dayKey>
  // opens that shift and shows its month.
  const [params, setParams] = useSearchParams()
  const linkedDay = params.get('day')
  const [month, setMonth] = useState<DayKey>(() =>
    linkedDay && /^\d{4}-\d{2}-\d{2}$/.test(linkedDay) && linkedDay <= today ? startOfMonth(linkedDay) : thisMonth,
  )
  const [boothFilter, setBoothFilter] = useState<BoothFilter>('all')
  const [detailId, setDetailId] = useState<ID | null>(() => params.get('shift'))
  const closeDetail = () => {
    setDetailId(null)
    if (params.has('shift') || params.has('day')) setParams({}, { replace: true })
  }

  const from = isOwner ? month : addDays(today, -29)
  const to = isOwner ? endOfMonth(month) : today
  const scopeBooth: ID | null = isOwner ? (boothFilter === 'all' ? null : boothFilter) : deviceBoothId

  const data = useLiveQuery(async (): Promise<HistoryData> => {
    if (!isOwner && !scopeBooth) return { closed: [], open: [] }
    const inBooth = (s: Shift) => !scopeBooth || s.boothId === scopeBooth
    const rows = alive(await db.shifts.where('dayKey').between(from, to, true, true).toArray())
    const closed = rows
      .filter((s) => s.status === 'closed' && inBooth(s))
      .sort((a, b) => (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt))
    let open: HistoryData['open'] = []
    if (isOwner) {
      const openRows = alive(await db.shifts.where('status').equals('open').toArray())
        .filter(inBooth)
        .sort((a, b) => a.openedAt - b.openedAt)
      open = await Promise.all(
        openRows.map(async (shift) => {
          const [sales, moves] = await Promise.all([
            db.sales.where('shiftId').equals(shift.id).toArray(),
            db.cashMoves.where('shiftId').equals(shift.id).toArray(),
          ])
          return { shift, totals: computeShiftTotals(shift.openingFloat, sales, moves) }
        }),
      )
    }
    return { closed, open }
  }, [isOwner, scopeBooth, from, to])

  const groups = useMemo(() => {
    const m = new Map<DayKey, Shift[]>()
    for (const s of data?.closed ?? []) {
      const list = m.get(s.dayKey)
      if (list) list.push(s)
      else m.set(s.dayKey, [s])
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
  }, [data])

  const stats = useMemo(() => {
    let sales = 0
    let short = 0
    let shortSum = 0
    let over = 0
    let overSum = 0
    for (const s of data?.closed ?? []) {
      sales += s.snapshot?.total ?? 0
      const d = round2(s.cashDiff ?? 0)
      if (d < 0) {
        short += 1
        shortSum += -d
      } else if (d > 0) {
        over += 1
        overSum += d
      }
    }
    return { sales: round2(sales), short, shortSum: round2(shortSum), over, overSum: round2(overSum) }
  }, [data])

  const showBoothFilter = isOwner && (booths?.length ?? 0) > 1

  return (
    <div className="page shift-page">
      <PageHeader title="ประวัติการปิดยอด" back sub={isOwner ? undefined : `${boothName(deviceBoothId)} · 30 วันล่าสุด`} />

      {isOwner && (
        <div className="stack-sm shift-filters">
          <div className="shift-monthnav">
            <IconButton label="เดือนก่อน" icon={<ChevronLeft size={24} />} variant="secondary" onClick={() => setMonth(addMonths(month, -1))} />
            <strong className="shift-monthnav-label">{thaiMonth(month)}</strong>
            <IconButton
              label="เดือนถัดไป"
              icon={<ChevronRight size={24} />}
              variant="secondary"
              disabled={month >= thisMonth}
              onClick={() => setMonth(addMonths(month, 1))}
            />
          </div>
          {showBoothFilter && booths && (
            <div className="shift-chips shift-chips-scroll" role="group" aria-label="เลือกแผง">
              <button
                type="button"
                className={cx('chip', boothFilter === 'all' && 'active')}
                aria-pressed={boothFilter === 'all'}
                onClick={() => setBoothFilter('all')}
              >
                ทุกแผง
              </button>
              {booths.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={cx('chip', boothFilter === b.id && 'active')}
                  aria-pressed={boothFilter === b.id}
                  onClick={() => setBoothFilter(b.id)}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {data === undefined ? (
        <Loading />
      ) : !isOwner && !deviceBoothId ? (
        <EmptyState title="เครื่องนี้ยังไม่ได้เลือกแผง" hint="กดชื่อแผงด้านบนเพื่อเลือกแผงของเครื่องนี้" />
      ) : (
        <div className="stack">
          {data.open.length > 0 && (
            <Card title="ยังไม่ปิดยอด" flush>
              <div className="shift-hlist">
                {data.open.map(({ shift, totals }) => {
                  const stale = shift.dayKey < today
                  return (
                    <button key={shift.id} type="button" className="list-row list-link shift-hrow" onClick={() => setDetailId(shift.id)}>
                      <span className="list-main">
                        <span className="list-title">{boothName(shift.boothId)}</span>
                        <span className="list-sub">
                          เปิดตั้งแต่ {dayKeyOf(shift.openedAt) === today ? timeHM(shift.openedAt) : dateTime(shift.openedAt)} ·{' '}
                          {staffName(shift.staffId)}
                        </span>
                      </span>
                      <span className="shift-hrow-right">
                        <Money value={totals.total} />
                        {stale ? (
                          <Badge tone="warning">ค้างจาก {thaiDate(shift.dayKey)}</Badge>
                        ) : (
                          <Badge tone="info">เปิดอยู่</Badge>
                        )}
                      </span>
                      <ChevronRight size={20} className="muted shift-hrow-go" aria-hidden="true" />
                    </button>
                  )
                })}
              </div>
            </Card>
          )}

          {data.closed.length > 0 && (
            <div className="grid-3 shift-hstats">
              <div className="shift-box">
                <span className="shift-label">ยอดขายรวม</span>
                <Money value={stats.sales} size="lg" />
                <span className="muted">{num(data.closed.length)} รอบ</span>
              </div>
              <div className="shift-box">
                <span className="shift-label">เงินขาด</span>
                <span className={cx('shift-hstat-value num', stats.short > 0 && 'tone-danger')}>{bahtSign(stats.shortSum)}</span>
                <span className="muted">{num(stats.short)} ครั้ง</span>
              </div>
              <div className="shift-box">
                <span className="shift-label">เงินเกิน</span>
                <span className={cx('shift-hstat-value num', stats.over > 0 && 'tone-warning')}>{bahtSign(stats.overSum)}</span>
                <span className="muted">{num(stats.over)} ครั้ง</span>
              </div>
            </div>
          )}

          {groups.length === 0 ? (
            <EmptyState
              title={isOwner ? `ยังไม่มีการปิดยอดใน${thaiMonth(month)}` : 'ยังไม่มีการปิดยอดใน 30 วันที่ผ่านมา'}
              hint="ปิดยอดได้ที่หน้าปิดยอด เมื่อเลิกขายแต่ละวัน"
            />
          ) : (
            groups.map(([day, list]) => {
              const dayTotal = round2(list.reduce((sum, s) => sum + (s.snapshot?.total ?? 0), 0))
              return (
                <section key={day}>
                  <h2 className="section-title shift-day-title">
                    <span>{thaiDateLong(day)}</span>
                    <span className="num">{bahtSign(dayTotal)}</span>
                  </h2>
                  <div className="list shift-hlist">
                    {list.map((s) => (
                      <button key={s.id} type="button" className="list-row list-link shift-hrow" onClick={() => setDetailId(s.id)}>
                        <span className="list-main">
                          <span className="list-title">{boothName(s.boothId)}</span>
                          <span className="list-sub">
                            ปิดโดย {staffName(s.closedBy)} · {timeHM(s.openedAt)}–{s.closedAt ? timeHM(s.closedAt) : '–'}
                            {s.snapshot ? ` · ${num(s.snapshot.bills)} บิล` : ''}
                          </span>
                        </span>
                        <span className="shift-hrow-right">
                          <Money value={s.snapshot?.total ?? 0} />
                          <DiffBadge diff={s.cashDiff} />
                        </span>
                        <ChevronRight size={20} className="muted shift-hrow-go" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </section>
              )
            })
          )}
        </div>
      )}

      <ShiftDetailModal shiftId={detailId} onClose={closeDetail} />
    </div>
  )
}
