import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronUp, ClipboardList, PackagePlus, Search, SlidersHorizontal } from 'lucide-react'
import { ADJUST_REASON_LABEL } from '../../constants'
import { useSession } from '../../session'
import type { TierStock } from '../../domain/stock'
import type { Adjustment, ID, Lot, Tier } from '../../types'
import { bahtSign, num, signed, thaiDate } from '../../lib/format'
import { Badge, Card, EmptyState, Modal, Money, Stat, cx } from '../../ui'
import { BoothBar, Callout, Loading, NoBooth, NoTiers, TierTag, TierTitle } from './common'
import { useBoothStock, useStockBooth, type BoothStock } from './data'
import { compareNewest, compareStockRows, compareTierName, matchesQuery, needsAttention, qtyText, stockStatus, type StockStatus } from './logic'

export default function OnHandPage() {
  const { boothId } = useStockBooth()
  const raw = useBoothStock(boothId)
  const data = raw && raw.boothId !== boothId ? undefined : raw

  if (!boothId) return <NoBooth />
  return (
    <div className="stack">
      <BoothBar />
      {data === undefined ? <Loading /> : data === null ? <NoBooth /> : data.tiers.length === 0 ? <NoTiers /> : <OnHandBody data={data} />}
    </div>
  )
}

interface Row {
  tier: Tier
  stock: TierStock
  status: StockStatus
}

function emptyStock(tierId: ID): TierStock {
  return { tierId, received: 0, sold: 0, adjusted: 0, onHand: 0, avgCost: null, stockValue: null, lastReceived: null, lastSold: null }
}

function StatusBadge({ status }: { status: StockStatus }) {
  switch (status) {
    case 'none':
      return <Badge>ยังไม่มียอด</Badge>
    case 'negative':
      return <Badge tone="danger">ติดลบ</Badge>
    case 'out':
      return <Badge tone="danger">หมด</Badge>
    case 'low':
      return <Badge tone="warning">ใกล้หมด</Badge>
    default:
      return null
  }
}

function OnHandBody({ data }: { data: BoothStock }) {
  const { isOwner } = useSession()
  const [q, setQ] = useState('')
  const [showUntracked, setShowUntracked] = useState(false)
  const [detailId, setDetailId] = useState<ID | null>(null)

  const { tracked, untracked } = useMemo(() => {
    const tracked: Row[] = []
    const untracked: Row[] = []
    for (const tier of data.tiers) {
      const stock = data.stock.get(tier.id) ?? emptyStock(tier.id)
      // Hidden buttons only matter while they still have stock.
      if (tier.active !== 1 && stock.onHand === 0) continue
      const row = { tier, stock, status: stockStatus(tier, stock) }
      if (tier.trackStock === 1) tracked.push(row)
      else untracked.push(row)
    }
    tracked.sort(compareStockRows)
    untracked.sort((a, b) => compareTierName(a.tier, b.tier))
    return { tracked, untracked }
  }, [data])

  const totals = useMemo(() => {
    let pieces = 0
    let value = 0
    let noCost = 0
    let attention = 0
    for (const r of tracked) {
      if (r.stock.onHand > 0) pieces += r.stock.onHand
      value += r.stock.stockValue ?? 0
      if (r.stock.onHand > 0 && r.stock.avgCost == null) noCost += 1
      if (needsAttention(r.status)) attention += 1
    }
    return { pieces, value, noCost, attention }
  }, [tracked])

  const shown = tracked.filter((r) => matchesQuery(r.tier, q))
  const shownUntracked = untracked.filter((r) => matchesQuery(r.tier, q))
  const hasStockData = data.lots.length > 0 || data.adjustments.length > 0
  const detail = detailId ? data.tiers.find((t) => t.id === detailId) : undefined

  return (
    <>
      {!hasStockData && (
        <Callout>
          <p className="stock-callout-title">ยังไม่มีการรับของเข้า — เริ่มจากรับของเข้า เพื่อให้รู้ของคงเหลือและทุน</p>
          <p className="muted">
            {isOwner
              ? 'ถ้ามีของอยู่ที่แผงแล้ว ใช้ “นับสต็อก” ใส่จำนวนที่มีตอนนี้ได้เลย'
              : 'ให้เจ้าของร้านรับของเข้า หรือช่วยนับของที่มีอยู่ตอนนี้'}
          </p>
          <div className="row stock-callout-actions">
            {isOwner && (
              <Link to="/stock/receive" className="btn btn-primary">
                <PackagePlus size={20} aria-hidden="true" />
                รับของเข้า
              </Link>
            )}
            <Link to="/stock/count" className="btn btn-secondary">
              <ClipboardList size={20} aria-hidden="true" />
              นับสต็อก
            </Link>
          </div>
        </Callout>
      )}

      <div className={cx('stock-stats', isOwner ? 'grid-3' : 'grid-2')}>
        <Stat label="ของคงเหลือ" value={<span className="num">{num(totals.pieces, 2)} ชิ้น</span>} sub={`${tracked.length} ปุ่มราคา`} />
        <Stat
          label="ใกล้หมด / หมด"
          value={<span className="num">{totals.attention}</span>}
          sub="ปุ่มราคา"
          tone={totals.attention > 0 ? 'warning' : 'default'}
        />
        {isOwner && (
          <Stat
            label="มูลค่าตามทุน"
            value={<Money value={totals.value} />}
            sub={totals.noCost > 0 ? `ยังไม่มีทุน ${totals.noCost} ปุ่ม` : 'คิดจากทุนเฉลี่ย'}
          />
        )}
      </div>

      {data.tiers.length > 6 && (
        <label className="stock-search">
          <Search size={20} aria-hidden="true" />
          <input
            className="input"
            type="search"
            inputMode="search"
            placeholder="ค้นหาชื่อหรือราคา"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="ค้นหาชื่อหรือราคา"
          />
        </label>
      )}

      {tracked.length === 0 ? (
        <EmptyState
          compact
          title="ไม่มีปุ่มที่นับสต็อก"
          hint="เปิด “นับสต็อก” ของปุ่มราคาได้ที่ ตั้งค่า → ปุ่มราคา"
          action={
            isOwner ? (
              <Link to="/settings/tiers" className="btn btn-secondary">
                ไปที่ปุ่มราคา
              </Link>
            ) : undefined
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState compact title={`ไม่พบ “${q.trim()}”`} hint="ลองพิมพ์ชื่อสั้นลง หรือพิมพ์ราคา" />
      ) : (
        <div className="list stock-list">
          {shown.map((r) => (
            <StockRow key={r.tier.id} row={r} isOwner={isOwner} onOpen={() => setDetailId(r.tier.id)} />
          ))}
        </div>
      )}

      {untracked.length > 0 && (
        <div className="stock-untracked">
          <button type="button" className="btn btn-ghost btn-block stock-toggle" aria-expanded={showUntracked} onClick={() => setShowUntracked((v) => !v)}>
            <span>ปุ่มที่ไม่นับสต็อก ({untracked.length})</span>
            {showUntracked ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>
          {showUntracked &&
            (shownUntracked.length === 0 ? (
              <p className="muted">ไม่พบ</p>
            ) : (
              <div className="list stock-list">
                {shownUntracked.map((r) => (
                  <button key={r.tier.id} type="button" className="list-row list-link" onClick={() => setDetailId(r.tier.id)}>
                    <TierTag tier={r.tier} size="sm" />
                    <span className="list-main">
                      <TierTitle tier={r.tier} />
                      <span className="list-sub num">
                        ขายไป {num(r.stock.sold, 2)} {r.tier.unit}
                        {r.stock.lastSold ? ` · ขายล่าสุด ${thaiDate(r.stock.lastSold)}` : ''}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}

      {detail && (
        <TierDetail
          tier={detail}
          stock={data.stock.get(detail.id) ?? emptyStock(detail.id)}
          lots={data.lots}
          adjustments={data.adjustments}
          isOwner={isOwner}
          onClose={() => setDetailId(null)}
        />
      )}
    </>
  )
}

function StockRow({ row, isOwner, onOpen }: { row: Row; isOwner: boolean; onOpen: () => void }) {
  const { tier: t, stock: s, status } = row
  const meta = [
    `รับ ${num(s.received, 2)}`,
    `ขาย ${num(s.sold, 2)}`,
    s.adjusted !== 0 ? `ปรับ ${signed(s.adjusted)}` : null,
    s.lastSold ? `ขายล่าสุด ${thaiDate(s.lastSold)}` : 'ยังไม่เคยขาย',
  ].filter(Boolean)
  return (
    <button type="button" className="list-row list-link stock-row" onClick={onOpen}>
      <TierTag tier={t} />
      <span className="list-main">
        <TierTitle tier={t} />
        <span className="list-sub num">{meta.join(' · ')}</span>
        {isOwner && s.avgCost != null && (
          <span className="list-sub num">
            ทุนเฉลี่ย {bahtSign(s.avgCost)} · มูลค่า {bahtSign(s.stockValue ?? 0)}
          </span>
        )}
      </span>
      <span className="stock-row-end stock-onhand-col">
        <span className="stock-onhand-line">
          <span className={cx('stock-onhand num', status === 'none' && 'muted', (status === 'negative' || status === 'out') && 'tone-danger', status === 'low' && 'tone-warning')}>
            {status === 'none' ? '–' : qtyText(s.onHand)}
          </span>
          <span className="stock-unit">{t.unit}</span>
        </span>
        <StatusBadge status={status} />
      </span>
    </button>
  )
}

interface Move {
  key: string
  dayKey: string
  createdAt: number
  label: string
  qty: number
  sub: string | null
}

function TierDetail({
  tier,
  stock,
  lots,
  adjustments,
  isOwner,
  onClose,
}: {
  tier: Tier
  stock: TierStock
  lots: Lot[]
  adjustments: Adjustment[]
  isOwner: boolean
  onClose: () => void
}) {
  const status = stockStatus(tier, stock)
  const moves = useMemo(() => {
    const out: Move[] = []
    for (const l of lots)
      if (l.tierId === tier.id)
        out.push({
          key: l.id,
          dayKey: l.dayKey,
          createdAt: l.createdAt,
          label: 'รับของเข้า',
          qty: l.qty,
          sub: isOwner ? `ทุน${tier.unit}ละ ${bahtSign(l.unitCost)}` : null,
        })
    for (const a of adjustments)
      if (a.tierId === tier.id)
        out.push({
          key: a.id,
          dayKey: a.dayKey,
          createdAt: a.createdAt,
          label: ADJUST_REASON_LABEL[a.reason] ?? 'ปรับสต็อก',
          qty: a.qtyChange,
          sub: a.reason === 'count' && a.countedQty != null ? `นับได้ ${num(a.countedQty, 2)}` : a.note,
        })
    return out.sort(compareNewest).slice(0, 8)
  }, [lots, adjustments, tier, isOwner])

  return (
    <Modal
      open
      onClose={onClose}
      className="stock-detail"
      title={`${tier.name} ${bahtSign(tier.price)}`}
      footer={
        // `replace`: an open sheet adds a history entry (back closes it); leaving from the sheet takes
        // that entry's place so back from the next page returns to this list.
        <>
          <Link to="/stock/count" replace className="btn btn-secondary">
            <ClipboardList size={20} aria-hidden="true" />
            นับ
          </Link>
          {isOwner && (
            <Link to={`/stock/adjust?tier=${encodeURIComponent(tier.id)}`} replace className="btn btn-secondary">
              <SlidersHorizontal size={20} aria-hidden="true" />
              ปรับ
            </Link>
          )}
          {isOwner && (
            <Link to={`/stock/receive?tier=${encodeURIComponent(tier.id)}`} replace className="btn btn-primary">
              <PackagePlus size={20} aria-hidden="true" />
              รับเข้า
            </Link>
          )}
        </>
      }
    >
      <div className="stack">
        <div className="stock-detail-head">
          <TierTag tier={tier} />
          <div>
            <div className="muted">คงเหลือ</div>
            <div className="stock-detail-onhand num">
              {status === 'none' ? '–' : qtyText(stock.onHand)} <span className="stock-unit">{tier.unit}</span>
            </div>
          </div>
          <StatusBadge status={status} />
        </div>
        {tier.trackStock !== 1 && <Callout>ปุ่มนี้ไม่ได้นับสต็อก เปิดได้ที่ ตั้งค่า → ปุ่มราคา</Callout>}
        {status === 'negative' && (
          <Callout tone="warning">ขายไปมากกว่าที่จดรับเข้า — อาจลืมรับของเข้า ลองนับของจริงแล้วบันทึกที่ “นับสต็อก”</Callout>
        )}
        <div className="grid-3">
          <Stat plain label="รับเข้า" value={<span className="num">{num(stock.received, 2)}</span>} />
          <Stat plain label="ปรับ / นับ" value={<span className="num">{signed(stock.adjusted)}</span>} />
          <Stat plain label="ขายไป" value={<span className="num">{num(stock.sold, 2)}</span>} />
        </div>
        <p className="muted stock-formula">คงเหลือ = รับเข้า + ปรับ/นับ − ขายไป</p>
        {isOwner && (
          <div className="grid-2">
            <Stat plain label="ทุนเฉลี่ย" value={stock.avgCost != null ? <Money value={stock.avgCost} /> : '–'} sub={`ต่อ${tier.unit}`} />
            <Stat plain label="มูลค่าตามทุน" value={stock.stockValue != null ? <Money value={stock.stockValue} /> : '–'} />
          </div>
        )}
        <dl className="stock-dl">
          <dt>รับเข้าล่าสุด</dt>
          <dd>{stock.lastReceived ? thaiDate(stock.lastReceived) : 'ยังไม่มี'}</dd>
          <dt>ขายล่าสุด</dt>
          <dd>{stock.lastSold ? thaiDate(stock.lastSold) : 'ยังไม่เคยขาย'}</dd>
          <dt>เตือนเมื่อเหลือ</dt>
          <dd>{tier.lowStock != null ? `${num(tier.lowStock)} ${tier.unit} หรือน้อยกว่า` : 'ไม่ได้ตั้ง'}</dd>
        </dl>
        {moves.length > 0 && (
          <Card title="รับเข้า / ปรับ ล่าสุด" flush>
            <div className="stock-moves">
              {moves.map((m) => (
                <div key={m.key} className="stock-move">
                  <div className="list-main">
                    <span>{m.label}</span>
                    <span className="list-sub">
                      {thaiDate(m.dayKey)}
                      {m.sub ? ` · ${m.sub}` : ''}
                    </span>
                  </div>
                  <span className={cx('num stock-move-qty', m.qty < 0 ? 'tone-danger' : 'tone-success')}>{signed(m.qty)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </Modal>
  )
}
