// TEST HELPER (not used by the app): in-memory stand-ins for the Google Apps Script services
// that backend/Code.gs uses, so the tests run the real backend code end to end.
import type { FetchFn } from './transport'

type Cell = string | number | boolean | null

const CELL_LIMIT = 50000

export class MockSheet {
  data: Cell[][] = []
  maxRows = 1000
  maxCols = 26
  frozenRows = 0
  private readonly name: string

  constructor(name: string) {
    this.name = name
  }

  getName(): string {
    return this.name
  }
  getMaxRows(): number {
    return this.maxRows
  }
  getMaxColumns(): number {
    return this.maxCols
  }
  getLastRow(): number {
    for (let r = this.data.length - 1; r >= 0; r--) {
      const row = this.data[r]
      if (row && row.some((v) => v !== '' && v !== null && v !== undefined)) return r + 1
    }
    return 0
  }
  getLastColumn(): number {
    let c = 0
    for (const row of this.data) row?.forEach((v, i) => {
      if (v !== '' && v !== null && v !== undefined) c = Math.max(c, i + 1)
    })
    return c
  }
  insertRowsAfter(after: number, n: number): MockSheet {
    if (after < 1 || after > this.maxRows || n < 1) throw new Error('insertRowsAfter: bad arguments')
    if (after < this.data.length) this.data.splice(after, 0, ...Array.from({ length: n }, () => []))
    this.maxRows += n
    return this
  }
  insertColumnsAfter(after: number, n: number): MockSheet {
    if (after < 1 || after > this.maxCols || n < 1) throw new Error('insertColumnsAfter: bad arguments')
    this.maxCols += n
    return this
  }
  setFrozenRows(n: number): MockSheet {
    this.frozenRows = n
    return this
  }
  setColumnWidth(): MockSheet {
    return this
  }
  getRange(row: number, col: number, numRows = 1, numCols = 1): MockRange {
    if (![row, col, numRows, numCols].every(Number.isInteger)) throw new Error('getRange: non-integer argument')
    if (row < 1 || col < 1) throw new Error('getRange: out of bounds')
    if (numRows < 1) throw new Error('The number of rows in the range must be at least 1.')
    if (numCols < 1) throw new Error('The number of columns in the range must be at least 1.')
    if (row + numRows - 1 > this.maxRows || col + numCols - 1 > this.maxCols) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.')
    }
    return new MockRange(this, row, col, numRows, numCols)
  }
  cell(r: number, c: number): Cell {
    return this.data[r - 1]?.[c - 1] ?? ''
  }
  setCell(r: number, c: number, v: Cell): void {
    while (this.data.length < r) this.data.push([])
    const row = this.data[r - 1]
    while (row.length < c) row.push('')
    row[c - 1] = v
  }
  /** Data rows as objects keyed by the header row (for assertions). */
  records(): Record<string, Cell>[] {
    const last = this.getLastRow()
    if (last < 2) return []
    const header = (this.data[0] ?? []).map(String)
    const out: Record<string, Cell>[] = []
    for (let r = 2; r <= last; r++) {
      const rec: Record<string, Cell> = {}
      header.forEach((h, i) => {
        rec[h] = this.cell(r, i + 1)
      })
      out.push(rec)
    }
    return out
  }
}

export class MockRange {
  private readonly sheet: MockSheet
  private readonly row: number
  private readonly col: number
  private readonly numRows: number
  private readonly numCols: number

  constructor(sheet: MockSheet, row: number, col: number, numRows: number, numCols: number) {
    this.sheet = sheet
    this.row = row
    this.col = col
    this.numRows = numRows
    this.numCols = numCols
  }

  getValues(): Cell[][] {
    const out: Cell[][] = []
    for (let r = 0; r < this.numRows; r++) {
      const line: Cell[] = []
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet.cell(this.row + r, this.col + c))
      out.push(line)
    }
    return out
  }
  setValues(values: Cell[][]): MockRange {
    if (values.length !== this.numRows) throw new Error(`The number of rows in the data does not match the range (${values.length} vs ${this.numRows})`)
    values.forEach((line, r) => {
      if (line.length !== this.numCols) throw new Error(`The number of columns in the data does not match the range (${line.length} vs ${this.numCols})`)
      line.forEach((v, c) => {
        if (typeof v === 'string' && v.length > CELL_LIMIT) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.')
        if (v === undefined) throw new Error('undefined cell value')
        this.sheet.setCell(this.row + r, this.col + c, v)
      })
    })
    return this
  }
  getValue(): Cell {
    return this.sheet.cell(this.row, this.col)
  }
  setValue(v: Cell): MockRange {
    return this.setValues([[v]])
  }
  setNumberFormat(): MockRange {
    return this
  }
  setFontWeight(): MockRange {
    return this
  }
  setWrapStrategy(): MockRange {
    return this
  }
}

export class MockSpreadsheet {
  sheets: MockSheet[] = [new MockSheet('Sheet1')]

  getSheetByName(name: string): MockSheet | null {
    return this.sheets.find((s) => s.getName() === name) ?? null
  }
  insertSheet(name: string): MockSheet {
    if (this.getSheetByName(name)) throw new Error(`A sheet with the name "${name}" already exists.`)
    const sh = new MockSheet(name)
    this.sheets.push(sh)
    return sh
  }
  getSheets(): MockSheet[] {
    return [...this.sheets]
  }
  deleteSheet(sh: MockSheet): void {
    this.sheets = this.sheets.filter((s) => s !== sh)
  }
}

export interface LineCall {
  url: string
  options: { method: string; headers: Record<string, string>; payload: string; contentType: string }
}

export interface GasEnv {
  ss: MockSpreadsheet
  props: Map<string, string>
  logs: string[]
  lineCalls: LineCall[]
  lineStatus: number
  lineBody: string
  lockFree: boolean
  globals: Record<string, unknown>
}

interface TextOut {
  getContent(): string
}

export interface Backend {
  doPost(e: { postData: { contents: string; type?: string } }): TextOut
  doGet(): TextOut & { title: string }
  setup(): void
  testLine(): { ok: boolean; error?: string }
}

class TextOutput {
  mime = 'text/plain'
  private readonly content: string
  constructor(content: string) {
    this.content = content
  }
  setMimeType(m: string): TextOutput {
    this.mime = m
    return this
  }
  getContent(): string {
    return this.content
  }
}

class HtmlOutput {
  title = ''
  private readonly html: string
  constructor(html: string) {
    this.html = html
  }
  setTitle(t: string): HtmlOutput {
    this.title = t
    return this
  }
  addMetaTag(): HtmlOutput {
    return this
  }
  getContent(): string {
    return this.html
  }
}

function pseudoDigest(s: string): number[] {
  // Stand-in for MD5: 16 deterministic signed bytes.
  const out: number[] = []
  let h = 2166136261
  for (let round = 0; round < 16; round++) {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) + round
      h = Math.imul(h, 16777619) >>> 0
    }
    out.push(((h & 0xff) << 24) >> 24)
  }
  return out
}

export function createGasEnv(): GasEnv {
  const env: GasEnv = {
    ss: new MockSpreadsheet(),
    props: new Map(),
    logs: [],
    lineCalls: [],
    lineStatus: 200,
    lineBody: '{}',
    lockFree: true,
    globals: {},
  }
  const scriptProps = {
    getProperty: (k: string) => (env.props.has(k) ? env.props.get(k)! : null),
    setProperty: (k: string, v: string) => {
      env.props.set(k, String(v))
      return scriptProps
    },
    setProperties: (obj: Record<string, string>, deleteAllOthers?: boolean) => {
      if (deleteAllOthers) env.props.clear()
      for (const k of Object.keys(obj)) env.props.set(k, String(obj[k]))
      return scriptProps
    },
    getProperties: () => Object.fromEntries(env.props),
    deleteProperty: (k: string) => {
      env.props.delete(k)
      return scriptProps
    },
  }
  env.globals = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => env.ss,
      flush: () => undefined,
      WrapStrategy: { CLIP: 'CLIP', WRAP: 'WRAP', OVERFLOW: 'OVERFLOW' },
    },
    PropertiesService: { getScriptProperties: () => scriptProps },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => env.lockFree,
        waitLock: () => {
          if (!env.lockFree) throw new Error('Lock timeout')
        },
        releaseLock: () => undefined,
        hasLock: () => env.lockFree,
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
      createTextOutput: (content: string) => new TextOutput(content),
    },
    HtmlService: {
      createHtmlOutput: (html: string) => new HtmlOutput(html),
    },
    UrlFetchApp: {
      fetch: (url: string, options: LineCall['options']) => {
        env.lineCalls.push({ url, options })
        return { getResponseCode: () => env.lineStatus, getContentText: () => env.lineBody }
      },
    },
    Utilities: {
      DigestAlgorithm: { MD5: 'MD5' },
      Charset: { UTF_8: 'UTF-8' },
      computeDigest: (_alg: string, s: string) => pseudoDigest(s),
      getUuid: () => crypto.randomUUID(),
    },
    Logger: { log: (s: unknown) => env.logs.push(String(s)) },
  }
  return env
}

/** Evaluate Code.gs with the mock services as its globals. */
export function loadBackend(source: string, env: GasEnv): Backend {
  const names = Object.keys(env.globals)
  const factory = new Function(...names, `${source}\n;return { doPost, doGet, setup, testLine };`) as (...args: unknown[]) => Backend
  return factory(...names.map((n) => env.globals[n]))
}

export interface FakeRequest {
  url: string
  method: string
  contentType: string
  body: Record<string, unknown>
}

export interface BackendFetch {
  fetch: FetchFn
  requests: FakeRequest[]
  /** throw a network error instead of answering */
  down: boolean
  /** called with each parsed request before the backend handles it */
  before: ((body: Record<string, unknown>) => void | Promise<void>) | null
  /** answer with this raw text (e.g. an HTML login page) instead of calling the backend */
  rawReply: string | null
}

/** A fetch() that hands the request to the backend like the Apps Script /exec endpoint would. */
export function backendFetch(backend: Backend): BackendFetch {
  const bf: BackendFetch = {
    requests: [],
    down: false,
    before: null,
    rawReply: null,
    fetch: async (url, init) => {
      if (bf.down) throw new TypeError('Failed to fetch')
      const headers = new Headers(init.headers)
      const text = String(init.body)
      const body = JSON.parse(text) as Record<string, unknown>
      bf.requests.push({ url, method: String(init.method), contentType: headers.get('Content-Type') ?? '', body })
      if (bf.before) await bf.before(body)
      if (bf.rawReply !== null) return new Response(bf.rawReply, { status: 200, headers: { 'Content-Type': 'text/html' } })
      const out = backend.doPost({ postData: { contents: text, type: 'text/plain' } })
      return new Response(out.getContent(), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  }
  return bf
}
