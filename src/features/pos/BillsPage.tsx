// บิล — bills of the current shift (or a chosen day/booth for the owner), with voiding.
import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Ban, ReceiptText, RotateCcw, TriangleAlert } from 'lucide-react'
import { alive, db } from '../../db'
import { useDevice } from '../../device'
import { useBooths, useOpenShift, useShop, useStaffList } from '../../hooks'
import { useSession } from '../../session'
import { computeShiftTotals, PAY_METHODS } from '../../domain/shift'
import { todayKey } from '../../lib/dates'
import { baht, thaiDate, timeHM } from '../../lib/format'
import type { DayKey, ID, PayMethod, Sale, Shift, ShopConfig } from '../../types'
import { Badge, Button, EmptyState, Money, Spinner } from '../../ui'
import BillDetailModal from './BillDetailModal'
import PosErrorBoundary from './PosErrorBoundary'
import { itemsSummary, METHOD_TONE, methodLabel } from './util'
import './pos.css'

export default function BillsPage() {
  return (
    <PosErrorBoundary>
      <BillsScreen />
    </PosErrorBoundary>
  )
}

type View = { kind: 'shift'; shift: Shift } | { kind: 'day'; dayKey: DayKey; boothId: ID | 'all' }
type Filter = 'all' | PayMethod | 'void'

type BillsData = { key: string } & ({ ok: true; sales: Sale[]; shifts: Map<ID, Shift> } | { ok: false })

function useBills(view: View | null): BillsData | undefined {
  const kind = view?.kind ?? 'none'
  const shiftId = view?.kind === 'shift' ? view.shift.id : ''
  const dayKey = view?.kind === 'day' ? view.dayKey : ''
  const boothId = view?.kind === 'day' ? view.boothId : ''
  const key = `${kind}|${shiftId}|${dayKey}|${boothId}`
  const data = useLiveQuery(async (): Promise<BillsData> => {
    try {
      let rows: Sale[]
      if (kind === 'shift') rows = await db.sales.where('shiftId').equals(shiftId).toArray()
      else if (kind === 'day' && boothId === 'all') rows = await db.sales.where('dayKey').equals(dayKey).toArray()
      else if (kind === 'day') rows = await db.sales.where('[boothId+dayKey]').equals([boothId, dayKey]).toArray()
      else rows = []
      const sales = alive(rows).sort((a, b) => b.createdAt - a.createdAt)
      const ids = [...new Set(sales.map((s) => s.shiftId))]
      const shiftRows = ids.length ? await db.shifts.bulkGet(ids) : []
      const shifts = new Map<ID, Shift>()
      for (const s of shiftRows) if (s && s.deleted !== 1) shifts.set(s.id, s)
      return { key, ok: true, sales, shifts }
    } catch (e) {
      console.error('[bills] load failed', e)
      return { key, ok: false }
    }
  }, [key])
  // A live query keeps its previous result for a moment after the view changes — hide it.
  return data && data.key === key ? data : undefined
}

function BillsScreen() {
  const { boothId: deviceBooth } = useDevice()
  const { staff, isOwner } = useSession()
  const shop = useShop()
  const booths = useBooths(true)
  const staffList = useStaffList(true)
  const openShiftRaw = useOpenShift(deviceBooth)
  const openShift = openShiftRaw && openShiftRaw.boothId === deviceBooth ? openShiftRaw : openShiftRaw === undefined ? undefined : null

  const [pick, setPick] = useState<{ dayKey: DayKey; boothId: ID | 'all' } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<ID | null>(null)

  const today = todayKey()
  const view: View | null =
    pick && isOwner
      ? { kind: 'day', dayKey: pick.dayKey, boothId: pick.boothId }
      : openShift === undefined
        ? null
        : openShift
          ? { kind: 'shift', shift: openShift }
          : deviceBooth
            ? { kind: 'day', dayKey: today, boothId: deviceBooth }
            : null

  const data = useBills(view)

  const boothName = useMemo(() => {
    const m = new Map((booths ?? []).map((b) => [b.id, b.name]))
    return (id: ID) => m.get(id) ?? 'แผง'
  }, [booths])
  const staffName = useMemo(() => {
    const m = new Map((staffList ?? []).map((s) => [s.id, s.name]))
    return (id: ID | null) => (id ? m.get(id) ?? '—' : '—')
  }, [staffList])
  const ownerPinLengths = useMemo(
    () => [...new Set((staffList ?? []).filter((s) => s.role === 'owner' && s.active === 1).map((s) => s.pin.length))].sort((a, b) => a - b),
    [staffList],
  )

  if (!staff || (!pick && openShift === undefined)) return <Loading />
  if (view === null)
    return (
      <div className="page">
        <EmptyState title="เครื่องนี้ยังไม่ได้เลือกแผง" hint="แตะชื่อแผงด้านบนเพื่อเลือก" />
      </div>
    )

  const shownDay = view.kind === 'shift' ? view.shift.dayKey : view.dayKey
  const shownBooth: ID | 'all' = view.kind === 'shift' ? view.shift.boothId : view.boothId

  const sub =
    view.kind === 'shift'
      ? `กะที่เปิดอยู่ · ${boothName(view.shift.boothId)} · เปิด ${thaiDate(view.shift.dayKey)} ${timeHM(view.shift.openedAt)}`
      : `${thaiDate(shownDay)} · ${shownBooth === 'all' ? 'ทุกแผง' : boothName(shownBooth)}`

  return (
    <div className="page pos-bills">
      <header className="page-header">
        <div className="page-header-main">
          <h1 className="page-header-title">บิล</h1>
          <div className="page-header-sub">{sub}</div>
        </div>
      </header>

      {isOwner && (
        <div className="pos-bills-filter">
          <label className="field">
            <span className="field-label">วันที่</span>
            <input
              type="date"
              className="input"
              value={shownDay}
              max={today > shownDay ? today : shownDay}
              onChange={(e) => {
                if (!e.target.value) return
                setPick({ dayKey: e.target.value, boothId: shownBooth })
                setFilter('all')
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">แผง</span>
            <select
              className="select"
              value={shownBooth}
              onChange={(e) => {
                setPick({ dayKey: shownDay, boothId: e.target.value })
                setFilter('all')
              }}
            >
              <option value="all">ทุกแผง</option>
              {(booths ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.active === 1 ? '' : ' (ปิดใช้)'}
                </option>
              ))}
            </select>
          </label>
          {pick && (
            <Button
              variant="ghost"
              icon={<RotateCcw size={18} />}
              className="pos-bills-reset"
              onClick={() => {
                setPick(null)
                setFilter('all')
              }}
            >
              {openShift ? 'กะที่เปิดอยู่' : 'วันนี้'}
            </Button>
          )}
        </div>
      )}

      {data === undefined ? (
        <Loading />
      ) : !data.ok ? (
        <EmptyState
          icon={<TriangleAlert size={28} />}
          title="โหลดบิลไม่สำเร็จ"
          hint="ลองโหลดหน้าใหม่"
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              โหลดใหม่
            </Button>
          }
        />
      ) : (
        <BillsList
          sales={data.sales}
          shifts={data.shifts}
          shop={shop}
          showBooth={shownBooth === 'all'}
          filter={filter}
          setFilter={setFilter}
          boothName={boothName}
          staffName={staffName}
          onOpen={setOpenId}
          emptyHint={view.kind === 'shift' ? 'ขายแล้วบิลจะขึ้นที่นี่' : 'ไม่มีบิลในวันและแผงที่เลือก'}
        />
      )}

      {openId &&
        data?.ok &&
        (() => {
          const sale = data.sales.find((s) => s.id === openId)
          if (!sale) return null
          return (
            <BillDetailModal
              key={sale.id}
              sale={sale}
              shift={data.shifts.get(sale.shiftId)}
              shop={shop}
              boothName={boothName(sale.boothId)}
              staffName={staffName}
              isOwner={isOwner}
              sessionStaffId={staff.id}
              ownerPinLengths={ownerPinLengths}
              onClose={() => setOpenId(null)}
            />
          )
        })()}
    </div>
  )
}

function Loading() {
  return (
    <div className="page-loading">
      <Spinner size={28} />
    </div>
  )
}

interface ListProps {
  sales: Sale[]
  shifts: Map<ID, Shift>
  shop: ShopConfig | undefined
  showBooth: boolean
  filter: Filter
  setFilter: (f: Filter) => void
  boothName: (id: ID) => string
  staffName: (id: ID | null) => string
  onOpen: (id: ID) => void
  emptyHint: string
}

function BillsList({ sales, shifts, shop, showBooth, filter, setFilter, boothName, staffName, onOpen, emptyHint }: ListProps) {
  const totals = useMemo(() => computeShiftTotals(0, sales, []), [sales])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: sales.length, cash: 0, transfer: 0, halfhalf: 0, other: 0, void: 0 }
    for (const s of sales) {
      if (s.status === 'void') c.void += 1
      else if (s.method in c) c[s.method] += 1
    }
    return c
  }, [sales])

  const shown = useMemo(
    () =>
      sales.filter((s) =>
        filter === 'all' ? true : filter === 'void' ? s.status === 'void' : s.status === 'paid' && s.method === filter,
      ),
    [sales, filter],
  )

  // Several shifts in view (a day with two shifts, or all booths) → group by shift.
  const groups = useMemo(() => {
    const ids = [...new Set(shown.map((s) => s.shiftId))]
    if (ids.length <= 1) return [{ shiftId: ids[0] ?? '', rows: shown }]
    const byShift = new Map<ID, Sale[]>()
    for (const s of shown) {
      const arr = byShift.get(s.shiftId)
      if (arr) arr.push(s)
      else byShift.set(s.shiftId, [s])
    }
    return [...byShift.entries()]
      .map(([shiftId, rows]) => ({ shiftId, rows }))
      .sort((a, b) => (shifts.get(b.shiftId)?.openedAt ?? b.rows[0].createdAt) - (shifts.get(a.shiftId)?.openedAt ?? a.rows[0].createdAt))
  }, [shown, shifts])

  if (sales.length === 0)
    return <EmptyState icon={<ReceiptText size={28} />} title="ยังไม่มีบิล" hint={emptyHint} />

  const chips: Filter[] = ['all', ...PAY_METHODS.filter((m) => counts[m] > 0), ...(counts.void > 0 ? (['void'] as Filter[]) : [])]

  return (
    <div className="stack">
      <section className="card pos-bills-sum">
        <div className="pos-bills-sum-main">
          <span className="muted">ยอดขาย</span>
          <Money value={totals.total} size="xl" />
          <span className="text-2 num">
            {totals.bills} บิล · {totals.pieces} ชิ้น
          </span>
        </div>
        <ul className="pos-bills-methods">
          {PAY_METHODS.filter((m) => m === 'cash' || totals.byMethod[m] > 0).map((m) => (
            <li key={m}>
              <span>{methodLabel(m, shop)}</span>
              <Money value={totals.byMethod[m]} />
            </li>
          ))}
          {totals.manualDiscount > 0 && (
            <li className="text-2">
              <span>ลูกค้าต่อรวม</span>
              <span className="money num">−฿{baht(totals.manualDiscount)}</span>
            </li>
          )}
          {totals.voidBills > 0 && (
            <li className="tone-danger">
              <span>ยกเลิก {totals.voidBills} บิล</span>
              <Money value={totals.voidTotal} />
            </li>
          )}
        </ul>
      </section>

      {chips.length > 2 && (
        <div className="pos-chip-scroll" role="group" aria-label="กรองบิล">
          {chips.map((f) => (
            <button
              key={f}
              type="button"
              className={'chip' + (filter === f ? ' active' : '')}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'ทั้งหมด' : f === 'void' ? 'ยกเลิกแล้ว' : methodLabel(f, shop)}
              <span className="pos-chip-count num">{counts[f]}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <EmptyState compact title="ไม่มีบิลแบบนี้" action={<Button onClick={() => setFilter('all')}>ดูทั้งหมด</Button>} />
      ) : (
        groups.map((g) => {
          const sh = shifts.get(g.shiftId)
          return (
            <section key={g.shiftId} className="stack-sm">
              {groups.length > 1 && (
                <h2 className="pos-group-title">
                  {showBooth && <span>{boothName(g.rows[0].boothId)}</span>}
                  <span className="muted">
                    {sh ? `กะเปิด ${timeHM(sh.openedAt)}` : 'กะ'}
                    {sh ? (sh.status === 'open' ? ' · ยังไม่ปิดยอด' : ` · ปิดยอด ${sh.closedAt ? timeHM(sh.closedAt) : ''}`) : ''}
                  </span>
                </h2>
              )}
              <ul className="pos-bill-list">
                {g.rows.map((s) => (
                  <li key={s.id}>
                    <BillRow
                      sale={s}
                      shop={shop}
                      staffName={staffName}
                      boothLabel={showBooth ? boothName(s.boothId) : null}
                      onOpen={onOpen}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}

function BillRow({
  sale,
  shop,
  staffName,
  boothLabel,
  onOpen,
}: {
  sale: Sale
  shop: ShopConfig | undefined
  staffName: (id: ID | null) => string
  boothLabel: string | null
  onOpen: (id: ID) => void
}) {
  const isVoid = sale.status === 'void'
  return (
    <button type="button" className={'pos-bill' + (isVoid ? ' void' : '')} onClick={() => onOpen(sale.id)}>
      <div className="pos-bill-main">
        <div className="pos-bill-top">
          <strong className="num">#{sale.billNo}</strong>
          <span className="muted num">{timeHM(sale.createdAt)}</span>
          <Badge tone={METHOD_TONE[sale.method] ?? 'neutral'}>{methodLabel(sale.method, shop)}</Badge>
          {isVoid && (
            <Badge tone="danger" icon={<Ban size={14} />}>
              ยกเลิกแล้ว
            </Badge>
          )}
        </div>
        <div className="pos-bill-items">{itemsSummary(sale.items)}</div>
        <div className="pos-bill-meta">
          {boothLabel ? `${boothLabel} · ` : ''}
          {staffName(sale.staffId)}
          {isVoid && sale.voidReason ? <span className="tone-danger"> · {sale.voidReason}</span> : null}
        </div>
      </div>
      <div className="pos-bill-amt">
        <Money value={sale.total} size="lg" className={isVoid ? 'pos-struck' : ''} />
        <span className="muted pos-small num">{sale.pieces} ชิ้น</span>
      </div>
    </button>
  )
}
