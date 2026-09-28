// Browser helpers: share sheet / clipboard / file download / CSV.

function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'
}

/**
 * Open the phone's share sheet (LINE, Messenger…). Falls back to copying the text.
 * 'failed' = the user closed the share sheet, or copying was not possible.
 */
export async function shareOrCopy(text: string, title?: string): Promise<'shared' | 'copied' | 'failed'> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share(title ? { title, text } : { text })
      return 'shared'
    } catch (e) {
      if (isAbortError(e)) return 'failed'
      // NotAllowedError / unsupported data → fall back to copying
    }
  }
  return (await copyText(text)) ? 'copied' : 'failed'
}

/** Copy to the clipboard. Works on plain-http LAN addresses too (execCommand fallback). */
export async function copyText(text: string): Promise<boolean> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(text)
      return true
    } catch {
      // not a secure context / permission denied → try the old way
    }
  }
  if (typeof document === 'undefined' || !document.body) return false
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '0'
  ta.style.left = '-9999px'
  ta.style.opacity = '0'
  ta.style.fontSize = '16px' // avoid iOS zoom
  document.body.appendChild(ta)
  const prevFocus = document.activeElement as HTMLElement | null
  let ok = false
  try {
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    ok = typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    ok = false
  } finally {
    document.body.removeChild(ta)
    prevFocus?.focus?.()
  }
  return ok
}

/** Save text as a file. CSV files get a UTF-8 BOM so Excel shows Thai correctly. */
export function downloadText(filename: string, text: string, mime?: string): void {
  const isCsv = (mime ?? '').toLowerCase().startsWith('text/csv') || filename.toLowerCase().endsWith('.csv')
  const type = mime ?? (isCsv ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8')
  const body = isCsv && !text.startsWith('﻿') ? '﻿' + text : text
  const blob = new Blob([body], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoking immediately can cancel the download on some mobile browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** RFC 4180 CSV (CRLF line breaks, quotes doubled). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}
