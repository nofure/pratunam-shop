// Best-selling price buttons with a sort toggle.
import { useMemo, useState } from 'react'
import { Card, Money, Segmented } from '../../ui'
import type { ID, Tier } from '../../types'
import type { Report } from '../../domain/reports'
import { num } from '../../lib/format'
import { sortTierRows, type TierSort } from './logic'
import { PriceTag, ShowMore } from './parts'

const LIMIT = 10

const SORT_OPTIONS: { value: TierSort; label: string }[] = [
  { value: 'sales', label: 'ยอดขาย' },
  { value: 'qty', label: 'จำนวน' },
  { value: 'profit', label: 'กำไร' },
]

export function TierTableCard({ report, tierById }: { report: Report; tierById: Map<ID, Tier> }) {
  const [sort, setSort] = useState<TierSort>('sales')
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => sortTierRows(report.byTier, sort), [report.byTier, sort])
  const showBooth = report.boothId == null && new Set(report.byTier.map((r) => r.boothId)).size > 1
  const shown = open ? rows : rows.slice(0, LIMIT)

  return (
    <Card title="ปุ่มราคาขายดี" className="rep-wide" flush>
      {rows.length === 0 ? (
        <p className="rep-flush-empty muted">ยังไม่มียอดขาย</p>
      ) : (
        <>
          <div className="rep-flush-pad">
            <Segmented options={SORT_OPTIONS} value={sort} onChange={setSort} aria-label="เรียงตาม" />
          </div>
          <div className="table-wrap">
            <table className="table rep-table">
              <thead>
                <tr>
                  <th scope="col">ปุ่มราคา</th>
                  <th scope="col" className="num rep-col-qty">
                    จำนวน
                  </th>
                  <th scope="col" className="num">
                    ยอดขาย
                  </th>
                  <th scope="col" className="num">
                    กำไร
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const tier = r.tierId ? tierById.get(r.tierId) : undefined
                  // hand-typed prices (no price button) are marked so they are not mistaken for a button
                  const custom = r.tierId == null && !r.name.includes('ราคาอื่น')
                  const sub = [showBooth ? r.boothName : null, custom ? 'ราคาอื่น' : null].filter(Boolean).join(' · ')
                  return (
                    <tr key={r.key}>
                      <td>
                        <div className="rep-tier">
                          <PriceTag price={r.price} color={tier?.color} />
                          <div className="rep-tier-text">
                            <span className="rep-tier-name">{r.name}</span>
                            {sub && <span className="rep-tier-sub">{sub}</span>}
                            <span className="rep-tier-qty">
                              {num(r.qty, 2)} {r.unit}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="num rep-col-qty">
                        {num(r.qty, 2)} <span className="rep-unit">{r.unit}</span>
                      </td>
                      <td className="num">
                        <Money value={r.sales} />
                      </td>
                      <td className="num">
                        {r.profit == null ? (
                          <span className="tone-muted" title="ยังไม่รู้ทุน">
                            –
                          </span>
                        ) : (
                          <Money value={r.profit} tone={r.profit < 0 ? 'danger' : 'default'} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="rep-flush-foot">
            <ShowMore total={rows.length} limit={LIMIT} open={open} onToggle={() => setOpen((o) => !o)} />
            {rows.some((r) => r.profit == null) && <p className="rep-small">– = ยังไม่รู้ทุน (ยังไม่ได้ใส่ทุนตอนรับของเข้า)</p>}
          </div>
        </>
      )}
    </Card>
  )
}
