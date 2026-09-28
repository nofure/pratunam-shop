import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { bahtSign } from '../lib/format'
import { cx } from './cx'
import { compactNumber, niceScale } from './logic'

// ---------- helpers ----------

let measureCtx: CanvasRenderingContext2D | null | undefined
let measureFamily = ''

/** Pixel width of a string at `px` size in the app font (falls back to an estimate). */
function textWidth(s: string, px = 11): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d')
      measureFamily = getComputedStyle(document.body).fontFamily || 'sans-serif'
    } catch {
      measureCtx = null
    }
  }
  if (measureCtx) {
    measureCtx.font = `${px}px ${measureFamily}`
    return measureCtx.measureText(s).width
  }
  // Thai vowel/tone marks above/below the line take no width.
  return s.replace(/[ัิ-ฺ็-๎]/g, '').length * px * 0.6
}

function useWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setW(Math.round(el.getBoundingClientRect().width))
    read()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w > 0 ? w : fallback
}

/** Bar with rounded ends on the value side (top for positive, bottom for negative). */
function barPath(x: number, yTop: number, w: number, h: number, up: boolean): string {
  const r = Math.min(4, w / 2, h)
  const yb = yTop + h
  if (up)
    return `M${x},${yb}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yb}Z`
  return `M${x},${yTop}V${yb - r}Q${x},${yb} ${x + r},${yb}H${x + w - r}Q${x + w},${yb} ${x + w},${yb - r}V${yTop}Z`
}

// ---------- BarChart ----------

export interface BarDatum {
  label: string
  value: number
  /** Drawn in price-card yellow (e.g. today, best day). */
  highlight?: boolean
}

export interface BarChartProps {
  data: BarDatum[]
  /** Chart height in px (default 200). */
  height?: number
  /** Value text for labels and the tap tooltip (default ฿1,234). */
  format?: (v: number) => string
  emptyText?: string
  ariaLabel?: string
  className?: string
}

/** Responsive SVG bar chart. Tap a bar to see its value. */
export function BarChart({ data, height = 200, format = bahtSign, emptyText = 'ยังไม่มีข้อมูล', ariaLabel, className }: BarChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const width = useWidth(wrapRef, 320)
  const [sel, setSel] = useState<number | null>(null)
  const n = data.length
  // Drop the tapped bar when the data set changes (e.g. another date range).
  const dataKey = `${n}|${data[0]?.label ?? ''}|${data[n - 1]?.label ?? ''}`
  const [prevKey, setPrevKey] = useState(dataKey)
  if (dataKey !== prevKey) {
    setPrevKey(dataKey)
    setSel(null)
  }
  const selected = sel !== null && sel < n ? sel : null

  let body: ReactNode = null
  if (n === 0) {
    body = <div className="chart-empty">{emptyText}</div>
  } else {
    const values = data.map((d) => (Number.isFinite(d.value) ? d.value : 0))
    const maxV = Math.max(0, ...values)
    const minV = Math.min(0, ...values)
    const integers = values.every((v) => Number.isInteger(v))
    const { lo, hi, ticks } = niceScale(minV, maxV, integers)
    const tickText = ticks.map(compactNumber)

    const padL = Math.ceil(Math.max(...tickText.map((t) => textWidth(t)))) + 8
    const padR = 4
    const padT = 20
    const padB = 24
    const plotW = Math.max(10, width - padL - padR)
    const plotH = Math.max(10, height - padT - padB)
    const slot = plotW / n
    const barW = Math.max(1, Math.min(slot * 0.72, 56))
    const y = (v: number) => padT + ((hi - v) / (hi - lo)) * plotH
    const y0 = y(0)

    const valueText = values.map((v) => format(v))
    const showValues = n <= 40 && valueText.every((t, i) => values[i] === 0 || textWidth(t) <= slot - 2)
    const labelW = Math.max(...data.map((d) => textWidth(d.label))) + 8
    const every = Math.max(1, Math.ceil(labelW / slot))

    const bars = values.map((v, i) => {
      const x = padL + i * slot + (slot - barW) / 2
      const up = v >= 0
      const raw = Math.abs(y(v) - y0)
      const h = v === 0 ? 0 : Math.max(2, raw)
      const top = up ? y0 - h : y0
      return { x, up, h, top, cx: padL + i * slot + slot / 2 }
    })

    let tip: ReactNode = null
    if (selected !== null) {
      const b = bars[selected]
      const text = `${data[selected].label} · ${valueText[selected]}`
      const half = textWidth(text, 13) / 2 + 12
      const left = Math.min(Math.max(b.cx, half), width - half)
      const top = Math.max(0, (b.up ? b.top : y0) - 6)
      tip = (
        <div className="chart-tip" style={{ left, top }} aria-hidden="true">
          <span>{data[selected].label}</span>
          <strong>{valueText[selected]}</strong>
        </div>
      )
    }

    const maxIdx = values.indexOf(maxV)
    const label =
      ariaLabel ?? `กราฟแท่ง ${n} รายการ` + (maxIdx >= 0 && maxV > 0 ? ` สูงสุด ${data[maxIdx].label} ${valueText[maxIdx]}` : '')

    body = (
      <>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={label}>
          {ticks.map((t, i) => (
            <g key={`t${i}`}>
              <line className={t === 0 ? 'chart-base' : 'chart-grid'} x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} />
              <text className="chart-axis" x={padL - 6} y={y(t)} dy="0.35em" textAnchor="end">
                {tickText[i]}
              </text>
            </g>
          ))}
          {!ticks.includes(0) && <line className="chart-base" x1={padL} x2={width - padR} y1={y0} y2={y0} />}
          {bars.map((b, i) =>
            b.h > 0 ? (
              <path
                key={`b${i}`}
                className={cx('chart-bar', data[i].highlight && 'hl', !b.up && 'neg', selected === i && 'sel')}
                d={barPath(b.x, b.top, barW, b.h, b.up)}
              />
            ) : null,
          )}
          {showValues &&
            bars.map((b, i) =>
              values[i] !== 0 && (b.up || b.top + b.h + 14 < padT + plotH) ? (
                <text
                  key={`v${i}`}
                  className="chart-val"
                  x={b.cx}
                  y={b.up ? b.top - 5 : b.top + b.h + 12}
                  textAnchor="middle"
                >
                  {valueText[i]}
                </text>
              ) : null,
            )}
          {data.map((d, i) => {
            if (i % every !== 0) return null
            const half = textWidth(d.label) / 2
            const x = Math.min(Math.max(bars[i].cx, half), width - half)
            return (
              <text key={`x${i}`} className="chart-xlabel" x={x} y={height - 6} textAnchor="middle">
                {d.label}
              </text>
            )
          })}
          {bars.map((_, i) => (
            <rect
              key={`h${i}`}
              className="chart-hit"
              x={padL + i * slot}
              y={0}
              width={slot}
              height={height}
              onClick={() => setSel((s) => (s === i ? null : i))}
            >
              <title>{`${data[i].label}: ${valueText[i]}`}</title>
            </rect>
          ))}
        </svg>
        {tip}
      </>
    )
  }

  return (
    <div ref={wrapRef} className={cx('chart', selected !== null && 'has-sel', className)}>
      {body}
    </div>
  )
}

// ---------- HBarList ----------

export interface HBarRow {
  label: ReactNode
  value: number
  sub?: ReactNode
}

export interface HBarListProps {
  rows: HBarRow[]
  /** Value text (default ฿1,234). */
  format?: (v: number) => string
  emptyText?: string
  className?: string
}

/** Ranked list: label + value with a thin bar proportional to the largest value. */
export function HBarList({ rows, format = bahtSign, emptyText = 'ยังไม่มีข้อมูล', className }: HBarListProps) {
  if (rows.length === 0) return <div className={cx('chart-empty', className)}>{emptyText}</div>
  const max = Math.max(0, ...rows.map((r) => (Number.isFinite(r.value) ? Math.abs(r.value) : 0)))
  return (
    <ul className={cx('hbar', className)}>
      {rows.map((r, i) => {
        const v = Number.isFinite(r.value) ? r.value : 0
        const pct = max > 0 ? (Math.abs(v) / max) * 100 : 0
        return (
          <li key={i} className="hbar-row">
            <div className="hbar-top">
              <span className="hbar-label">{r.label}</span>
              <span className="hbar-value">{format(v)}</span>
            </div>
            {r.sub !== undefined && r.sub !== null && r.sub !== '' && <div className="hbar-sub">{r.sub}</div>}
            <div className="hbar-track" aria-hidden="true">
              <div className={cx('hbar-fill', v < 0 && 'neg')} style={{ width: `${pct > 0 ? Math.max(pct, 1.5) : 0}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
