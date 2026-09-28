// ปิดยอด: guided steps — count cash → compare → check transfer / คนละครึ่ง → confirm.
import { useEffect, useRef, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { PAY_METHOD_LABEL } from '../../constants'
import { getDevice } from '../../device'
import { cashDiffTone, denominationTotal } from '../../domain/shift'
import { baht, num, round2 } from '../../lib/format'
import { sendLineViaBackend, syncNow } from '../../sync'
import type { Booth, CashMove, ID, Sale, Shift, ShiftTotals, ShopConfig, Staff } from '../../types'
import { Badge, Button, Field, Modal, Money, NumPad, Segmented, cx, parseMoney, useConfirm, useToast } from '../../ui'
import { DenominationCounter } from './DenominationCounter'
import { CashBreakdown, CheckCard, DiffBadge } from './parts'
import {
  buildShiftText,
  clearCloseDraft,
  closeShift,
  isShiftError,
  loadCloseDraft,
  saveCloseDraft,
  type CloseDraft,
} from './shiftData'

type StepKey = 'count' | 'compare' | 'check' | 'confirm'

const STEP_LABEL: Record<StepKey, string> = {
  count: 'นับเงินสด',
  compare: 'เทียบยอด',
  check: 'เช็กเงินโอน',
  confirm: 'ยืนยัน',
}

export interface CloseShiftModalProps {
  open: boolean
  onClose: () => void
  shift: Shift
  /** live totals of the open shift */
  totals: ShiftTotals
  booth: Booth
  shop: ShopConfig | null | undefined
  /** the person closing */
  staff: Staff
  staffName: (id: ID | null | undefined) => string
  onClosed: (shiftId: ID) => void
}

export function CloseShiftModal(props: CloseShiftModalProps) {
  if (!props.open) return null
  return <CloseSheet {...props} />
}

function CloseSheet({ onClose, shift, totals, booth, shop, staff, staffName, onClosed }: CloseShiftModalProps) {
  const toast = useToast()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<CloseDraft>(() => loadCloseDraft(shift.id))
  const [step, setStep] = useState<StepKey>('count')
  const [busy, setBusy] = useState(false)
  const done = useRef(false)
  const topRef = useRef<HTMLDivElement>(null)

  // Keep the count if the sheet is closed or the page reloads before confirming.
  useEffect(() => {
    if (!done.current) saveCloseDraft(shift.id, draft)
  }, [shift.id, draft])

  useEffect(() => {
    topRef.current?.closest('.modal-body')?.scrollTo({ top: 0 })
  }, [step])

  const update = (p: Partial<CloseDraft>) => setDraft((d) => ({ ...d, ...p }))

  const hasTransfer = round2(totals.byMethod.transfer) > 0
  const hasHalf = round2(totals.byMethod.halfhalf) > 0
  const steps: StepKey[] = hasTransfer || hasHalf ? ['count', 'compare', 'check', 'confirm'] : ['count', 'compare', 'confirm']
  const cur: StepKey = steps.includes(step) ? step : 'confirm'
  const idx = steps.indexOf(cur)

  const counted = draft.mode === 'count' ? denominationTotal(draft.counts) : parseMoney(draft.totalText)
  const expected = totals.expectedCash
  const diff = counted === null ? null : round2(counted - expected)
  const tone = diff === null ? 'ok' : cashDiffTone(diff)

  const canNext = counted !== null
  const goNext = () => {
    if (!canNext) return
    if (idx < steps.length - 1) setStep(steps[idx + 1])
  }
  const goBack = () => {
    if (idx === 0) onClose()
    else setStep(steps[idx - 1])
  }

  const resetCounts = async () => {
    const ok = await confirm({
      title: 'ล้างที่นับไว้',
      message: 'จำนวนแบงก์และเหรียญที่ใส่ไว้จะหายทั้งหมด',
      confirmText: 'ล้าง',
      danger: true,
    })
    if (ok) update({ counts: {} })
  }

  const submit = async () => {
    if (busy) return
    if (counted === null) {
      setStep('count')
      return
    }
    setBusy(true)
    try {
      const res = await closeShift({
        shiftId: shift.id,
        staffId: staff.id,
        countedCash: counted,
        denominations: draft.mode === 'count' ? draft.counts : null,
        seen: { expectedCash: expected, transfer: totals.byMethod.transfer, halfhalf: totals.byMethod.halfhalf },
        transferChecked: draft.transferChecked,
        halfhalfChecked: draft.halfhalfChecked,
        note: draft.note,
      })
      done.current = true
      clearCloseDraft(shift.id)
      toast('ปิดยอดแล้ว', 'success')
      afterClose(res.shift, res.sales, res.moves)
      onClosed(res.shift.id)
    } catch (err) {
      setBusy(false)
      if (isShiftError(err, 'changed')) {
        toast('มีบิลหรือเงินเข้า-ออกใหม่ ตรวจยอดอีกครั้ง', 'info')
        setStep('compare')
      } else if (isShiftError(err, 'not_open')) {
        done.current = true
        clearCloseDraft(shift.id)
        toast('รอบนี้ปิดยอดไปแล้ว', 'info')
        onClose()
      } else {
        console.error('close shift failed', err)
        toast('ปิดยอดไม่สำเร็จ ลองอีกครั้ง', 'error')
      }
    }
  }

  // Background work after closing: never blocks the UI, reports the LINE result as a toast.
  const afterClose = (closed: Shift, sales: Sale[], moves: CashMove[]) => {
    void syncNow()
    const dev = getDevice()
    if (!dev.lineNotify || !dev.syncUrl) return
    const text = buildShiftText({ shop, boothName: booth.name, staffName, shift: closed, sales, moves })
    sendLineViaBackend(text).then(
      // queued = no connection now; it is sent by itself later, so it is not an error.
      (r) => toast(r.message, r.ok ? 'success' : r.queued ? 'info' : 'error'),
      (e) => {
        console.error('LINE send failed', e)
        toast('ส่ง LINE ไม่สำเร็จ ใช้ปุ่มส่งเข้า LINE แทน', 'error')
      },
    )
  }

  const note = (
    <Field label="หมายเหตุ (ถ้ามี)">
      <textarea
        className="textarea"
        value={draft.note}
        maxLength={300}
        placeholder={tone === 'ok' ? 'เช่น ฝนตก ปิดร้านเร็ว' : 'เช่น ทอนเงินผิด ลืมจดค่าข้าว'}
        onChange={(e) => update({ note: e.target.value })}
      />
    </Field>
  )

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      size="lg"
      title={`ปิดยอด · ${booth.name}`}
      footer={
        <div className="shift-foot">
          <div className="shift-foot-info">
            {cur === 'count' ? (
              <>
                <span>นับได้</span>
                <Money value={counted ?? 0} size="lg" />
              </>
            ) : diff !== null ? (
              <>
                <span>เงินสด</span>
                <DiffBadge diff={diff} />
              </>
            ) : null}
          </div>
          <div className="shift-foot-btns">
            <Button size="lg" onClick={goBack} disabled={busy}>
              {idx === 0 ? 'กลับ' : 'ย้อนกลับ'}
            </Button>
            {cur === 'confirm' ? (
              <Button variant="primary" size="lg" icon={<Check size={22} />} loading={busy} onClick={() => void submit()}>
                ปิดยอด
              </Button>
            ) : (
              <Button variant="primary" size="lg" disabled={!canNext} onClick={goNext}>
                ถัดไป
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div ref={topRef} className="stack">
        <ol className="shift-steps" aria-label="ขั้นตอนปิดยอด">
          {steps.map((s, i) => (
            <li
              key={s}
              className={cx('shift-step', i < idx && 'is-done', i === idx && 'is-current')}
              aria-current={i === idx ? 'step' : undefined}
            >
              <span className="shift-step-num">{i < idx ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
              <span className="shift-step-label">{STEP_LABEL[s]}</span>
            </li>
          ))}
        </ol>

        {cur === 'count' && (
          <div className="stack">
            <Segmented
              block
              aria-label="วิธีนับเงิน"
              value={draft.mode}
              onChange={(m) => update({ mode: m })}
              options={[
                { value: 'count', label: 'นับทีละแบงก์' },
                { value: 'total', label: 'ใส่ยอดรวมเลย' },
              ]}
            />
            {draft.mode === 'count' ? (
              <>
                <p className="shift-hint">นับเงินทั้งหมดในลิ้นชัก รวมเงินทอนตั้งต้น แล้วใส่จำนวนของแต่ละแบงก์และเหรียญ</p>
                <DenominationCounter counts={draft.counts} onChange={(c) => update({ counts: c })} />
                {Object.keys(draft.counts).length > 0 && (
                  <Button variant="ghost" icon={<RotateCcw size={20} />} onClick={() => void resetCounts()}>
                    ล้างที่นับ
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="shift-hint">ใส่ยอดเงินสดทั้งหมดที่นับได้ในลิ้นชัก รวมเงินทอนตั้งต้น</p>
                <div className="shift-total-display" aria-live="polite">
                  <Money value={parseMoney(draft.totalText) ?? 0} size="xl" />
                </div>
                <NumPad className="shift-numpad" value={draft.totalText} onChange={(s) => update({ totalText: s })} onEnter={goNext} />
              </>
            )}
          </div>
        )}

        {cur === 'compare' && counted !== null && diff !== null && (
          <div className="stack">
            <div className={cx('shift-diff', `is-${tone}`)} role="status">
              <span className="shift-diff-label">
                {tone === 'ok' ? 'เงินสดตรงกับยอด' : tone === 'short' ? 'เงินสดขาด' : 'เงินสดเกิน'}
              </span>
              <span className="shift-diff-value num">
                {tone === 'ok' ? 'ตรง' : `${tone === 'short' ? 'ขาด' : 'เกิน'} ${baht(Math.abs(diff))}`}
              </span>
            </div>
            <div className="grid-2">
              <div className="shift-box">
                <span className="shift-label">ควรมีในลิ้นชัก</span>
                <Money value={expected} size="lg" />
              </div>
              <div className="shift-box">
                <span className="shift-label">นับได้</span>
                <Money value={counted} size="lg" />
              </div>
            </div>
            <div className="shift-box">
              <span className="shift-label">ที่มาของยอดควรมี</span>
              <CashBreakdown openingFloat={shift.openingFloat} totals={totals} />
            </div>
            {tone !== 'ok' && (
              <>
                <p className="shift-hint">ลองนับอีกรอบ หรือดูว่าลืมจดเงินเข้า-ออกไหม กดย้อนกลับเพื่อนับใหม่</p>
                {note}
              </>
            )}
          </div>
        )}

        {cur === 'check' && (
          <div className="stack">
            <p className="shift-hint">เปิดแอปดูยอดเงินที่เข้าในรอบนี้ แล้วติ๊กถ้าตรงกัน</p>
            {hasTransfer && (
              <div className="shift-box stack-sm">
                <div className="row-between">
                  <span className="shift-label">{PAY_METHOD_LABEL.transfer}</span>
                  <Money value={totals.byMethod.transfer} size="lg" />
                </div>
                <CheckCard
                  checked={draft.transferChecked}
                  onChange={(v) => update({ transferChecked: v })}
                  label="ตรงกับแอปธนาคารแล้ว"
                />
              </div>
            )}
            {hasHalf && (
              <div className="shift-box stack-sm">
                <div className="row-between">
                  <span className="shift-label">{PAY_METHOD_LABEL.halfhalf}</span>
                  <Money value={totals.byMethod.halfhalf} size="lg" />
                </div>
                <CheckCard
                  checked={draft.halfhalfChecked}
                  onChange={(v) => update({ halfhalfChecked: v })}
                  label="ตรงกับแอปถุงเงินแล้ว"
                />
              </div>
            )}
            <p className="shift-hint">ถ้ายอดไม่ตรง ยังปิดยอดได้ ใส่หมายเหตุไว้ในขั้นถัดไป</p>
          </div>
        )}

        {cur === 'confirm' && counted !== null && diff !== null && (
          <div className="stack">
            <dl className="shift-kv">
              <div className="shift-kv-row">
                <dt>ยอดขาย</dt>
                <dd>
                  <Money value={totals.total} /> <span className="muted">· {num(totals.bills)} บิล</span>
                </dd>
              </div>
              <div className="shift-kv-row">
                <dt>เงินสดควรมี</dt>
                <dd>
                  <Money value={expected} />
                </dd>
              </div>
              <div className="shift-kv-row">
                <dt>นับได้</dt>
                <dd>
                  <Money value={counted} />
                </dd>
              </div>
              <div className="shift-kv-row shift-kv-total">
                <dt>ผลต่าง</dt>
                <dd>
                  <DiffBadge diff={diff} />
                </dd>
              </div>
              {hasTransfer && (
                <div className="shift-kv-row">
                  <dt>{PAY_METHOD_LABEL.transfer}</dt>
                  <dd>
                    <Money value={totals.byMethod.transfer} />{' '}
                    {draft.transferChecked ? <Badge tone="success">ตรงแล้ว</Badge> : <Badge tone="warning">ยังไม่ได้เช็ก</Badge>}
                  </dd>
                </div>
              )}
              {hasHalf && (
                <div className="shift-kv-row">
                  <dt>{PAY_METHOD_LABEL.halfhalf}</dt>
                  <dd>
                    <Money value={totals.byMethod.halfhalf} />{' '}
                    {draft.halfhalfChecked ? <Badge tone="success">ตรงแล้ว</Badge> : <Badge tone="warning">ยังไม่ได้เช็ก</Badge>}
                  </dd>
                </div>
              )}
              <div className="shift-kv-row">
                <dt>ปิดยอดโดย</dt>
                <dd>{staff.name}</dd>
              </div>
            </dl>
            {note}
            <p className="shift-hint">ปิดยอดแล้วแก้ไขไม่ได้ ถ้าจะขายต่อต้องเปิดร้านรอบใหม่</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
