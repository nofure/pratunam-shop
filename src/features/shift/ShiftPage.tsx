// /shift — เปิดร้าน / ร้านเปิดอยู่ / ปิดยอด for the booth this device sells for.
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCurrentBooth, useShop } from '../../hooks'
import { useSession } from '../../session'
import type { ID } from '../../types'
import { EmptyState } from '../../ui'
import { OpenShiftForm } from './OpenShiftForm'
import { OpenShiftView } from './OpenShiftView'
import { ShiftSummary } from './ShiftSummary'
import { Loading, ShiftErrorBoundary } from './parts'
import { findOpenShifts } from './shiftData'
import './shift.css'

export default function ShiftPage() {
  return (
    <ShiftErrorBoundary>
      <ShiftPageInner />
    </ShiftErrorBoundary>
  )
}

function ShiftPageInner() {
  const booth = useCurrentBooth()
  const shop = useShop()
  const { staff, isOwner } = useSession()
  const boothId = booth?.id ?? null
  const openShifts = useLiveQuery(async () => (boothId ? findOpenShifts(boothId) : []), [boothId])
  // Summary of a just-closed shift (remembered with its booth so switching booths hides it).
  const [summary, setSummary] = useState<{ boothId: ID; shiftId: ID } | null>(null)

  if (booth === undefined || staff === undefined || openShifts === undefined) return <Loading />
  if (booth === null) {
    return (
      <div className="page">
        <EmptyState title="เครื่องนี้ยังไม่ได้เลือกแผง" hint="กดชื่อแผงด้านบนเพื่อเลือกแผงของเครื่องนี้" />
      </div>
    )
  }
  if (!staff) return <Loading />

  if (summary && summary.boothId === booth.id) {
    return <ShiftSummary shiftId={summary.shiftId} booth={booth} shop={shop} onNew={() => setSummary(null)} />
  }

  const [current, ...others] = openShifts
  if (current) {
    return (
      <OpenShiftView
        key={current.id}
        shift={current}
        booth={booth}
        shop={shop}
        staff={staff}
        isOwner={isOwner}
        otherOpen={others}
        onClosed={(shiftId) => setSummary({ boothId: booth.id, shiftId })}
      />
    )
  }

  return (
    <OpenShiftForm
      key={booth.id}
      booth={booth}
      staff={staff}
      onShowSummary={(shiftId) => setSummary({ boothId: booth.id, shiftId })}
    />
  )
}
