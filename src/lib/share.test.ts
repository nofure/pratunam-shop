import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyText, downloadText, shareOrCopy, toCsv } from './share'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** Blob text keeping a leading BOM (Blob.text() strips it). */
async function raw(b: Blob): Promise<string> {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await b.arrayBuffer())
}

function abortError(): Error {
  const e = new Error('cancelled')
  e.name = 'AbortError'
  return e
}

describe('toCsv', () => {
  it('joins cells with commas and rows with CRLF', () => {
    expect(
      toCsv([
        ['วันที่', 'ยอด'],
        ['2026-09-29', 1234],
      ]),
    ).toBe('วันที่,ยอด\r\n2026-09-29,1234')
  })

  it('quotes commas, quotes and line breaks (RFC 4180)', () => {
    expect(toCsv([['a,b', 'say "hi"', 'line1\nline2', 'cr\r', 'plain']])).toBe(
      '"a,b","say ""hi""","line1\nline2","cr\r",plain',
    )
  })

  it('empty cells for null / undefined / NaN', () => {
    expect(toCsv([[null, undefined, Number.NaN, 0, -20.5, '']])).toBe(',,,0,-20.5,')
  })

  it('empty input', () => {
    expect(toCsv([])).toBe('')
  })
})

describe('shareOrCopy', () => {
  it('uses the share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })
    await expect(shareOrCopy('ยอด 100', 'สรุป')).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 'สรุป', text: 'ยอด 100' })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('returns failed without copying when the user cancels', async () => {
    const share = vi.fn().mockRejectedValue(abortError())
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })
    await expect(shareOrCopy('x')).resolves.toBe('failed')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to copying when sharing is not allowed', async () => {
    const e = new Error('no')
    e.name = 'NotAllowedError'
    const share = vi.fn().mockRejectedValue(e)
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, clipboard: { writeText } })
    await expect(shareOrCopy('x')).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith('x')
  })

  it('copies when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(shareOrCopy('ข้อความ')).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith('ข้อความ')
  })

  it('fails when nothing works', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    vi.stubGlobal('document', undefined)
    await expect(shareOrCopy('x')).resolves.toBe('failed')
  })
})

describe('copyText', () => {
  it('uses the clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await expect(copyText('abc')).resolves.toBe(true)
  })

  it('falls back to execCommand when the clipboard API is missing (plain http)', async () => {
    vi.stubGlobal('navigator', {})
    const ta = {
      value: '',
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      focus: vi.fn(),
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    }
    const body = { appendChild: vi.fn(), removeChild: vi.fn() }
    const execCommand = vi.fn().mockReturnValue(true)
    vi.stubGlobal('document', { body, activeElement: null, createElement: vi.fn().mockReturnValue(ta), execCommand })
    await expect(copyText('สวัสดี')).resolves.toBe(true)
    expect(ta.value).toBe('สวัสดี')
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(body.removeChild).toHaveBeenCalledWith(ta)
  })

  it('returns false when execCommand fails', async () => {
    vi.stubGlobal('navigator', {})
    const ta = { value: '', style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {} }
    vi.stubGlobal('document', {
      body: { appendChild() {}, removeChild() {} },
      activeElement: null,
      createElement: () => ta,
      execCommand: () => false,
    })
    await expect(copyText('x')).resolves.toBe(false)
  })
})

describe('downloadText', () => {
  let anchor: { href: string; download: string; rel: string; style: Record<string, string>; click: ReturnType<typeof vi.fn> }
  let blobs: Blob[]

  beforeEach(() => {
    vi.useFakeTimers()
    anchor = { href: '', download: '', rel: '', style: {}, click: vi.fn() }
    blobs = []
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: vi.fn().mockReturnValue(anchor),
    })
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blobs.push(b as Blob)
      return 'blob:test'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  it('adds a UTF-8 BOM to CSV files', async () => {
    downloadText('report.csv', 'a,b')
    expect(anchor.download).toBe('report.csv')
    expect(anchor.href).toBe('blob:test')
    expect(anchor.click).toHaveBeenCalled()
    expect(blobs[0].type).toBe('text/csv;charset=utf-8')
    const bytes = new Uint8Array(await blobs[0].arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(await raw(blobs[0])).toBe('﻿a,b')
    vi.runAllTimers()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('adds the BOM when the mime type is CSV and never twice', async () => {
    downloadText('export', 'x', 'text/csv')
    downloadText('again.csv', '﻿y')
    expect(await raw(blobs[0])).toBe('﻿x')
    expect(await raw(blobs[1])).toBe('﻿y')
  })

  it('leaves other files alone', async () => {
    downloadText('backup.json', '{"a":1}', 'application/json')
    expect(blobs[0].type).toBe('application/json')
    expect(await raw(blobs[0])).toBe('{"a":1}')
  })
})
