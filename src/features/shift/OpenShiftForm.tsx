// "เปิดร้าน" card: shown when the device's booth has no open shift.
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { History, Store } from 'lucide-react'
import { alive, db } from '../../db'
import { todayKey } from '../../lib/dates'
import { thaiDate, thaiDateLong, timeHM } from '../../lib/format'
import type { Booth, ID, Staff } from '../../types'
import { Button, Card, Field, Money, MoneyInput, PageHeader, useToast } from '../../ui'
import { isShiftError, openShift } from './shiftData'
import { DiffBadge, useStaffNames } from './parts'

export function OpenShiftForm({
  booth,
  staff,
  onShowSummary,
}: {
  booth: Booth
  staff: Staff
  onShowSummary: (shiftId: ID) => void
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const staffName = useStaffNames()
  const [float, setFloat] = useState<number | null>(
    Number.isFinite(booth.openingFloat) && booth.openingFloat > 0 ? booth.openingFloat : 0,
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const today = todayKey()

  const lastClosed = useLiveQuery(async () => {
    const rows = alive(await db.shifts.where('boothId').equals(booth.id).toArray()).filter((s) => s.status === 'closed')
    rows.sort((a, b) => (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt))
    return rows[0] ?? null
  }, [booth.id])

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy) return
    if (float === null) {
      setError('ใส่จำนวนเงินทอน ถ้าไม่มีให้ใส่ 0')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await openShift({ boothId: booth.id, staffId: staff.id, openingFloat: float })
      toast('เปิดร้านแล้ว เริ่มขายได้', 'success')
      navigate('/pos', { replace: true })
    } catch (err) {
      if (isShiftError(err, 'already_open')) {
        toast('แผงนี้เปิดร้านอยู่แล้ว', 'info')
      } else {
        console.error('open shift failed', err)
        toast('เปิดร้านไม่สำเร็จ ลองอีกครั้ง', 'error')
      }
      setBusy(false)
    }
  }

  return (
    <div className="page shift-page shift-narrow">
      <PageHeader
        title="เปิดร้าน"
        sub={booth.name}
        actions={
          <Link to="/shift/history" className="btn btn-ghost">
            <History size={20} aria-hidden="true" />
            <span>ประวัติ</span>
          </Link>
        }
      />

      <Card>
        <form className="stack" onSubmit={(e) => void submit(e)}>
          <dl className="shift-open-meta">
            <div>
              <dt>วันที่</dt>
              <dd>{thaiDateLong(today)}</dd>
            </div>
            <div>
              <dt>คนเปิดร้าน</dt>
              <dd>{staff.name}</dd>
            </div>
          </dl>
          <Field label="เงินทอนตั้งต้นในลิ้นชัก" hint="เงินทอนที่ใส่ไว้ก่อนเริ่มขาย ถ้าไม่มีให้ใส่ 0" error={error}>
            <MoneyInput
              value={float}
              onChange={(n) => {
                setFloat(n)
                if (n !== null) setError(null)
              }}
            />
          </Field>
          <Button type="submit" variant="primary" size="xl" block icon={<Store size={24} />} loading={busy}>
            เปิดร้าน
          </Button>
        </form>
      </Card>

      {lastClosed && (
        <Card className="shift-last" title="ปิดยอดล่าสุด">
          <div className="row-between">
            <div className="stack-sm">
              <span>
                {thaiDate(lastClosed.dayKey)}
                {lastClosed.closedAt ? ` · ปิด ${timeHM(lastClosed.closedAt)}` : ''} · {staffName(lastClosed.closedBy)}
              </span>
              <span className="row">
                <span>
                  ยอดขาย <Money value={lastClosed.snapshot?.total ?? 0} />
                </span>
                <DiffBadge diff={lastClosed.cashDiff} />
              </span>
            </div>
            <Button onClick={() => onShowSummary(lastClosed.id)}>ดูสรุป</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
