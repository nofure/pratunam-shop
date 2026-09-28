// Cash count by banknote / coin: −/+ buttons and a typed count per denomination.
import { Minus, Plus } from 'lucide-react'
import { DENOMINATIONS } from '../../constants'
import { baht, bahtSign } from '../../lib/format'
import { IconButton } from '../../ui'
import { denominationKind } from './shiftData'

const MAX_COUNT = 9999

export function DenominationCounter({
  counts,
  onChange,
}: {
  counts: Record<string, number>
  onChange: (next: Record<string, number>) => void
}) {
  const set = (value: number, n: number) => {
    const c = Math.max(0, Math.min(MAX_COUNT, Math.floor(Number.isFinite(n) ? n : 0)))
    const next = { ...counts }
    if (c > 0) next[String(value)] = c
    else delete next[String(value)]
    onChange(next)
  }

  return (
    <ul className="shift-denoms">
      {DENOMINATIONS.map((v) => {
        const c = counts[String(v)] ?? 0
        const kind = denominationKind(v)
        return (
          <li key={v} className={c > 0 ? 'shift-denom has-count' : 'shift-denom'}>
            <div className="shift-denom-label">
              <span className="shift-denom-value num">{baht(v)}</span>
              <span className="shift-denom-kind">{kind}</span>
            </div>
            <div className="shift-denom-sub num">{c > 0 ? `= ${bahtSign(v * c)}` : ''}</div>
            <div className="shift-denom-ctrl">
              <IconButton
                label={`ลด${kind} ${baht(v)}`}
                icon={<Minus size={22} />}
                variant="secondary"
                disabled={c === 0}
                onClick={() => set(v, c - 1)}
              />
              <input
                className="input shift-denom-input num"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                aria-label={`จำนวน${kind} ${baht(v)}`}
                placeholder="0"
                value={c === 0 ? '' : String(c)}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                  set(v, digits ? Number(digits) : 0)
                }}
              />
              <IconButton
                label={`เพิ่ม${kind} ${baht(v)}`}
                icon={<Plus size={22} />}
                variant="secondary"
                disabled={c >= MAX_COUNT}
                onClick={() => set(v, c + 1)}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
