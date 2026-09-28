// Add / edit one expense record (bottom sheet on phones, dialog on wide screens).
import { useId, useRef, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import type { Booth, DayKey, Expense, ID } from '../../types'
import { db, patch, remove, save } from '../../db'
import { EXPENSE_CATEGORIES } from '../../domain/reports'
import { addDays, todayKey } from '../../lib/dates'
import { bahtSign, thaiDate, thaiDateLong } from '../../lib/format'
import { Button, Field, Modal, MoneyInput, cx, useConfirm, useToast } from '../../ui'
import { categoryLabel } from './parts'
import {
  MIN_MONTH,
  NOTE_MAX,
  draftFields,
  hasErrors,
  isValidDayKey,
  maxExpenseDay,
  sameAsRecord,
  validateDraft,
  type ExpenseDraft,
} from './logic'

export interface ExpenseFormModalProps {
  /** null = new record */
  expense: Expense | null
  /** Used for a new record. */
  defaultDay: DayKey
  defaultBoothId: ID | null
  /** Active booths the user can pick. */
  booths: Booth[]
  boothName: (id: ID | null) => string
  staffId: ID | null
  onClose: () => void
  onSaved: (rec: Expense) => void
  onDeleted: () => void
}

export default function ExpenseFormModal({
  expense,
  defaultDay,
  defaultBoothId,
  booths,
  boothName,
  staffId,
  onClose,
  onSaved,
  onDeleted,
}: ExpenseFormModalProps) {
  const toast = useToast()
  const confirm = useConfirm()
  const formId = useId()
  const today = todayKey()
  const yesterday = addDays(today, -1)

  const [draft, setDraft] = useState<ExpenseDraft>(() =>
    expense
      ? {
          dayKey: expense.dayKey,
          category: expense.category,
          amount: expense.amount,
          boothId: expense.boothId,
          note: expense.note ?? '',
        }
      : { dayKey: defaultDay, category: null, amount: null, boothId: defaultBoothId, note: '' },
  )
  const [tried, setTried] = useState(false)
  const [busy, setBusyState] = useState<'save' | 'delete' | null>(null)
  // Ref guard so a fast double tap can't write twice before the button re-renders as busy.
  const busyRef = useRef(false)
  const setBusy = (b: 'save' | 'delete' | null) => {
    busyRef.current = b !== null
    setBusyState(b)
  }

  const errors = validateDraft(draft, today)
  const shown = tried ? errors : {}
  const set = (changes: Partial<ExpenseDraft>) => setDraft((d) => ({ ...d, ...changes }))

  // Booth choices: active booths, plus the record's own booth if it is no longer active.
  const boothOptions: { id: ID; name: string }[] = booths.map((b) => ({ id: b.id, name: b.name }))
  if (draft.boothId && !boothOptions.some((b) => b.id === draft.boothId)) {
    boothOptions.push({ id: draft.boothId, name: boothName(draft.boothId) })
  }
  // One-booth shops don't need the choice unless the record already belongs to a booth.
  const initialBoothId = expense ? expense.boothId : defaultBoothId
  const showBooth = booths.length >= 2 || initialBoothId !== null

  const dateHint =
    draft.dayKey && isValidDayKey(draft.dayKey) && !shown.dayKey
      ? draft.dayKey > today
        ? `${thaiDateLong(draft.dayKey)} · ยังไม่ถึงวันนี้`
        : thaiDateLong(draft.dayKey)
      : undefined

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busyRef.current) return
    setTried(true)
    if (hasErrors(errors)) return
    setBusy('save')
    try {
      if (expense) {
        if (sameAsRecord(draft, expense)) {
          onSaved(expense)
          return
        }
        const cur = await db.expenses.get(expense.id)
        if (!cur || cur.deleted === 1) {
          toast('รายการนี้ถูกลบไปแล้ว', 'error')
          onClose()
          return
        }
        const rec = await patch(db.expenses, expense.id, draftFields(draft))
        if (!rec) throw new Error('expense not found')
        onSaved(rec)
      } else {
        const rec = await save(db.expenses, { ...draftFields(draft), staffId })
        onSaved(rec)
      }
    } catch (err) {
      console.error('expenses: save failed', err)
      toast('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'error')
      setBusy(null)
    }
  }

  const doDelete = async () => {
    if (!expense || busyRef.current) return
    const ok = await confirm({
      title: 'ลบค่าใช้จ่ายนี้',
      message: `${categoryLabel(expense.category)} ${bahtSign(expense.amount)} · ${thaiDate(expense.dayKey)}`,
      confirmText: 'ลบ',
      danger: true,
    })
    if (!ok || busyRef.current) return
    setBusy('delete')
    try {
      await remove(db.expenses, expense.id)
      onDeleted()
    } catch (err) {
      console.error('expenses: delete failed', err)
      toast('ลบไม่สำเร็จ ลองอีกครั้ง', 'error')
      setBusy(null)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeOnBackdrop={false}
      title={expense ? 'แก้ไขค่าใช้จ่าย' : 'เพิ่มค่าใช้จ่าย'}
      footer={
        <>
          {expense && (
            <Button
              variant="ghost"
              size="lg"
              className="exp-foot-delete"
              icon={<Trash2 size={20} />}
              onClick={() => void doDelete()}
              loading={busy === 'delete'}
              disabled={busy === 'save'}
            >
              ลบ
            </Button>
          )}
          <Button
            type="submit"
            form={formId}
            variant="primary"
            size="lg"
            loading={busy === 'save'}
            disabled={busy === 'delete'}
          >
            บันทึก
          </Button>
        </>
      }
    >
      <form id={formId} className="stack exp-form" onSubmit={(e) => void submit(e)} noValidate>
        <Field label="ประเภท" error={shown.category} required>
          <div className="exp-chips" role="radiogroup" aria-label="ประเภทค่าใช้จ่าย">
            {EXPENSE_CATEGORIES.map((c) => {
              const active = draft.category === c
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={cx('chip', active && 'active')}
                  onClick={() => set({ category: c })}
                >
                  {categoryLabel(c)}
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="จำนวนเงิน" error={shown.amount} required>
          <MoneyInput value={draft.amount} onChange={(amount) => set({ amount })} allowDecimal />
        </Field>

        <Field label="วันที่" error={shown.dayKey} hint={dateHint} required>
          <input
            type="date"
            className="input"
            value={draft.dayKey}
            min={MIN_MONTH}
            max={maxExpenseDay(today)}
            onChange={(e) => set({ dayKey: e.target.value })}
          />
        </Field>
        <div className="exp-chips exp-date-chips">
          <button
            type="button"
            className={cx('chip', draft.dayKey === today && 'active')}
            aria-pressed={draft.dayKey === today}
            onClick={() => set({ dayKey: today })}
          >
            วันนี้
          </button>
          <button
            type="button"
            className={cx('chip', draft.dayKey === yesterday && 'active')}
            aria-pressed={draft.dayKey === yesterday}
            onClick={() => set({ dayKey: yesterday })}
          >
            เมื่อวาน
          </button>
        </div>

        {showBooth && (
          <Field label="ของแผงไหน">
            <div className="exp-chips" role="radiogroup" aria-label="แผง">
              <button
                type="button"
                role="radio"
                aria-checked={draft.boothId === null}
                className={cx('chip', draft.boothId === null && 'active')}
                onClick={() => set({ boothId: null })}
              >
                ทั้งร้าน
              </button>
              {boothOptions.map((b) => {
                const active = draft.boothId === b.id
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={cx('chip', active && 'active')}
                    onClick={() => set({ boothId: b.id })}
                  >
                    {b.name}
                  </button>
                )
              })}
            </div>
          </Field>
        )}

        <Field label="หมายเหตุ" hint="ไม่ใส่ก็ได้" error={shown.note}>
          <input
            type="text"
            className="input"
            value={draft.note}
            maxLength={NOTE_MAX}
            placeholder="เช่น ค่าเช่าเดือนนี้ จ่ายเจ้าของที่"
            enterKeyHint="done"
            onChange={(e) => set({ note: e.target.value })}
          />
        </Field>
      </form>
    </Modal>
  )
}
