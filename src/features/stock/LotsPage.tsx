import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeft, ChevronRight, Download, PackagePlus } from 'lucide-react'
import { alive, db } from '../../db'
import { useStaffList } from '../../hooks'
import type { ID, Lot } from '../../types'
import { todayKey } from '../../lib/dates'
import { baht, bahtSign, num, thaiDate, thaiDateShort, thaiMonth } from '../../lib/format'
import { downloadText, toCsv } from '../../lib/share'
import { Button, EmptyState, IconButton, Money, Stat, cx, useToast } from '../../ui'
import { Loading, LotRow, useDeleteLot } from './common'
import { boothNameOf, useStockBooth, useSupplierRows, useTierLookup } from './data'
import { compareNewest, lotTotals, monthOf, shiftMonth } from './logic'

type MonthFilter = string | 'all'

export default function LotsPage() {
  const { booths, allBooths } = useStockBooth()
  const lots = useLiveQuery(async () => alive(await db.lots.toArray()), [])
  const tierLookup = useTierLookup()
  const supplierRows = useSupplierRows()
  const staffList = useStaffList(true)
  const deleteLot = useDeleteLot()
  const toast = useToast()

  const thisMonth = monthOf(todayKey())
  const [boothId, setBoothId] = useState<ID | 'all'>('all')
  const [month, setMonth] = useState<MonthFilter>(thisMonth)
  const [supplierId, setSupplierId] = useState<ID | ''>('')

  const supplierById = useMemo(() => new Map((supplierRows ?? []).map((s) => [s.id, s])), [supplierRows])
  const staffById = useMemo(() => new Map((staffList ?? []).map((s) => [s.id, s.name])), [staffList])

  const filtered = useMemo(() => {
    if (!lots) return []
    return lots
      .filter(
        (l) =>
          (boothId === 'all' || l.boothId === boothId) &&
          (month === 'all' || monthOf(l.dayKey) === month) &&
          (!supplierId || l.supplierId === supplierId),
      )
      .sort(compareNewest)
  }, [lots, boothId, month, supplierId])

  const groups = useMemo(() => {
    const out: { dayKey: string; lots: Lot[]; cost: number }[] = []
    for (const l of filtered) {
      const g = out[out.length - 1]
      if (g && g.dayKey === l.dayKey) {
        g.lots.push(l)
        g.cost += l.totalCost
      } else out.push({ dayKey: l.dayKey, lots: [l], cost: l.totalCost })
    }
    return out
  }, [filtered])

  if (lots === undefined || tierLookup === undefined) return <Loading />
  if (lots.length === 0)
    return (
      <EmptyState
        icon={<PackagePlus size={28} />}
        title="ยังไม่มีการรับของเข้า"
        hint="เริ่มจากรับของเข้า เพื่อให้รู้ของคงเหลือและทุน"
        action={
          <Link to="/stock/receive" className="btn btn-primary">
            รับของเข้า
          </Link>
        }
      />
    )

  const totals = lotTotals(filtered)
  const usedSuppliers = [...new Set(lots.map((l) => l.supplierId).filter((id): id is ID => !!id))]
    .map((id) => supplierById.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .sort((a, b) => a.name.localeCompare(b.name, 'th'))

  const exportCsv = () => {
    const header = ['วันที่', 'แผง', 'ปุ่มราคา', 'ราคาขาย', 'จำนวน', 'หน่วย', 'ทุนต่อหน่วย', 'ทุนรวม', 'ร้านที่ซื้อ', 'หมายเหตุ', 'ผู้บันทึก']
    const body = [...filtered].reverse().map((l) => {
      const t = tierLookup.get(l.tierId)
      return [
        l.dayKey,
        boothNameOf(allBooths, l.boothId),
        t?.name ?? '',
        t?.price ?? '',
        l.qty,
        t?.unit ?? '',
        l.unitCost,
        l.totalCost,
        l.supplierId ? (supplierById.get(l.supplierId)?.name ?? '') : '',
        l.note ?? '',
        l.staffId ? (staffById.get(l.staffId) ?? '') : '',
      ]
    })
    const suffix = month === 'all' ? 'ทั้งหมด' : month
    downloadText(`รับของเข้า-${suffix}.csv`, toCsv([header, ...body]))
    toast('ส่งออกไฟล์แล้ว', 'success')
  }

  return (
    <div className="stack">
      {booths.length > 1 && (
        <div className="stock-chips" role="group" aria-label="เลือกแผง">
          <button type="button" className={cx('chip', boothId === 'all' && 'active')} aria-pressed={boothId === 'all'} onClick={() => setBoothId('all')}>
            ทุกแผง
          </button>
          {booths.map((b) => (
            <button key={b.id} type="button" className={cx('chip', b.id === boothId && 'active')} aria-pressed={b.id === boothId} onClick={() => setBoothId(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
      )}

      <div className="stock-month">
        <IconButton
          label="เดือนก่อน"
          icon={<ChevronLeft size={24} />}
          variant="secondary"
          onClick={() => setMonth((m) => shiftMonth(m === 'all' ? thisMonth : m, -1))}
        />
        <span className="stock-month-label">{month === 'all' ? 'ตั้งแต่เริ่มใช้' : thaiMonth(`${month}-01`)}</span>
        <IconButton
          label="เดือนถัดไป"
          icon={<ChevronRight size={24} />}
          variant="secondary"
          disabled={month === 'all' || month >= thisMonth}
          onClick={() => setMonth((m) => (m === 'all' ? m : shiftMonth(m, 1)))}
        />
        <button type="button" className={cx('chip', month === 'all' && 'active')} aria-pressed={month === 'all'} onClick={() => setMonth(month === 'all' ? thisMonth : 'all')}>
          ทุกเดือน
        </button>
      </div>

      {usedSuppliers.length > 0 && (
        <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="ร้านที่ซื้อ">
          <option value="">ทุกร้านที่ซื้อ</option>
          {usedSuppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.deleted === 1 ? ' (ลบแล้ว)' : ''}
            </option>
          ))}
        </select>
      )}

      <div className="grid-3 stock-stats">
        <Stat label="ทุนรวม" value={<Money value={totals.cost} />} />
        <Stat label="รับเข้า" value={<span className="num">{num(totals.qty, 2)}</span>} sub="ชิ้น" />
        <Stat label="รายการ" value={<span className="num">{totals.count}</span>} sub="ครั้ง" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          compact
          title={month === 'all' ? 'ไม่มีรายการตามที่เลือก' : `${thaiMonth(`${month}-01`)} ยังไม่มีการรับของเข้า`}
          hint="ลองเลือกเดือนหรือแผงอื่น"
        />
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.dayKey} className="stock-day">
              <h3 className="section-title">
                <span>{thaiDateShort(g.dayKey)}</span>
                <span className="num">{bahtSign(g.cost)}</span>
              </h3>
              <div className="list">
                {g.lots.map((l) => {
                  const t = tierLookup.get(l.tierId)
                  return (
                    <LotRow
                      key={l.id}
                      lot={l}
                      tier={t}
                      boothName={booths.length > 1 || boothId === 'all' ? boothNameOf(allBooths, l.boothId) : null}
                      supplierName={l.supplierId ? (supplierById.get(l.supplierId)?.name ?? null) : null}
                      staffName={l.staffId ? (staffById.get(l.staffId) ?? null) : null}
                      onDelete={() => void deleteLot(l, t)}
                    />
                  )
                })}
              </div>
            </section>
          ))}
          <div className="row">
            <Button icon={<Download size={20} />} onClick={exportCsv}>
              ส่งออก CSV ({thaiDate(filtered[filtered.length - 1].dayKey)} – {thaiDate(filtered[0].dayKey)})
            </Button>
            <span className="muted num">รวม {baht(totals.cost)} บาท</span>
          </div>
        </>
      )}
    </div>
  )
}
