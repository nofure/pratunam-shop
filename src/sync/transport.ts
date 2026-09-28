// One request to the Apps Script web app.
// text/plain body = a "simple" CORS request, so the browser sends no preflight (Apps Script can't answer one).

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>

export type CallErrorKind =
  | 'network' // no connection / DNS / CORS failure
  | 'timeout'
  | 'http' // non-2xx status
  | 'invalid' // 2xx but not our JSON (login page, wrong URL, old deployment)
  | 'server' // our JSON with ok: false

export class SyncCallError extends Error {
  readonly kind: CallErrorKind
  readonly code: string
  readonly status: number | null
  readonly detail: string | null

  constructor(kind: CallErrorKind, code: string, status: number | null = null, detail: string | null = null) {
    super(`${kind}:${code}${detail ? ` (${detail})` : ''}`)
    this.name = 'SyncCallError'
    this.kind = kind
    this.code = code
    this.status = status
    this.detail = detail
  }
}

export function asCallError(e: unknown): SyncCallError {
  if (e instanceof SyncCallError) return e
  return new SyncCallError('network', 'exception', null, e instanceof Error ? e.message : String(e))
}

/** true for failures that mean "no usable connection right now" (retry later, show offline). */
export function isConnectivityError(e: SyncCallError): boolean {
  return e.kind === 'network' || e.kind === 'timeout'
}

export interface BackendResponse {
  ok: true
  [key: string]: unknown
}

export async function callBackend(
  fetchFn: FetchFn,
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<BackendResponse> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl?.abort()
  }, timeoutMs)
  try {
    let res: Response
    try {
      res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctrl?.signal,
      })
    } catch (e) {
      throw new SyncCallError(timedOut ? 'timeout' : 'network', timedOut ? 'timeout' : 'fetch_failed', null, errText(e))
    }
    if (!res.ok) throw new SyncCallError('http', `http_${res.status}`, res.status)
    let text: string
    try {
      text = await res.text()
    } catch (e) {
      throw new SyncCallError(timedOut ? 'timeout' : 'network', timedOut ? 'timeout' : 'read_failed', null, errText(e))
    }
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new SyncCallError('invalid', 'not_json', res.status, text.slice(0, 120))
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new SyncCallError('invalid', 'not_object', res.status)
    const obj = data as Record<string, unknown>
    if (obj.ok !== true) {
      throw new SyncCallError(
        'server',
        typeof obj.error === 'string' && obj.error ? obj.error : 'unknown',
        res.status,
        typeof obj.detail === 'string' ? obj.detail : null,
      )
    }
    return obj as BackendResponse
  } finally {
    clearTimeout(timer)
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Loose check that the owner pasted a web URL (not a script ID or a sheet link). */
export function checkSyncUrl(url: string): 'ok' | 'empty' | 'not_url' | 'dev_url' {
  const u = url.trim()
  if (!u) return 'empty'
  let parsed: URL
  try {
    parsed = new URL(u)
  } catch {
    return 'not_url'
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'not_url'
  if (/\/dev\/?$/.test(parsed.pathname)) return 'dev_url'
  return 'ok'
}
