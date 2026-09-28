// Send the summary to LINE, share / copy it, or download CSV files.
import { useState } from 'react'
import { Download, FileSpreadsheet, Send, Share2 } from 'lucide-react'
import { Button, Modal, useToast } from '../../ui'
import { lineShareUrl } from '../../domain/summary'
import { downloadText, shareOrCopy, toCsv } from '../../lib/share'

type Cell = string | number | null | undefined

export interface CsvOption {
  key: string
  label: string
  hint: string
  fileName: string
  /** built only when chosen (can be large) */
  rows: () => Cell[][]
  disabled?: boolean
}

export function ReportActions({
  summary,
  title,
  csv,
  busy,
}: {
  /** plain-text summary; null while loading */
  summary: string | null
  title: string
  csv: CsvOption[]
  busy: boolean
}) {
  const toast = useToast()
  const [csvOpen, setCsvOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const ready = summary !== null && !busy

  const share = async () => {
    if (!summary) return
    setSharing(true)
    try {
      const hasShareSheet = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      const res = await shareOrCopy(summary, title)
      if (res === 'copied') toast('คัดลอกสรุปแล้ว วางในแชตได้เลย', 'success')
      else if (res === 'failed' && !hasShareSheet) toast('คัดลอกไม่ได้ ลองกดส่งเข้า LINE แทน', 'error')
    } finally {
      setSharing(false)
    }
  }

  const download = (o: CsvOption) => {
    try {
      downloadText(o.fileName, toCsv(o.rows()))
      toast('ดาวน์โหลดแล้ว', 'success')
      setCsvOpen(false)
    } catch (e) {
      console.error('reports: csv download failed', e)
      toast('ดาวน์โหลดไม่สำเร็จ', 'error')
    }
  }

  return (
    <div className="rep-actions">
      {ready ? (
        <a className="btn btn-primary rep-action-line" href={lineShareUrl(summary)} target="_blank" rel="noopener noreferrer">
          <span className="btn-icon" aria-hidden="true">
            <Send size={20} />
          </span>
          <span className="btn-label">ส่งสรุปเข้า LINE</span>
        </a>
      ) : (
        <Button variant="primary" className="rep-action-line" icon={<Send size={20} />} disabled>
          ส่งสรุปเข้า LINE
        </Button>
      )}
      <Button icon={<Share2 size={20} />} onClick={() => void share()} loading={sharing} disabled={!ready}>
        แชร์ / คัดลอก
      </Button>
      <Button icon={<Download size={20} />} onClick={() => setCsvOpen(true)} disabled={!ready || csv.every((o) => o.disabled)}>
        ดาวน์โหลด CSV
      </Button>

      <Modal open={csvOpen} onClose={() => setCsvOpen(false)} title="ดาวน์โหลด CSV">
        <div className="stack">
          <p className="muted rep-modal-hint">เปิดได้ด้วย Excel หรือ Google Sheets</p>
          {csv.map((o) => (
            <button key={o.key} type="button" className="rep-dl" onClick={() => download(o)} disabled={o.disabled}>
              <span className="rep-dl-icon" aria-hidden="true">
                <FileSpreadsheet size={24} />
              </span>
              <span className="rep-dl-text">
                <span className="rep-dl-label">{o.label}</span>
                <span className="rep-dl-hint">{o.hint}</span>
              </span>
              <Download size={20} aria-hidden="true" className="rep-dl-go" />
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}
