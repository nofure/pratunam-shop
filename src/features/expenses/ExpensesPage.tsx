// Owner page: monthly business expenses (rent, electricity, wages, bags …) per booth or for the whole shop.
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CopyPlus, Info, Plus, Receipt } from 'lucide-react'
import type { CashMove, DayKey, Expense, ID } from '../../types'
import { useSession } from '../../session'
import { addMonths, startOfMonth, todayKey } from '../../lib/dates'
import { bahtSign, round2, thaiDateShort, thaiMonth } from '../../lib/format'
import { Button, Card, EmptyState, HBarList, IconButton, Money, PageHeader, cx, useToast } from '../../ui'
import ExpenseFormModal from './ExpenseFormModal'
import CopyLastMonthModal from './CopyLastMonthModal'
import { CategoryIcon, categoryLabel } from './parts'
import { useAllBooths, useExpenseMonth, type ExpenseMonthData } from './useExpenseMonth'
import {
  MIN_MONTH,
  categoryTotals,
  copyCandidates,
  defaultDayForMonth,
  groupByDay,
  matchesBooth,
  maxMonth,
  monthParam,
  parseMonthParam,
  sumAmount,
  type BoothFilter,
} from './logic'
import './expenses.css'

const WHOLE_SHOP = 'ทั้งร้าน'
const UNKNOWN_BOOTH = 'ไม่ทราบแผง'

export default function ExpensesPage() {
  const toast = useToast()
  const { staff } = useSession()
  const today = todayKey()
  const thisMonth = startOfMonth(today)
  const lastAllowed = maxMonth(today)

  const [params, setParams] = useSearchParams()
  const month = parseMonthParam(params.get('m'), thisMonth, lastAllowed)
  const rawBooth: BoothFilter = params.get('b') || 'all'
  const state = useExpenseMonth(month)
  const allBooths = useAllBooths()
  const ready = state.status === 'ready' && allBooths !== undefined ? state : null

  const [form, setForm] = useState<{ expense: Expense | null } | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)

  // ---- booths
  const booths = allBooths ?? []
  const boothById = new Map(booths.map((b) => [b.id, b]))
  const boothName = (id: ID | null) => (id === null ? WHOLE_SHOP : (boothById.get(id)?.name ?? UNKNOWN_BOOTH))
  const activeBooths = booths.filter((b) => b.deleted !== 1 && b.active === 1)
  const usedBoothIds = new Set<ID | null>([
    ...(ready?.expenses ?? []).map((e) => e.boothId),
    ...(ready?.drawer ?? []).map((m) => m.boothId),
  ])
  // Filter chips: active booths, plus old booths that still have records this month.
  const chipBooths = booths.filter((b) => (b.deleted !== 1 && b.active === 1) || usedBoothIds.has(b.id))
  // Keep the chosen booth while a month loads; once loaded, drop an unknown booth id.
  const filter: BoothFilter =
    rawBooth === 'all' || !ready || (chipBooths.length >= 2 && chipBooths.some((b) => b.id === rawBooth))
      ? rawBooth
      : 'all'

  const setView = (next: { month?: DayKey; booth?: BoothFilter }) => {
    const p = new URLSearchParams(params)
    const m = next.month ?? month
    if (m === thisMonth) p.delete('m')
    else p.set('m', monthParam(m))
    const b = next.booth ?? filter
    if (b === 'all') p.delete('b')
    else p.set('b', b)
    setParams(p, { replace: true })
  }

  const openAdd = () => setForm({ expense: null })

  const onSaved = (rec: Expense, isNew: boolean) => {
    setForm(null)
    const recMonth = startOfMonth(rec.dayKey)
    const monthMoved = recMonth !== month
    const boothHidden = !matchesBooth(filter, rec.boothId)
    if (monthMoved || boothHidden) setView({ month: recMonth, booth: boothHidden ? 'all' : filter })
    toast(monthMoved ? `บันทึกแล้ว · อยู่ในเดือน${thaiMonth(rec.dayKey)}` : isNew ? 'เพิ่มแล้ว' : 'บันทึกแล้ว', 'success')
  }

  // Copy offers what the current view shows: every booth, or only the chosen booth.
  const candidates = ready
    ? copyCandidates(
        ready.prevExpenses.filter((e) => matchesBooth(filter, e.boothId)),
        ready.expenses,
        month,
      )
    : []
  const boothIsActive = (id: ID | null) => id === null || activeBooths.some((b) => b.id === id)
  // Entries that would start ticked: not copied yet and the booth is still in use.
  const newCandidates = candidates.filter((c) => !c.exists && boothIsActive(c.source.boothId)).length

  const monthNav = (
    <div className="exp-toolbar">
      <div className="exp-month" role="group" aria-label="เลือกเดือน">
        <IconButton
          variant="secondary"
          label="เดือนก่อน"
          icon={<ChevronLeft size={26} />}
          disabled={month <= MIN_MONTH}
          onClick={() => setView({ month: addMonths(month, -1) })}
        />
        <span className="exp-month-label" aria-live="polite">
          {thaiMonth(month)}
        </span>
        <IconButton
          variant="secondary"
          label="เดือนถัดไป"
          icon={<ChevronRight size={26} />}
          disabled={month >= lastAllowed}
          onClick={() => setView({ month: addMonths(month, 1) })}
        />
      </div>
      {month !== thisMonth && (
        <button type="button" className="chip" onClick={() => setView({ month: thisMonth })}>
          กลับเดือนนี้
        </button>
      )}
    </div>
  )

  const boothChips =
    chipBooths.length >= 2 ? (
      <div className="exp-filter" role="group" aria-label="ดูเฉพาะแผง">
        <button
          type="button"
          className={cx('chip', filter === 'all' && 'active')}
          aria-pressed={filter === 'all'}
          onClick={() => setView({ booth: 'all' })}
        >
          {WHOLE_SHOP}
        </button>
        {chipBooths.map((b) => (
          <button
            key={b.id}
            type="button"
            className={cx('chip', filter === b.id && 'active')}
            aria-pressed={filter === b.id}
            onClick={() => setView({ booth: b.id })}
          >
            {b.name}
          </button>
        ))}
      </div>
    ) : null

  let body
  if (state.status === 'loading' || allBooths === undefined) {
    body = <div className="page-loading">กำลังโหลด…</div>
  } else if (state.status === 'error') {
    body = (
      <EmptyState
        title="โหลดข้อมูลไม่สำเร็จ"
        hint="ข้อมูลในเครื่องยังอยู่ ลองเปิดหน้านี้ใหม่อีกครั้ง"
        action={
          <Button variant="primary" onClick={() => window.location.reload()}>
            โหลดใหม่
          </Button>
        }
      />
    )
  } else {
    body = (
      <MonthView
        data={state}
        filter={filter}
        boothName={boothName}
        newCandidates={newCandidates}
        onAdd={openAdd}
        onEdit={(expense) => setForm({ expense })}
        onCopy={() => setCopyOpen(true)}
      />
    )
  }

  return (
    <div className="page exp-page">
      <PageHeader
        title="ค่าใช้จ่าย"
        actions={
          <Button variant="primary" icon={<Plus size={20} />} onClick={openAdd} disabled={!ready}>
            เพิ่ม
          </Button>
        }
      />
      {monthNav}
      {boothChips}
      {body}

      {form && ready && (
        <ExpenseFormModal
          key={form.expense?.id ?? 'new'}
          expense={form.expense}
          defaultDay={defaultDayForMonth(month, today)}
          defaultBoothId={filter !== 'all' && activeBooths.some((b) => b.id === filter) ? filter : null}
          booths={activeBooths}
          boothName={boothName}
          staffId={staff?.id ?? null}
          onClose={() => setForm(null)}
          onSaved={(rec) => onSaved(rec, form.expense === null)}
          onDeleted={() => {
            setForm(null)
            toast('ลบแล้ว', 'success')
          }}
        />
      )}

      {copyOpen && ready && (
        <CopyLastMonthModal
          candidates={candidates}
          fromMonth={addMonths(month, -1)}
          toMonth={month}
          scope={filter === 'all' ? null : boothName(filter)}
          boothName={boothName}
          boothExists={boothIsActive}
          staffId={staff?.id ?? null}
          onClose={() => setCopyOpen(false)}
          onDone={(copied) => {
            setCopyOpen(false)
            toast(`คัดลอกแล้ว ${copied.length} รายการ`, 'success')
          }}
        />
      )}
    </div>
  )
}

interface MonthViewProps {
  data: ExpenseMonthData
  filter: BoothFilter
  boothName: (id: ID | null) => string
  newCandidates: number
  onAdd: () => void
  onEdit: (e: Expense) => void
  onCopy: () => void
}

function MonthView({ data, filter, boothName, newCandidates, onAdd, onEdit, onCopy }: MonthViewProps) {
  const inFilter = (r: { boothId: ID | null }) => matchesBooth(filter, r.boothId)
  const expenses = data.expenses.filter(inFilter)
  const drawer = data.drawer.filter(inFilter)
  const recorded = sumAmount(expenses)
  const fromDrawer = sumAmount(drawer)
  const total = round2(recorded + fromDrawer)
  const prevTotal = round2(sumAmount(data.prevExpenses.filter(inFilter)) + sumAmount(data.prevDrawer.filter(inFilter)))
  const shopWide = filter === 'all' ? 0 : sumAmount(data.expenses.filter((e) => e.boothId === null))
  const cats = categoryTotals(expenses, drawer)
  const groups = groupByDay(expenses)
  const prevMonth = addMonths(data.month, -1)

  const copyButton =
    newCandidates > 0 ? (
      <Button variant="secondary" size="lg" block icon={<CopyPlus size={22} />} onClick={onCopy}>
        คัดลอกจากเดือนก่อน ({newCandidates})
      </Button>
    ) : null

  const shopWideNote =
    shopWide > 0 ? (
      <p className="exp-note">
        <Info size={16} aria-hidden="true" />
        <span>
          ไม่รวมค่าใช้จ่ายที่ลงเป็น{WHOLE_SHOP} {bahtSign(shopWide)} · กด “{WHOLE_SHOP}” ด้านบนเพื่อดูทั้งหมด
        </span>
      </p>
    ) : null

  if (expenses.length === 0 && drawer.length === 0) {
    return (
      <div className="stack exp-empty">
        <EmptyState
          icon={<Receipt size={28} />}
          title={
            filter === 'all'
              ? `ยังไม่มีค่าใช้จ่ายเดือน${thaiMonth(data.month)}`
              : `ยังไม่มีค่าใช้จ่ายของ${boothName(filter)} เดือน${thaiMonth(data.month)}`
          }
          hint="จดค่าเช่าแผง ค่าไฟ ค่าจ้างคนขาย ค่าถุงและไม้แขวน เพื่อให้กำไรในรายงานตรงกับเงินที่เหลือจริง"
          action={
            <div className="exp-empty-actions">
              <Button variant="primary" size="lg" block icon={<Plus size={22} />} onClick={onAdd}>
                เพิ่มค่าใช้จ่าย
              </Button>
              {copyButton}
            </div>
          }
        />
        {shopWideNote}
      </div>
    )
  }

  return (
    <div className="exp-layout">
      <div className="exp-side stack">
        <Card className="exp-summary">
          <p className="exp-summary-label">
            รวมค่าใช้จ่าย{filter === 'all' ? 'ทั้งเดือน' : ` · ${boothName(filter)}`}
          </p>
          <Money value={total} size="xl" />
          {fromDrawer > 0 && (
            <p className="exp-summary-sub num">
              จดเอง {bahtSign(recorded)} · จ่ายจากลิ้นชัก {bahtSign(fromDrawer)}
            </p>
          )}
          {prevTotal > 0 && (
            <p className="exp-summary-sub num">
              เดือน{thaiMonth(prevMonth)} {bahtSign(prevTotal)}
            </p>
          )}
          {shopWideNote}
          {cats.length > 0 && (
            <>
              <hr className="divider" />
              <HBarList
                rows={cats.map((r) => ({
                  label: categoryLabel(r.category),
                  value: r.total,
                  sub:
                    `${r.count} รายการ` +
                    (r.fromDrawer > 0 && r.fromDrawer !== r.total ? ` · จากลิ้นชัก ${bahtSign(r.fromDrawer)}` : '') +
                    (r.fromDrawer > 0 && r.fromDrawer === r.total ? ' · จากลิ้นชักทั้งหมด' : ''),
                }))}
              />
            </>
          )}
        </Card>
        {copyButton}
      </div>

      <div className="exp-main stack">
        <section aria-labelledby="exp-recorded-title">
          <h2 className="section-title" id="exp-recorded-title">
            <span>รายการที่จด</span>
            <span className="exp-section-count">{expenses.length} รายการ</span>
          </h2>
          {groups.length === 0 ? (
            <Card>
              <EmptyState
                compact
                icon={null}
                title="ยังไม่มีรายการที่จดเอง"
                hint="ค่าเช่าแผง ค่าไฟ ค่าจ้าง ที่จ่ายนอกลิ้นชัก จดที่นี่"
                action={
                  <Button variant="primary" icon={<Plus size={20} />} onClick={onAdd}>
                    เพิ่มค่าใช้จ่าย
                  </Button>
                }
              />
            </Card>
          ) : (
            <div className="stack">
              {groups.map((g) => (
                <div key={g.dayKey} className="exp-day">
                  <div className="exp-day-head">
                    <span>{thaiDateShort(g.dayKey)}</span>
                    <Money value={g.total} />
                  </div>
                  <ul className="list exp-list">
                    {g.rows.map((e) => (
                      <li key={e.id}>
                        <button type="button" className="list-row list-link exp-row" onClick={() => onEdit(e)}>
                          <CategoryIcon category={e.category} />
                          <span className="list-main">
                            <span className="list-title">{categoryLabel(e.category)}</span>
                            <span className="list-sub">
                              {boothName(e.boothId)}
                              {e.note ? ` · ${e.note}` : ''}
                            </span>
                          </span>
                          <Money value={e.amount} className="exp-amount" />
                          <ChevronRight size={18} className="exp-row-chevron" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {drawer.length > 0 && <DrawerSection moves={drawer} total={fromDrawer} data={data} boothName={boothName} />}
      </div>
    </div>
  )
}

function DrawerSection({
  moves,
  total,
  data,
  boothName,
}: {
  moves: CashMove[]
  total: number
  data: ExpenseMonthData
  boothName: (id: ID | null) => string
}) {
  const staffName = new Map(data.staff.map((s) => [s.id, s.name]))
  const rows = [...moves].sort((a, b) =>
    a.dayKey === b.dayKey ? b.createdAt - a.createdAt : a.dayKey < b.dayKey ? 1 : -1,
  )
  return (
    <section aria-labelledby="exp-drawer-title">
      <h2 className="section-title" id="exp-drawer-title">
        <span>จ่ายจากลิ้นชักตอนขาย</span>
        <Money value={total} />
      </h2>
      <p className="exp-note">
        <Info size={16} aria-hidden="true" />
        <span>คนขายจดตอนเอาเงินออกจากลิ้นชัก รวมในค่าใช้จ่ายแล้ว ถ้าจดผิด แตะรายการเพื่อเปิดรอบขายนั้น แล้วลบรายการ</span>
      </p>
      <ul className="list exp-list">
        {rows.map((m) => {
          const who = staffName.get(m.staffId)
          return (
            <li key={m.id}>
              <Link
                to={`/shift/history?shift=${encodeURIComponent(m.shiftId)}&day=${m.dayKey}`}
                className="list-row list-link exp-row exp-drawer-row"
              >
                <CategoryIcon category={m.category} />
                <span className="list-main">
                  <span className="list-title">{m.reason.trim() || categoryLabel(m.category)}</span>
                  <span className="list-sub">
                    {thaiDateShort(m.dayKey)} · {boothName(m.boothId)} · {categoryLabel(m.category)}
                    {who ? ` · ${who}` : ''}
                  </span>
                </span>
                <Money value={m.amount} className="exp-amount" />
                <ChevronRight size={18} className="exp-row-chevron" aria-hidden="true" />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

