// Thai messages for sync and LINE results.
import { type SyncCallError } from './transport'

export const MSG = {
  connected: 'เชื่อมต่อสำเร็จ',
  wrongKey: 'รหัสไม่ถูกต้อง',
  cannotConnect: 'เชื่อมต่อไม่ได้ ตรวจลิงก์และอินเทอร์เน็ต',
  offline: 'ไม่มีอินเทอร์เน็ต จะซิงก์ให้เมื่อกลับมาออนไลน์',
  timeout: 'เซิร์ฟเวอร์ตอบช้า จะลองใหม่อีกครั้ง',
  needUrl: 'ใส่ลิงก์ Apps Script ก่อน',
  badUrl: 'ลิงก์ไม่ถูกต้อง ต้องขึ้นต้นด้วย https://',
  devUrl: 'ใช้ลิงก์ที่ลงท้ายด้วย /exec (ไม่ใช่ /dev)',
  needKey: 'ใส่รหัสซิงก์ก่อน',
  notWebApp: 'ลิงก์ไม่ถูกต้อง ใช้ลิงก์ /exec และตั้งให้ "ทุกคน" เข้าถึงได้',
  keyMissingOnServer: 'ยังไม่ได้ตั้ง SYNC_KEY ใน Apps Script',
  busy: 'ระบบซิงก์ไม่ว่าง จะลองใหม่อีกครั้ง',
  oldScript: 'โค้ด Apps Script ไม่ตรงรุ่น วาง Code.gs ใหม่แล้วทำให้ใช้งานได้อีกครั้ง',
  serverError: 'เซิร์ฟเวอร์ขัดข้อง จะลองใหม่อีกครั้ง',
  googleBusy: 'เซิร์ฟเวอร์ Google ไม่ว่าง จะลองใหม่อีกครั้ง',
  notFound: 'ไม่พบลิงก์นี้ ตรวจลิงก์อีกครั้ง',
  syncOff: 'ยังไม่ได้ตั้งค่าการซิงก์',
  clockOff: 'เวลาในเครื่องไม่ตรง ตั้งวันเวลาให้ถูกต้อง',
  noShopYet: 'ยังไม่มีข้อมูลร้าน',
  lineSent: 'ส่ง LINE แล้ว',
  lineEmpty: 'ไม่มีข้อความให้ส่ง',
  lineNeedsSync: 'ยังไม่ได้ตั้งค่าการซิงก์และ LINE ใช้ปุ่มแชร์ LINE แทน',
  lineQueued: 'ยังไม่มีอินเทอร์เน็ต จะส่ง LINE ให้เองเมื่อกลับมาออนไลน์',
  lineRetry: 'ส่ง LINE ยังไม่สำเร็จ จะลองส่งให้เองอีกครั้ง',
  lineNotConfigured: 'ยังไม่ได้ตั้งค่า LINE ใน Apps Script',
  lineAuth: 'LINE_TOKEN ไม่ถูกต้องหรือหมดอายุ',
  lineQuota: 'ส่ง LINE ครบโควตาของเดือนนี้แล้ว',
  lineBadRequest: 'ส่ง LINE ไม่สำเร็จ ตรวจ LINE_TO และเพิ่ม LINE OA เป็นเพื่อนก่อน',
  lineFailed: 'LINE ขัดข้อง ส่งไม่สำเร็จ',
} as const

/** Message for a failed sync / ping call. */
export function callErrorMessage(e: SyncCallError): string {
  switch (e.kind) {
    case 'network':
      return MSG.cannotConnect
    case 'timeout':
      return MSG.timeout
    case 'invalid':
      return MSG.notWebApp
    case 'http':
      if (e.status === 404) return MSG.notFound
      if (e.status === 401 || e.status === 403) return MSG.notWebApp
      if (e.status === 429 || (e.status !== null && e.status >= 500)) return MSG.googleBusy
      return MSG.cannotConnect
    case 'server':
      switch (e.code) {
        case 'unauthorized':
          return MSG.wrongKey
        case 'server_key_missing':
          return MSG.keyMissingOnServer
        case 'busy':
          return MSG.busy
        case 'unknown_action':
        case 'bad_request':
        case 'too_many_rows':
          return MSG.oldScript
        default:
          return MSG.serverError
      }
  }
}

/** Message for a failed LINE send. */
export function lineErrorMessage(e: SyncCallError): string {
  if (e.kind === 'server') {
    switch (e.code) {
      case 'line_not_configured':
        return MSG.lineNotConfigured
      case 'line_auth':
        return MSG.lineAuth
      case 'line_quota':
        return MSG.lineQuota
      case 'line_bad_request':
        return MSG.lineBadRequest
      case 'line_failed':
        return MSG.lineFailed
    }
  }
  return callErrorMessage(e)
}

/** Server-side hiccups worth retrying (Google busy, script lock busy, script error). */
export function isTransientError(e: SyncCallError): boolean {
  if (e.kind === 'http') return e.status === 429 || (e.status !== null && e.status >= 500)
  return e.kind === 'server' && ['busy', 'server_error', 'line_failed'].includes(e.code)
}

/** LINE errors that will not fix themselves by retrying later. */
export function isPermanentLineError(e: SyncCallError): boolean {
  if (e.kind !== 'server') return e.kind === 'invalid' || (e.kind === 'http' && e.status === 404)
  return ['line_not_configured', 'line_auth', 'line_quota', 'line_bad_request', 'unauthorized', 'server_key_missing', 'unknown_action', 'bad_request'].includes(e.code)
}
