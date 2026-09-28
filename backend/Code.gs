/** @OnlyCurrentDoc */
// ระบบร้าน — ตัวเชื่อมข้อมูลหลายเครื่อง (ซิงก์) และส่งสรุปเข้า LINE
//
// Google Apps Script web app (V8 runtime). Create it from the shop's Google Sheet:
// Extensions > Apps Script, paste this whole file, run setup() once, then
// Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
// Thai step-by-step guide: docs/sync-setup.md
//
// Script Properties (Project Settings > Script Properties):
//   SYNC_KEY   shared secret the app sends with every request (setup() creates one if missing)
//   LINE_TOKEN LINE Messaging API channel access token (long-lived)       — optional
//   LINE_TO    LINE user ID / group ID to push to (comma-separate several) — optional
// Internal properties kept by this script: SEQ, COMMITTED, TABMAX_<table>.
//
// Protocol: the app POSTs text/plain JSON { key, deviceId, action, ... } and gets JSON back.
//   ping                  -> { ok, serverTime, shopName, version }
//   push { rows }         -> { ok, accepted, seq, stale, invalid }   upsert by id, last-write-wins on updatedAt
//   pull { since, limit } -> { ok, rows, nextSeq, more, seq }        rows with seq > since, ordered by seq
//   line { text, retryKey } -> { ok, error?, detail? }
//   wrong / missing key   -> { ok: false, error: 'unauthorized' }

const APP_VERSION = 1

const META_HEADERS = ['id', 'seq', 'updatedAt', 'deleted', 'deviceId', 'data']
const COL_DATA = 6 // 1-based column of the JSON data cell
const CELL_MAX = 45000 // Sheets cells hold at most 50,000 characters
const OVERFLOW_SHEET = '_overflow'
const OVERFLOW_MARK = '@overflow'
const PUSH_MAX_ROWS = 500
const PULL_DEFAULT = 500
const PULL_MAX = 1000
const READ_GAP = 30 // read neighbouring rows in one call when they are this close
const LOCK_WAIT_MS = 30000
const STALE_MAX = 50
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push'
const LINE_TEXT_MAX = 5000

const PAY_LABEL = { cash: 'เงินสด', transfer: 'โอน / QR', halfhalf: 'คนละครึ่ง', other: 'อื่นๆ' }
const EXPENSE_LABEL = {
  rent: 'ค่าเช่าแผง',
  electric: 'ค่าไฟ / น้ำ',
  wage: 'ค่าจ้างคนขาย',
  supplies: 'ถุง / ไม้แขวน / ของใช้',
  travel: 'ค่ารถ / ค่าส่งของ',
  food: 'ค่าข้าว',
  other: 'อื่นๆ',
}
const ADJUST_LABEL = {
  count: 'นับสต็อก',
  damaged: 'ของเสีย / ชำรุด',
  lost: 'ของหาย',
  transfer_in: 'ย้ายเข้าจากแผงอื่น',
  transfer_out: 'ย้ายไปแผงอื่น',
  return_supplier: 'คืนร้านที่ซื้อมา',
  other: 'อื่นๆ',
}

// Human-readable columns after the 6 machine columns, so the owner can read the sheet.
// type: 't' text, 'm' money (2 decimals), 'i' whole number.
function col_(header, type, get) {
  return { header: header, type: type, get: get }
}

const TABLES = {
  shop: [
    col_('ชื่อร้าน', 't', (r) => r.name),
    col_('พร้อมเพย์', 't', (r) => r.promptPayId),
    col_('ชื่อบัญชี', 't', (r) => r.promptPayName),
  ],
  booths: [
    col_('ชื่อแผง', 't', (r) => r.name),
    col_('เงินทอนตั้งต้น', 'm', (r) => r.openingFloat),
    col_('ใช้งาน', 't', (r) => activeLabel_(r.active)),
  ],
  staff: [
    col_('ชื่อ', 't', (r) => r.name),
    col_('หน้าที่', 't', (r) => (r.role === 'owner' ? 'เจ้าของ' : 'คนขาย')),
    col_('แผงประจำ', 't', (r, c) => (r.boothId ? c.booth(r.boothId) : 'ทุกแผง')),
    col_('ใช้งาน', 't', (r) => activeLabel_(r.active)),
  ],
  tiers: [
    col_('แผง', 't', (r, c) => c.booth(r.boothId)),
    col_('ชื่อ', 't', (r) => r.name),
    col_('ราคา', 'm', (r) => r.price),
    col_('โปร', 't', (r) => (r.promoQty && r.promoPrice ? r.promoQty + ' ' + (r.unit || '') + ' ' + r.promoPrice : '')),
    col_('หน่วย', 't', (r) => r.unit),
    col_('ใช้งาน', 't', (r) => activeLabel_(r.active)),
  ],
  suppliers: [
    col_('ชื่อ', 't', (r) => r.name),
    col_('โทร', 't', (r) => r.phone),
    col_('ที่อยู่', 't', (r) => r.location),
    col_('หมายเหตุ', 't', (r) => r.note),
  ],
  shifts: [
    col_('วันที่', 't', (r) => r.dayKey),
    col_('แผง', 't', (r, c) => c.booth(r.boothId)),
    col_('เปิดโดย', 't', (r, c) => c.staff(r.staffId)),
    col_('สถานะ', 't', (r) => (r.status === 'closed' ? 'ปิดยอดแล้ว' : 'เปิดอยู่')),
    col_('เงินทอนตั้งต้น', 'm', (r) => r.openingFloat),
    col_('ยอดขาย', 'm', (r) => (r.snapshot ? r.snapshot.total : '')),
    col_('เงินที่ควรมี', 'm', (r) => r.expectedCash),
    col_('นับได้', 'm', (r) => r.countedCash),
    col_('ขาด/เกิน', 'm', (r) => r.cashDiff),
  ],
  sales: [
    col_('วันที่', 't', (r) => r.dayKey),
    col_('เวลา', 't', (r) => timeHM_(r.createdAt)),
    col_('แผง', 't', (r, c) => c.booth(r.boothId)),
    col_('คนขาย', 't', (r, c) => c.staff(r.staffId)),
    col_('บิลที่', 'i', (r) => r.billNo),
    col_('ชิ้น', 'i', (r) => r.pieces),
    col_('ยอด', 'm', (r) => r.total),
    col_('ส่วนลด', 'm', (r) => (Number(r.promoDiscount) || 0) + (Number(r.manualDiscount) || 0)),
    col_('จ่ายด้วย', 't', (r) => PAY_LABEL[r.method] || r.method),
    col_('สถานะ', 't', (r) => (r.status === 'void' ? 'ยกเลิก' : 'ขายแล้ว')),
    col_('รายการ', 't', (r) => itemsText_(r.items)),
  ],
  cashMoves: [
    col_('วันที่', 't', (r) => r.dayKey),
    col_('แผง', 't', (r, c) => c.booth(r.boothId)),
    col_('ประเภท', 't', (r) => (r.type === 'in' ? 'เงินเข้า' : 'เงินออก')),
    col_('จำนวน', 'm', (r) => r.amount),
    col_('เหตุผล', 't', (r) => r.reason),
    col_('หมวดค่าใช้จ่าย', 't', (r) => (r.category ? EXPENSE_LABEL[r.category] || r.category : '')),
  ],
  lots: [
    col_('วันที่', 't', (r) => r.dayKey),
    col_('แผง', 't', (r, c) => c.booth(r.boothId)),
    col_('ปุ่มราคา', 't', (r, c) => c.tier(r.tierId)),
    col_('จำนวน', 'i', (r) => r.qty),
    col_('ทุนต่อชิ้น', 'm', (r) => r.unitCost),
    col_('ทุนรวม', 'm', (r) => r.totalCost),
    col_('หมายเหตุ', 't', (r) => r.note),
  ],
  adjustments: [
    col_('วันที่', 't', (r) => r.dayKey),
    col_('แผง', 't', (r, c) => c.booth(r.boothId)),
    col_('ปุ่มราคา', 't', (r, c) => c.tier(r.tierId)),
    col_('เปลี่ยน', 'i', (r) => r.qtyChange),
    col_('เหตุผล', 't', (r) => ADJUST_LABEL[r.reason] || r.reason),
    col_('หมายเหตุ', 't', (r) => r.note),
  ],
  expenses: [
    col_('วันที่', 't', (r) => r.dayKey),
    col_('แผง', 't', (r, c) => (r.boothId ? c.booth(r.boothId) : 'ทั้งร้าน')),
    col_('หมวด', 't', (r) => EXPENSE_LABEL[r.category] || r.category),
    col_('จำนวน', 'm', (r) => r.amount),
    col_('หมายเหตุ', 't', (r) => r.note),
  ],
}
// Config tables first so names are known when later rows in the same push are written.
const TABLE_ORDER = ['shop', 'booths', 'staff', 'tiers', 'suppliers', 'shifts', 'sales', 'cashMoves', 'lots', 'adjustments', 'expenses']
const NAME_TABLES = { booths: true, staff: true, tiers: true }

// ---------------------------------------------------------------- entry points

function doPost(e) {
  let out
  try {
    out = handle_(parseBody_(e))
  } catch (err) {
    console.error(err && err.stack ? err.stack : err)
    out = { ok: false, error: 'server_error', detail: String((err && err.message) || err).slice(0, 300) }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON)
}

function doGet() {
  const props = PropertiesService.getScriptProperties()
  const keyOk = !!String(props.getProperty('SYNC_KEY') || '').trim()
  const lineOk = lineConfig_().ok
  const item = (label, ok, okText, noText) =>
    '<li><span>' + label + '</span><b class="' + (ok ? 'ok' : 'no') + '">' + (ok ? okText : noText) + '</b></li>'
  const html =
    '<!doctype html><html lang="th"><head><meta charset="utf-8">' +
    '<style>body{margin:0;background:#f7f4ec;color:#1d1b16;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    'main{max-width:520px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 8px}' +
    'ul{list-style:none;padding:0;margin:16px 0;background:#fff;border:1px solid #e2dccd;border-radius:12px}' +
    'li{display:flex;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid #e2dccd}li:last-child{border:0}' +
    '.ok{color:#2b8a3e}.no{color:#a35d00}p{color:#5c574c}</style></head><body><main>' +
    '<h1>ตัวเชื่อมข้อมูลร้านทำงานอยู่</h1>' +
    '<p>คัดลอกลิงก์ของหน้านี้ไปใส่ในแอประบบร้าน ที่ เมนู &gt; ตั้งค่า &gt; ซิงก์และ LINE พร้อมรหัสซิงก์</p>' +
    '<ul>' +
    item('รหัสซิงก์ (SYNC_KEY)', keyOk, 'ตั้งแล้ว', 'ยังไม่ได้ตั้ง — เปิด Apps Script แล้วเรียกใช้ setup') +
    item('ส่งสรุปเข้า LINE', lineOk, 'ตั้งแล้ว', 'ยังไม่ได้ตั้ง (ไม่บังคับ)') +
    '</ul><p>รุ่น ' + APP_VERSION + '</p></main></body></html>'
  return HtmlService.createHtmlOutput(html)
    .setTitle('ระบบร้าน · ตัวเชื่อมข้อมูล')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
}

/** Run once from the editor: creates the tabs, the SYNC_KEY (if missing) and asks for permissions. */
function setup() {
  const ss = ss_()
  TABLE_ORDER.forEach((table) => {
    const sh = ss.getSheetByName(table)
    if (sh) formatSheet_(sh, table)
    else sheet_(ss, table)
  })
  // Remove the empty default tab ("Sheet1" / "แผ่น1") that a new spreadsheet starts with.
  ss.getSheets().forEach((sh) => {
    const name = sh.getName()
    if (TABLES[name] || name === OVERFLOW_SHEET) return
    if (sh.getLastRow() === 0 && sh.getLastColumn() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh)
  })
  const props = PropertiesService.getScriptProperties()
  if (props.getProperty('SEQ') === null) props.setProperty('SEQ', '0')
  if (props.getProperty('COMMITTED') === null) props.setProperty('COMMITTED', props.getProperty('SEQ') || '0')
  let key = String(props.getProperty('SYNC_KEY') || '').trim()
  if (!key) {
    key = newKey_()
    props.setProperty('SYNC_KEY', key)
    Logger.log('สร้างรหัสซิงก์ (SYNC_KEY) ให้แล้ว: ' + key)
  } else {
    Logger.log('รหัสซิงก์ (SYNC_KEY) ที่ตั้งไว้: ' + key)
  }
  Logger.log(lineConfig_().ok ? 'LINE: ตั้งค่าแล้ว' : 'LINE: ยังไม่ได้ตั้งค่า (ไม่บังคับ)')
  Logger.log('ตั้งค่าเสร็จแล้ว ต่อไปกด "การทำให้ใช้งานได้" > "การทำให้ใช้งานได้รายการใหม่" > เว็บแอป')
}

/** Run from the editor to check the LINE settings: sends a short test message. */
function testLine() {
  const res = line_({ text: 'ทดสอบส่ง LINE จากระบบร้าน ' + timeHM_(Date.now()) })
  Logger.log(res.ok ? 'ส่ง LINE สำเร็จ' : 'ส่ง LINE ไม่สำเร็จ: ' + res.error + (res.detail ? ' — ' + res.detail : ''))
  return res
}

// ---------------------------------------------------------------- request handling

function parseBody_(e) {
  const raw = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : ''
  try {
    const req = JSON.parse(raw)
    return req && typeof req === 'object' && !Array.isArray(req) ? req : null
  } catch (err) {
    return null
  }
}

function handle_(req) {
  if (!req) return { ok: false, error: 'bad_request' }
  const authError = checkKey_(req.key)
  if (authError) return { ok: false, error: authError }
  switch (req.action) {
    case 'ping':
      return ping_()
    case 'push':
      return push_(req)
    case 'pull':
      return pull_(req)
    case 'line':
      return line_(req)
    default:
      return { ok: false, error: 'unknown_action' }
  }
}

function checkKey_(key) {
  const expected = String(PropertiesService.getScriptProperties().getProperty('SYNC_KEY') || '').trim()
  if (!expected) return 'server_key_missing'
  const given = typeof key === 'string' ? key.trim() : ''
  if (!given || !sameText_(given, expected)) return 'unauthorized'
  return null
}

function sameText_(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function ping_() {
  let shopName = ''
  const sh = ss_().getSheetByName('shop')
  if (sh && sh.getLastRow() >= 2) {
    const refs = []
    const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === 'shop') {
        refs.push({ table: 'shop', sh: sh, rowNum: i + 2 })
        break
      }
    }
    const rows = readRowsAt_(ss_(), refs)
    if (rows.length && rows[0].row && typeof rows[0].row.name === 'string') shopName = rows[0].row.name
  }
  return { ok: true, serverTime: Date.now(), shopName: shopName, version: APP_VERSION }
}

// ---------------------------------------------------------------- push

function push_(req) {
  const items = req.rows
  if (!Array.isArray(items)) return { ok: false, error: 'bad_request' }
  if (items.length > PUSH_MAX_ROWS) return { ok: false, error: 'too_many_rows' }

  const invalid = []
  const groups = Object.create(null)
  items.forEach((it) => {
    const table = it && it.table
    const row = it && it.row
    const id = row && typeof row === 'object' ? row.id : undefined
    if (typeof table !== 'string' || !Object.prototype.hasOwnProperty.call(TABLES, table)) {
      invalid.push({ table: String(table), id: String(id || ''), reason: 'unknown_table' })
      return
    }
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof id !== 'string' || !ID_RE.test(id)) {
      invalid.push({ table: table, id: String(id || ''), reason: 'bad_id' })
      return
    }
    if (typeof row.updatedAt !== 'number' || !isFinite(row.updatedAt)) {
      invalid.push({ table: table, id: id, reason: 'bad_updatedAt' })
      return
    }
    const g = groups[table] || (groups[table] = Object.create(null))
    const prev = g[id]
    if (!prev || row.updatedAt > prev.updatedAt) g[id] = row
  })

  const lock = LockService.getScriptLock()
  if (!lock.tryLock(LOCK_WAIT_MS)) return { ok: false, error: 'busy' }
  try {
    const ss = ss_()
    const props = PropertiesService.getScriptProperties()
    const startSeq = Number(props.getProperty('SEQ')) || 0
    let seq = startSeq
    const ctx = nameCtx_(ss)
    const plans = []
    const staleRefs = []

    TABLE_ORDER.forEach((table) => {
      const g = groups[table]
      if (!g) return
      const sh = sheet_(ss, table)
      const index = readIndex_(sh)
      const plan = { table: table, sh: sh, width: widthOf_(table), appends: [], updates: [], overflow: [], maxSeq: 0 }
      Object.keys(g).forEach((id) => {
        const row = g[id]
        const cur = index[id]
        if (cur && !(row.updatedAt > cur.updatedAt)) {
          // Server keeps its copy (newer, or equal = server wins). Hand back equal-time copies from
          // another device so the app converges; newer ones reach it through pull.
          if (row.updatedAt === cur.updatedAt && cur.deviceId !== String(row.deviceId || '') && staleRefs.length < STALE_MAX) {
            staleRefs.push({ table: table, sh: sh, rowNum: cur.rowNum })
          }
          return
        }
        seq += 1
        const values = rowValues_(table, row, seq, ctx, plan)
        if (cur) plan.updates.push({ rowNum: cur.rowNum, values: values })
        else plan.appends.push(values)
        plan.maxSeq = seq
        if (NAME_TABLES[table]) ctx.learn(table, row)
      })
      if (plan.appends.length || plan.updates.length) plans.push(plan)
    })

    const accepted = seq - startSeq
    if (accepted > 0) {
      // Reserve the seq range before writing so a crash never reuses numbers.
      const reserve = { SEQ: String(seq) }
      plans.forEach((p) => {
        reserve['TABMAX_' + p.table] = String(p.maxSeq)
      })
      props.setProperties(reserve)
      plans.forEach(writePlan_)
      writeOverflow_(ss, plans)
      SpreadsheetApp.flush()
    }
    // Everything up to SEQ is on the sheet now (we hold the lock), so pulls may see it.
    props.setProperty('COMMITTED', String(seq))
    const stale = staleRefs.length ? readRowsAt_(ss, staleRefs) : []
    return { ok: true, accepted: accepted, seq: seq, stale: stale, invalid: invalid }
  } finally {
    lock.releaseLock()
  }
}

function rowValues_(table, row, seq, ctx, plan) {
  const json = JSON.stringify(row)
  let dataCell = json
  if (json.length > CELL_MAX) {
    plan.overflow.push({ key: table + ':' + row.id, json: json })
    dataCell = OVERFLOW_MARK
  }
  const readable = TABLES[table].map((c) => cellValue_(c, row, ctx))
  return [row.id, seq, row.updatedAt, row.deleted === 1 ? 1 : 0, text_(row.deviceId, 100), dataCell].concat(readable)
}

function writePlan_(p) {
  const sh = p.sh
  if (p.appends.length) {
    const start = Math.max(sh.getLastRow(), 1) + 1
    ensureRows_(sh, start + p.appends.length - 1)
    sh.getRange(start, 1, p.appends.length, p.width).setValues(p.appends)
  }
  if (p.updates.length) {
    p.updates.sort((a, b) => a.rowNum - b.rowNum)
    let i = 0
    while (i < p.updates.length) {
      let j = i
      while (j + 1 < p.updates.length && p.updates[j + 1].rowNum === p.updates[j].rowNum + 1) j++
      const run = p.updates.slice(i, j + 1).map((u) => u.values)
      sh.getRange(p.updates[i].rowNum, 1, run.length, p.width).setValues(run)
      i = j + 1
    }
  }
}

function readIndex_(sh) {
  const index = Object.create(null)
  const last = sh.getLastRow()
  if (last < 2) return index
  const vals = sh.getRange(2, 1, last - 1, 5).getValues()
  for (let i = 0; i < vals.length; i++) {
    const id = String(vals[i][0] || '')
    if (!id || index[id]) continue
    index[id] = { rowNum: i + 2, updatedAt: Number(vals[i][2]) || 0, deviceId: String(vals[i][4] || '') }
  }
  return index
}

// ---------------------------------------------------------------- pull

function pull_(req) {
  const since = Math.max(0, Math.floor(Number(req.since) || 0))
  const limit = Math.min(PULL_MAX, Math.max(1, Math.floor(Number(req.limit) || PULL_DEFAULT)))
  const all = PropertiesService.getScriptProperties().getProperties()
  const committed = Number(all.COMMITTED !== undefined && all.COMMITTED !== null ? all.COMMITTED : all.SEQ) || 0
  if (committed <= since) return { ok: true, rows: [], nextSeq: since, more: false, seq: committed }

  const ss = ss_()
  const cands = []
  TABLE_ORDER.forEach((table) => {
    const tabMax = all['TABMAX_' + table]
    if (tabMax !== undefined && tabMax !== null && Number(tabMax) <= since) return
    const sh = ss.getSheetByName(table)
    if (!sh) return
    const last = sh.getLastRow()
    if (last < 2) return
    const seqs = sh.getRange(2, 2, last - 1, 1).getValues()
    for (let i = 0; i < seqs.length; i++) {
      const s = Number(seqs[i][0])
      if (s > since && s <= committed) cands.push({ table: table, sh: sh, rowNum: i + 2, seq: s })
    }
  })
  cands.sort((a, b) => a.seq - b.seq)
  const more = cands.length > limit
  const page = more ? cands.slice(0, limit) : cands
  const rows = readRowsAt_(ss, page)
  // Every row with seq in (since, committed] was scanned, so the cursor can jump to committed.
  const nextSeq = more ? page[page.length - 1].seq : committed
  return { ok: true, rows: rows, nextSeq: nextSeq, more: more, seq: committed }
}

/** Read the data JSON of the given rows (grouped into few range reads), in the order given. */
function readRowsAt_(ss, refs) {
  const byTable = Object.create(null)
  refs.forEach((r, i) => {
    ;(byTable[r.table] || (byTable[r.table] = [])).push({ r: r, i: i })
  })
  const cells = new Array(refs.length)
  Object.keys(byTable).forEach((table) => {
    const list = byTable[table].sort((a, b) => a.r.rowNum - b.r.rowNum)
    const sh = list[0].r.sh
    let k = 0
    while (k < list.length) {
      let m = k
      while (m + 1 < list.length && list[m + 1].r.rowNum - list[m].r.rowNum <= READ_GAP) m++
      const start = list[k].r.rowNum
      const vals = sh.getRange(start, 1, list[m].r.rowNum - start + 1, COL_DATA).getValues()
      for (let x = k; x <= m; x++) cells[list[x].i] = vals[list[x].r.rowNum - start]
      k = m + 1
    }
  })
  let overflow = null
  const out = []
  refs.forEach((r, i) => {
    const v = cells[i]
    if (!v) return
    let json = v[COL_DATA - 1]
    if (json === OVERFLOW_MARK) {
      overflow = overflow || readOverflow_(ss)
      json = overflow[r.table + ':' + String(v[0])]
    }
    if (typeof json !== 'string' || !json) return
    try {
      const row = JSON.parse(json)
      if (row && typeof row === 'object' && typeof row.id === 'string') out.push({ table: r.table, row: row })
    } catch (err) {
      console.warn('skip unreadable row ' + r.table + ' #' + r.rowNum)
    }
  })
  return out
}

// ---------------------------------------------------------------- oversized rows

function writeOverflow_(ss, plans) {
  const items = []
  plans.forEach((p) => p.overflow.forEach((o) => items.push(o)))
  if (!items.length) return
  let sh = ss.getSheetByName(OVERFLOW_SHEET)
  if (!sh) {
    sh = ss.insertSheet(OVERFLOW_SHEET)
    sh.getRange(1, 1, 1, 3).setValues([['key', 'parts', 'data']])
    sh.setFrozenRows(1)
  }
  const last = sh.getLastRow()
  const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map((v) => String(v[0])) : []
  let next = Math.max(last, 1) + 1
  items.forEach((o) => {
    // '~' prefix keeps a chunk that starts with '=' or '+' from becoming a formula.
    const parts = []
    for (let i = 0; i < o.json.length; i += CELL_MAX) parts.push('~' + o.json.slice(i, i + CELL_MAX))
    const values = [o.key, parts.length].concat(parts)
    const idx = keys.indexOf(o.key)
    const rowNum = idx >= 0 ? idx + 2 : next++
    if (idx < 0) keys.push(o.key)
    ensureRows_(sh, rowNum)
    ensureCols_(sh, values.length)
    sh.getRange(rowNum, 1, 1, values.length).setValues([values])
  })
}

function readOverflow_(ss) {
  const map = Object.create(null)
  const sh = ss.getSheetByName(OVERFLOW_SHEET)
  if (!sh || sh.getLastRow() < 2) return map
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(3, sh.getLastColumn())).getValues()
  vals.forEach((v) => {
    const n = Number(v[1]) || 0
    let s = ''
    for (let i = 0; i < n; i++) s += String(v[2 + i] || '').slice(1)
    map[String(v[0])] = s
  })
  return map
}

// ---------------------------------------------------------------- LINE

function lineConfig_() {
  const props = PropertiesService.getScriptProperties()
  const token = String(props.getProperty('LINE_TOKEN') || '').trim()
  const to = String(props.getProperty('LINE_TO') || '')
    .split(/[\s,]+/)
    .filter((x) => x)
  return { ok: !!token && to.length > 0, token: token, to: to }
}

function line_(req) {
  const cfg = lineConfig_()
  if (!cfg.ok) return { ok: false, error: 'line_not_configured' }
  let text = String(req.text || '').trim()
  if (!text) return { ok: false, error: 'bad_request' }
  if (text.length > LINE_TEXT_MAX) text = text.slice(0, LINE_TEXT_MAX - 1) + '…'
  const retryKey = typeof req.retryKey === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.retryKey) ? req.retryKey : null
  for (let i = 0; i < cfg.to.length; i++) {
    const to = cfg.to[i]
    const headers = { Authorization: 'Bearer ' + cfg.token }
    // Same retry key = LINE sends it only once, so the app can safely resend after a timeout.
    if (retryKey) headers['X-Line-Retry-Key'] = cfg.to.length === 1 ? retryKey : deriveUuid_(retryKey + '|' + to)
    const resp = UrlFetchApp.fetch(LINE_PUSH_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true,
    })
    const code = resp.getResponseCode()
    if (code === 200 || code === 409) continue // 409 = already accepted with this retry key
    let detail = ''
    try {
      detail = String(JSON.parse(resp.getContentText()).message || '')
    } catch (err) {
      detail = String(resp.getContentText() || '').slice(0, 200)
    }
    const error = code === 401 || code === 403 ? 'line_auth' : code === 429 ? 'line_quota' : code === 400 ? 'line_bad_request' : 'line_failed'
    return { ok: false, error: error, detail: detail.slice(0, 300) }
  }
  return { ok: true }
}

function deriveUuid_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
  const hex = bytes.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('')
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-' + variant + hex.slice(17, 20) + '-' + hex.slice(20, 32)
}

// ---------------------------------------------------------------- sheets

function ss_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  if (!ss) throw new Error('Create this script from the Google Sheet (Extensions > Apps Script).')
  return ss
}

function widthOf_(table) {
  return META_HEADERS.length + TABLES[table].length
}

function headerOf_(table) {
  return META_HEADERS.concat(TABLES[table].map((c) => c.header))
}

/** Tab for a table, created and formatted on first use. */
function sheet_(ss, table) {
  let sh = ss.getSheetByName(table)
  if (!sh) {
    sh = ss.insertSheet(table)
    formatSheet_(sh, table)
  }
  ensureCols_(sh, widthOf_(table))
  return sh
}

function formatSheet_(sh, table) {
  const header = headerOf_(table)
  ensureCols_(sh, header.length)
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold')
  sh.setFrozenRows(1)
  sh.setColumnWidth(1, 90)
  for (let c = 2; c <= 5; c++) sh.setColumnWidth(c, 60)
  sh.setColumnWidth(COL_DATA, 90)
  applyFormats_(sh, table, 2, sh.getMaxRows() - 1)
}

/** Plain-text format stops Sheets from turning ids / dates / phone numbers into numbers or dates. */
function applyFormats_(sh, table, fromRow, numRows) {
  if (numRows < 1 || !TABLES[table]) return
  sh.getRange(fromRow, 1, numRows, 1).setNumberFormat('@')
  sh.getRange(fromRow, 2, numRows, 3).setNumberFormat('0')
  sh.getRange(fromRow, 5, numRows, 2).setNumberFormat('@')
  sh.getRange(fromRow, COL_DATA, numRows, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
  TABLES[table].forEach((c, i) => {
    const fmt = c.type === 'm' ? '#,##0.00' : c.type === 'i' ? '#,##0' : '@'
    sh.getRange(fromRow, COL_DATA + 1 + i, numRows, 1).setNumberFormat(fmt)
  })
}

/** Make sure the tab has at least this many rows; new rows get the table's formats. */
function ensureRows_(sh, lastRowNeeded) {
  const max = sh.getMaxRows()
  if (lastRowNeeded <= max) return
  const add = Math.max(lastRowNeeded - max, 500) // grow in steps so formatting runs rarely
  sh.insertRowsAfter(max, add)
  applyFormats_(sh, sh.getName(), max + 1, add)
}

function ensureCols_(sh, width) {
  const max = sh.getMaxColumns()
  if (width > max) sh.insertColumnsAfter(max, width - max)
}

/** Lazy id → name lookups for the readable columns (booth, staff and price-button names). */
function nameCtx_(ss) {
  const maps = Object.create(null)
  const load = (table) => {
    if (maps[table]) return maps[table]
    const m = Object.create(null)
    const sh = ss.getSheetByName(table)
    if (sh && sh.getLastRow() >= 2) {
      const vals = sh.getRange(2, 1, sh.getLastRow() - 1, COL_DATA).getValues()
      vals.forEach((v) => {
        try {
          const row = JSON.parse(String(v[COL_DATA - 1]))
          if (row && row.id) m[row.id] = labelOf_(table, row)
        } catch (err) {
          /* unreadable or oversized: leave the name blank */
        }
      })
    }
    maps[table] = m
    return m
  }
  return {
    booth: (id) => (id ? load('booths')[id] || '' : ''),
    staff: (id) => (id ? load('staff')[id] || '' : ''),
    tier: (id) => (id ? load('tiers')[id] || '' : ''),
    learn: (table, row) => {
      load(table)[row.id] = labelOf_(table, row)
    },
  }
}

function labelOf_(table, r) {
  if (table === 'tiers') return String(r.name || '') + ' ' + String(r.price === undefined || r.price === null ? '' : r.price)
  return String(r.name || '')
}

// ---------------------------------------------------------------- small helpers

function cellValue_(c, row, ctx) {
  let v
  try {
    v = c.get(row, ctx)
  } catch (err) {
    v = ''
  }
  if (v === null || v === undefined || v === '') return ''
  if (c.type === 't') return text_(v, 1000)
  const n = Number(v)
  return isFinite(n) ? n : ''
}

function text_(v, max) {
  let s = String(v === null || v === undefined ? '' : v)
  if (s.length > max) s = s.slice(0, max - 1) + '…'
  return /^[=+\-@]/.test(s) ? "'" + s : s
}

function activeLabel_(v) {
  return v === 0 ? 'ปิดใช้' : 'ใช้งาน'
}

/** Thailand is UTC+7 all year (no daylight saving). */
function timeHM_(ts) {
  const n = Number(ts)
  if (!isFinite(n) || n <= 0) return ''
  return new Date(n + 7 * 3600000).toISOString().slice(11, 16)
}

function itemsText_(items) {
  if (!Array.isArray(items)) return ''
  return items
    .map((it) => String((it && it.name) || '') + ' ' + String((it && it.price) || '') + ' x' + String((it && it.qty) || ''))
    .join(', ')
}

function newKey_() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '')
  let s = ''
  for (let i = 0; i < 20; i++) {
    if (i && i % 5 === 0) s += '-'
    s += abc.charAt(parseInt(hex.substr(i * 2, 2), 16) % abc.length)
  }
  return s
}
