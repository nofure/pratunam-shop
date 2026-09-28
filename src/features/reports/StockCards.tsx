// Stock right now: price buttons running low and goods that have not sold for 30 days.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Badge, Card, EmptyState } from '../../ui'
import type { ID, Tier } from '../../types'
import type { SlowMover } from '../../domain/reports'
import type { TierStock } from '../../domain/stock'
import { bahtSign, num, round2 } from '../../lib/format'
import { CardLoading, PriceTag, ShowMore } from './parts'

const LIMIT = 8
export const SLOW_DAYS = 30

function StockLink() {
  return (
    <Link to="/stock" className="rep-link">
      ดูสต็อก
    </Link>
  )
}

function TierCell({ tier, boothName }: { tier: Tier; boothName: string | null }) {
  return (
    <div className="rep-tier">
      <PriceTag price={tier.price} color={tier.color} />
      <div className="rep-tier-text">
        <span className="rep-tier-name">{tier.name}</span>
        {boothName && <span className="rep-tier-sub">{boothName}</span>}
      </div>
    </div>
  )
}

export function LowStockCard({
  rows,
  boothName,
}: {
  /** null while stock is loading */
  rows: { tier: Tier; stock: TierStock }[] | null
  /** null when only one booth is shown */
  boothName: ((id: ID) => string) | null
}) {
  const [open, setOpen] = useState(false)
  const shown = rows ? (open ? rows : rows.slice(0, LIMIT)) : []
  return (
    <Card
      title={
        <>
          ของใกล้หมด {rows && rows.length > 0 && <Badge tone="warning">{rows.length}</Badge>}
        </>
      }
      actions={<StockLink />}
    >
      {rows === null ? (
        <CardLoading />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={null} title="ยังไม่มีของใกล้หมด" hint="ตั้งจุดเตือนของใกล้หมดได้ที่ปุ่มราคาแต่ละปุ่ม" />
      ) : (
        <>
          <ul className="rep-rows">
            {shown.map(({ tier, stock }) => (
              <li key={tier.id}>
                {/* Opens รับของเข้า with this price button (and its booth) already picked. */}
                <Link to={`/stock/receive?tier=${encodeURIComponent(tier.id)}`} className="rep-row rep-row-link">
                  <div className="rep-row-main">
                    <TierCell tier={tier} boothName={boothName ? boothName(tier.boothId) : null} />
                  </div>
                  <div className="rep-row-end">
                    <span className={`rep-row-amount num ${stock.onHand <= 0 ? 'tone-danger' : 'tone-warning'}`}>
                      {stock.onHand <= 0 ? 'หมด' : `เหลือ ${num(stock.onHand, 2)} ${tier.unit}`}
                    </span>
                    <span className="rep-row-sub">เตือนที่ {num(tier.lowStock ?? 0, 2)}</span>
                  </div>
                  <ChevronRight size={18} className="rep-row-chev" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <ShowMore total={rows.length} limit={LIMIT} open={open} onToggle={() => setOpen((o) => !o)} />
        </>
      )}
    </Card>
  )
}

export function SlowMoversCard({
  rows,
  boothName,
}: {
  rows: SlowMover[] | null
  boothName: ((id: ID) => string) | null
}) {
  const [open, setOpen] = useState(false)
  const shown = rows ? (open ? rows : rows.slice(0, LIMIT)) : []
  const tied = rows ? round2(rows.reduce((a, r) => a + (r.stock.stockValue ?? 0), 0)) : 0
  return (
    <Card title="ของค้างสต็อก" actions={<StockLink />}>
      {rows === null ? (
        <CardLoading />
      ) : rows.length === 0 ? (
        <EmptyState compact icon={null} title="ไม่มีของค้างสต็อก" hint={`ทุกปุ่มราคาที่นับสต็อกขายออกภายใน ${SLOW_DAYS} วัน`} />
      ) : (
        <>
          <p className="rep-small rep-small-top">
            ไม่ได้ขายเกิน {SLOW_DAYS} วัน {num(rows.length)} รายการ
            {tied > 0 ? ` · ทุนจมรวม ${bahtSign(tied)}` : ''}
          </p>
          <ul className="rep-rows">
            {shown.map(({ tier, stock, daysSinceLastSale }) => (
              <li key={tier.id}>
                <Link to="/stock" className="rep-row rep-row-link">
                  <div className="rep-row-main">
                    <TierCell tier={tier} boothName={boothName ? boothName(tier.boothId) : null} />
                  </div>
                  <div className="rep-row-end">
                    <span className="rep-row-amount num">
                      {num(stock.onHand, 2)} {tier.unit}
                    </span>
                    <span className="rep-row-sub">
                      {daysSinceLastSale == null ? 'ยังไม่เคยขาย' : `ไม่ได้ขาย ${num(daysSinceLastSale)} วัน`}
                      {stock.stockValue != null && stock.stockValue > 0 ? ` · ทุน ${bahtSign(stock.stockValue)}` : ''}
                    </span>
                  </div>
                  <ChevronRight size={18} className="rep-row-chev" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <ShowMore total={rows.length} limit={LIMIT} open={open} onToggle={() => setOpen((o) => !o)} />
        </>
      )}
    </Card>
  )
}

/** Shown instead of the two stock cards when no price button tracks stock. */
export function NoStockTrackingCard() {
  return (
    <Card title="สต็อก" actions={<StockLink />}>
      <EmptyState
        compact
        icon={null}
        title="ยังไม่ได้นับสต็อกปุ่มราคาไหน"
        hint="เปิด “นับสต็อก” ที่ปุ่มราคา แล้วจดของที่รับเข้า รายงานจะบอกของใกล้หมดและของค้างสต็อก"
      />
    </Card>
  )
}
