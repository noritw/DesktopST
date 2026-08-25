import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as path from 'path'
import { app } from 'electron'
import { encrypt, decrypt } from '../secureStore'
import type { CalendarAuthResult, CalendarEvent, CalendarFetchOptions, CalendarProvider } from './types'

/**
 * Google Calendar provider（read-only）。
 *
 * 結構照抄 spotifyService.ts（PKCE、safeStorage 加密、自動 refresh），
 * 唯一的差異是回呼方式：
 *   Google 的「桌面應用程式」OAuth client 不接受自訂 URI scheme
 *   （`desktopst://` 那套只給 iOS／Android client），
 *   只允許 http://127.0.0.1:<port> 迴路位址。
 * 因此這裡自己起一個臨時 HTTP server 收 code，收完立刻關掉，
 * 不需要動 app.setAsDefaultProtocolClient 或 second-instance 分派。
 */

// ── PKCE helpers ──────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(64).toString('base64url').slice(0, 128)
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

// ── Auth file storage ─────────────────────────────────────

interface CalendarAuthFile {
  accessToken: string
  refreshToken: string
  tokenExpiresAt: number
}

function getAuthFilePath(): string {
  return path.join(app.getPath('userData'), 'calendar-auth.json')
}

function readAuthFile(): CalendarAuthFile | null {
  try {
    const p = getAuthFilePath()
    if (!fs.existsSync(p)) return null
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<CalendarAuthFile>
    const accessToken = decrypt(raw.accessToken ?? '')
    const refreshToken = decrypt(raw.refreshToken ?? '')
    if (!accessToken || !refreshToken) return null
    return { accessToken, refreshToken, tokenExpiresAt: raw.tokenExpiresAt ?? 0 }
  } catch { return null }
}

function writeAuthFile(data: CalendarAuthFile): void {
  fs.writeFileSync(getAuthFilePath(), JSON.stringify({
    accessToken: encrypt(data.accessToken),
    refreshToken: encrypt(data.refreshToken),
    tokenExpiresAt: data.tokenExpiresAt
  }, null, 2), 'utf-8')
}

export function clearCalendarAuthFile(): void {
  try { fs.unlinkSync(getAuthFilePath()) } catch { /* already gone */ }
}

export function isCalendarAuthenticated(): boolean {
  const auth = readAuthFile()
  return !!(auth?.accessToken && auth.refreshToken)
}

// ── OAuth 常數 ────────────────────────────────────────────

// 兩個範圍都是唯讀。Google 日曆畫面上的「工作」屬於 Tasks，是另一套 API，
// 只要 calendar.readonly 是讀不到的（實測：每天重複的「澆花」不會出現在 events 裡）。
const SCOPE = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks.readonly'
].join(' ')
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1'

/** 授權視窗開著卻遲遲沒回來時，自動收掉臨時 server */
const AUTH_TIMEOUT_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 8000

export interface GoogleCredentials {
  clientId: string
  /** Google 桌面應用程式 client 會一併發放，token 交換時需要一起送 */
  clientSecret?: string
}

// ── 授權流程（迴路位址回呼）─────────────────────────────────

let activeAuthServer: http.Server | null = null

function closeAuthServer(): void {
  if (activeAuthServer) {
    try { activeAuthServer.close() } catch { /* ignore */ }
    activeAuthServer = null
  }
}

const DONE_PAGE =
  '<!doctype html><meta charset="utf-8"><title>DeST</title>' +
  '<body style="font-family:sans-serif;background:#F7FFFC;color:#3D5A52;' +
  'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
  '<div style="text-align:center"><h2 style="font-weight:600">已完成授權</h2>' +
  '<p>可以關閉這個分頁，回到 DeST 了。</p></div>'

const FAIL_PAGE =
  '<!doctype html><meta charset="utf-8"><title>DeST</title>' +
  '<body style="font-family:sans-serif;background:#F7FFFC;color:#3D5A52;' +
  'display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
  '<div style="text-align:center"><h2 style="font-weight:600">授權未完成</h2>' +
  '<p>請回到 DeST 再試一次。</p></div>'

/**
 * 啟動 Google 授權：起臨時 server → 用 openUrl 開瀏覽器 → 等回呼 → 換 token。
 * 全程不 throw，失敗一律以 { ok: false, error } 回傳。
 */
export function beginGoogleAuth(
  creds: GoogleCredentials,
  openUrl: (url: string) => void
): Promise<CalendarAuthResult> {
  closeAuthServer()

  return new Promise<CalendarAuthResult>(resolve => {
    let settled = false
    const finish = (result: CalendarAuthResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      closeAuthServer()
      resolve(result)
    }

    const timer = setTimeout(() => {
      finish({ ok: false, error: '授權逾時，請重新連結' })
    }, AUTH_TIMEOUT_MS)

    const verifier = generateCodeVerifier()
    // 實際的 redirect_uri 要等系統配到 port 才知道，兩處（授權 URL／token 交換）共用同一個值
    let currentRedirectUri = ''

    const server = http.createServer((req, res) => {
      // 瀏覽器會順手要 favicon，不要當成回呼
      if (!req.url || req.url.startsWith('/favicon')) {
        res.writeHead(404); res.end(); return
      }
      const url = new URL(req.url, 'http://127.0.0.1')
      if (url.pathname !== '/calendar-callback') {
        res.writeHead(404); res.end(); return
      }
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(code && !error ? DONE_PAGE : FAIL_PAGE)

      if (error || !code) {
        finish({ ok: false, error: error ?? '未取得授權碼' })
        return
      }
      exchangeCode(creds, code, verifier, currentRedirectUri).then(finish)
    })

    server.on('error', e => {
      finish({ ok: false, error: `無法啟動本機授權接收埠：${String(e)}` })
    })

    // port 0 ＝ 由系統挑一個空閒埠，避免固定埠被佔用
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        finish({ ok: false, error: '無法取得本機授權接收埠' })
        return
      }
      currentRedirectUri = `http://127.0.0.1:${addr.port}/calendar-callback`
      const params = new URLSearchParams({
        client_id: creds.clientId,
        response_type: 'code',
        redirect_uri: currentRedirectUri,
        scope: SCOPE,
        code_challenge_method: 'S256',
        code_challenge: generateCodeChallenge(verifier),
        // 需要 refresh token 才能長期免登入；prompt=consent 確保重新授權時也會發
        access_type: 'offline',
        prompt: 'consent'
      })
      openUrl(`${AUTH_ENDPOINT}?${params}`)
    })

    activeAuthServer = server
  })
}

/** 使用者關掉設定視窗或改按其他鍵時，收掉還開著的臨時 server */
export function cancelGoogleAuth(): void {
  closeAuthServer()
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

async function exchangeCode(
  creds: GoogleCredentials,
  code: string,
  verifier: string,
  redirectUri: string
): Promise<CalendarAuthResult> {
  try {
    const body = new URLSearchParams({
      client_id: creds.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
    // 桌面應用程式 client 的 token 交換仍要求帶 secret（Google 規定，非機密用途）
    if (creds.clientSecret) body.set('client_secret', creds.clientSecret)

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    if (!res.ok) {
      const text = await res.text()
      return { ok: false, error: `Google 授權失敗：${text.slice(0, 300)}` }
    }
    const data = await res.json() as TokenResponse
    if (!data.refresh_token) {
      return { ok: false, error: 'Google 未發出 refresh token，請至帳戶「第三方應用程式」移除 DeST 後重新授權' }
    }
    writeAuthFile({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: Date.now() + data.expires_in * 1000
    })
    const displayName = await fetchAccountName(data.access_token)
    return { ok: true, displayName: displayName ?? undefined }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

async function fetchAccountName(accessToken: string): Promise<string | null> {
  const data = await apiGet<{ id?: string; summary?: string }>(
    `${CALENDAR_API}/calendars/primary`, accessToken
  )
  return data?.id ?? data?.summary ?? null
}

/**
 * 中斷授權：先刪本機憑證（同步、必定成功），再通知 Google 撤銷。
 * 撤銷失敗或逾時都不影響「已斷線」這個事實，呼叫端不需要等它。
 */
export async function revokeGoogleAuth(): Promise<void> {
  const auth = readAuthFile()
  clearCalendarAuthFile()
  if (!auth?.refreshToken) return

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: auth.refreshToken }),
      signal: controller.signal
    })
  } catch {
    /* 本機已清掉，撤銷失敗不影響使用 */
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── Token refresh ─────────────────────────────────────────

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000

async function refreshTokens(creds: GoogleCredentials, refreshToken: string): Promise<boolean> {
  try {
    const body = new URLSearchParams({
      client_id: creds.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
    if (creds.clientSecret) body.set('client_secret', creds.clientSecret)

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    if (!res.ok) return false
    const data = await res.json() as TokenResponse
    const existing = readAuthFile()
    writeAuthFile({
      accessToken: data.access_token,
      // refresh token 在 refresh 回應中通常不會重發，沿用舊的
      refreshToken: data.refresh_token ?? existing?.refreshToken ?? '',
      tokenExpiresAt: Date.now() + data.expires_in * 1000
    })
    return true
  } catch { return false }
}

async function ensureValidToken(creds: GoogleCredentials): Promise<string | null> {
  const auth = readAuthFile()
  if (!auth) return null
  if (Date.now() > auth.tokenExpiresAt - REFRESH_THRESHOLD_MS) {
    if (!auth.refreshToken) return null
    const ok = await refreshTokens(creds, auth.refreshToken)
    if (!ok) return null
    return readAuthFile()?.accessToken ?? null
  }
  return auth.accessToken
}

// ── Calendar API ──────────────────────────────────────────

async function apiGet<T>(url: string, accessToken: string): Promise<T | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    })
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

interface GoogleReminders {
  useDefault?: boolean
  overrides?: Array<{ method?: string; minutes?: number }>
}

interface GoogleEventsResponse {
  items?: Array<{
    id: string
    summary?: string
    location?: string
    status?: string
    start?: { dateTime?: string; date?: string }
    end?: { dateTime?: string; date?: string }
    reminders?: GoogleReminders
  }>
}

function parseGoogleTime(t: { dateTime?: string; date?: string } | undefined): { ms: number; allDay: boolean } | null {
  if (!t) return null
  if (t.dateTime) {
    const ms = Date.parse(t.dateTime)
    return Number.isNaN(ms) ? null : { ms, allDay: false }
  }
  if (t.date) {
    // 全天行程回傳 YYYY-MM-DD，視為本機時區當天 00:00
    const [y, m, d] = t.date.split('-').map(Number)
    if (!y || !m || !d) return null
    return { ms: new Date(y, m - 1, d).getTime(), allDay: true }
  }
  return null
}

// ── Tasks API ─────────────────────────────────────────────

interface TaskListsResponse {
  items?: Array<{ id: string; title?: string }>
}

interface TasksResponse {
  items?: Array<{
    id: string
    title?: string
    status?: string
    due?: string
    deleted?: boolean
    hidden?: boolean
  }>
}

function startOfDayMs(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 抓取所有工作清單裡、到期日落在區間內的未完成待辦。
 *
 * 注意 Google Tasks 的 due 只保留日期、時間一律被截掉（都是當日 00:00Z），
 * 所以這裡：
 *   - dueMin 用「今天凌晨」而不是「現在」，否則今天的待辦會被整批濾掉
 *   - 回傳的 CalendarEvent 標成 allDay，呈現層不要顯示時刻（會是錯的）
 */
async function fetchTasks(
  accessToken: string,
  fromMs: number,
  toMs: number,
  max: number
): Promise<CalendarEvent[]> {
  const lists = await apiGet<TaskListsResponse>(`${TASKS_API}/users/@me/lists`, accessToken)
  if (!lists?.items?.length) return []

  const dueMin = new Date(startOfDayMs(fromMs)).toISOString()
  const dueMax = new Date(toMs).toISOString()
  const out: CalendarEvent[] = []

  for (const list of lists.items) {
    const params = new URLSearchParams({
      dueMin,
      dueMax,
      showCompleted: 'false',
      showDeleted: 'false',
      showHidden: 'false',
      maxResults: String(Math.max(1, Math.min(max, 100)))
    })
    const data = await apiGet<TasksResponse>(
      `${TASKS_API}/lists/${encodeURIComponent(list.id)}/tasks?${params}`, accessToken
    )
    if (!data?.items) continue

    for (const t of data.items) {
      if (t.deleted || t.hidden || t.status === 'completed' || !t.due) continue
      const dueMs = Date.parse(t.due)
      if (Number.isNaN(dueMs)) continue
      // due 是 UTC 午夜，直接用會在 UTC+8 變成前一天早上 8 點 → 取其日期部分當本機當天
      const utc = new Date(dueMs)
      const localDay = new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()).getTime()
      if (localDay < startOfDayMs(fromMs) || localDay > toMs) continue
      out.push({
        id: `task:${t.id}`,
        title: t.title?.trim() || '（無標題）',
        start: localDay,
        end: localDay,
        allDay: true,
        kind: 'task'
      })
    }
  }
  return out
}

// ── 日曆預設提醒（`reminders.useDefault === true` 時使用）─────
// 同一顆日曆的預設提醒設定不常變，快取起來，不用每個事件各打一次。

const DEFAULT_REMINDERS_CACHE_TTL = 10 * 60 * 1000
let defaultRemindersCache: { calendarId: string; minutes: number[]; fetchedAt: number } | null = null

async function fetchDefaultReminderMinutes(accessToken: string, calendarId: string): Promise<number[]> {
  if (
    defaultRemindersCache &&
    defaultRemindersCache.calendarId === calendarId &&
    Date.now() - defaultRemindersCache.fetchedAt < DEFAULT_REMINDERS_CACHE_TTL
  ) {
    return defaultRemindersCache.minutes
  }
  const data = await apiGet<{ defaultReminders?: Array<{ method?: string; minutes?: number }> }>(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`, accessToken
  )
  const minutes = (data?.defaultReminders ?? [])
    .map(r => r.minutes)
    .filter((m): m is number => typeof m === 'number')
  defaultRemindersCache = { calendarId, minutes, fetchedAt: Date.now() }
  return minutes
}

/** §5 掃描器用的中介資料：事件本身 + 這個事件實際會用到的提醒分鐘數（已展開日曆預設值） */
export interface CalendarEventWithReminders extends CalendarEvent {
  reminderMinutes: number[]
}

/**
 * 給日曆驅動提醒掃描器用：抓事件並展開每個事件實際的提醒分鐘數。
 * 跟 `CalendarProvider.listUpcoming()` 是平行的兩條路徑，不共用同一個型別
 * ——`CalendarEvent` 是給「顯示行程摘要」用的既有型別，不塞 reminders 資料進去。
 * 只回傳一般行程（`kind: 'event'`），不含 Google Tasks（待辦沒有 reminders 概念）。
 */
export async function listUpcomingWithReminders(
  creds: GoogleCredentials,
  opts: CalendarFetchOptions
): Promise<CalendarEventWithReminders[] | null> {
  try {
    if (!creds.clientId) return null
    const accessToken = await ensureValidToken(creds)
    if (!accessToken) return null

    const params = new URLSearchParams({
      timeMin: new Date(opts.fromMs).toISOString(),
      timeMax: new Date(opts.toMs).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(Math.max(1, Math.min(opts.max, 250)))
    })
    const data = await apiGet<GoogleEventsResponse>(
      `${CALENDAR_API}/calendars/primary/events?${params}`, accessToken
    )
    if (!data?.items) return null

    const out: CalendarEventWithReminders[] = []
    for (const item of data.items) {
      if (item.status === 'cancelled') continue
      const start = parseGoogleTime(item.start)
      if (!start) continue
      const end = parseGoogleTime(item.end)

      let minutes: number[]
      if (item.reminders?.useDefault || !item.reminders) {
        minutes = await fetchDefaultReminderMinutes(accessToken, 'primary')
      } else {
        minutes = (item.reminders.overrides ?? [])
          .map(o => o.minutes)
          .filter((m): m is number => typeof m === 'number')
      }
      if (minutes.length === 0) continue

      out.push({
        id: item.id,
        title: item.summary?.trim() || '（無標題）',
        start: start.ms,
        end: end?.ms ?? start.ms,
        allDay: start.allDay,
        location: item.location?.trim() || undefined,
        kind: 'event',
        reminderMinutes: minutes
      })
    }
    return out
  } catch {
    return null
  }
}

export function createGoogleCalendarProvider(creds: GoogleCredentials): CalendarProvider {
  return {
    id: 'google',

    isAuthenticated: isCalendarAuthenticated,

    async listUpcoming(opts: CalendarFetchOptions): Promise<CalendarEvent[] | null> {
      try {
        if (!creds.clientId) return null
        const accessToken = await ensureValidToken(creds)
        if (!accessToken) return null

        const params = new URLSearchParams({
          timeMin: new Date(opts.fromMs).toISOString(),
          timeMax: new Date(opts.toMs).toISOString(),
          singleEvents: 'true',          // 展開重複行程，取得實際發生時間
          orderBy: 'startTime',
          maxResults: String(Math.max(1, Math.min(opts.max, 50)))
        })
        const data = await apiGet<GoogleEventsResponse>(
          `${CALENDAR_API}/calendars/primary/events?${params}`, accessToken
        )
        // 行程抓不到就視為整體失敗；工作抓不到只是少一部分，不影響行程
        if (!data?.items) return null

        const merged: CalendarEvent[] = []
        for (const item of data.items) {
          if (item.status === 'cancelled') continue
          const start = parseGoogleTime(item.start)
          if (!start) continue
          const end = parseGoogleTime(item.end)
          merged.push({
            id: item.id,
            title: item.summary?.trim() || '（無標題）',
            start: start.ms,
            end: end?.ms ?? start.ms,
            allDay: start.allDay,
            location: item.location?.trim() || undefined,
            kind: 'event'
          })
        }

        try {
          merged.push(...await fetchTasks(accessToken, opts.fromMs, opts.toMs, opts.max))
        } catch { /* 工作讀取失敗（未啟用 Tasks API 等）不影響行程 */ }

        // 行程與工作混排後依時間排序，再套用筆數上限
        merged.sort((a, b) => a.start - b.start)
        return merged.slice(0, opts.max)
      } catch {
        return null
      }
    }
  }
}
