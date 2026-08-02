import type { AppSettings, CalendarSettings } from '../types'
import { decrypt } from '../secureStore'
import { createGoogleCalendarProvider, isCalendarAuthenticated } from './googleProvider'
import type { CalendarEvent, CalendarProvider } from './types'

export type { CalendarEvent, CalendarProvider } from './types'
export {
  beginGoogleAuth, cancelGoogleAuth, revokeGoogleAuth,
  clearCalendarAuthFile, isCalendarAuthenticated
} from './googleProvider'

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  enabled: false,
  clientId: '',
  lookaheadHours: 24,
  maxEvents: 5,
  mentionWhenEmpty: false
}

/** clientSecret 以加密字串存放，用之前要解密（比照 weather 的 cwaApiKey） */
export function readClientSecret(c: CalendarSettings | undefined): string {
  const raw = c?.clientSecret
  if (!raw) return ''
  const plain = decrypt(raw)
  // safeStorage 不可用時 decrypt 會原樣回傳，過濾掉還帶前綴的異常值
  return plain.startsWith('enc:v1:') ? '' : plain
}

/**
 * 依設定挑一個 provider。目前只有 Google，
 * 日後新增服務商（或手機版換一套取得方式）只要在這裡多一個分支。
 */
function resolveProvider(settings: AppSettings): CalendarProvider | null {
  const c = settings.calendar
  if (!c?.clientId) return null
  return createGoogleCalendarProvider({
    clientId: c.clientId,
    clientSecret: readClientSecret(c)
  })
}

// ── 快取（記憶體，重啟即清）──────────────────────────────
// 每則訊息都打一次 API 太浪費，且行程本來就不會分鐘級變動。

const CACHE_TTL = 10 * 60 * 1000

let cache: { key: string; text: string | null; fetchedAt: number } | null = null

export function invalidateCalendarCache(): void {
  cache = null
}

// ── 格式化 ────────────────────────────────────────────────

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 相對日期標籤：今天 / 明天 / 後天 / M月D日 */
function dayLabel(eventMs: number, nowMs: number): string {
  const diffDays = Math.round((startOfDay(eventMs) - startOfDay(nowMs)) / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '明天'
  if (diffDays === 2) return '後天'
  const d = new Date(eventMs)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatEvent(ev: CalendarEvent, nowMs: number): string {
  const day = dayLabel(ev.start, nowMs)

  // 待辦只有到期日、沒有可靠的時刻，硬印時間會是錯的
  if (ev.kind === 'task') {
    return `${day} ${ev.title}（待辦）`
  }

  const when = ev.allDay
    ? `${day}（整天）`
    : ev.end > ev.start
      ? `${day} ${hhmm(ev.start)}–${hhmm(ev.end)}`
      : `${day} ${hhmm(ev.start)}`
  const place = ev.location ? `（${ev.location}）` : ''
  return `${when} ${ev.title}${place}`
}

/**
 * 標籤下方一定要有一句說明這是什麼。
 * 實測只給裸標籤 `[Calendar]` 時，角色容易把它當成無意義字串略過，
 * 被直接問「你讀得到日曆嗎」還會否認。
 */
const CALENDAR_HEADER = '[Calendar]\n這是使用者本人的行程與待辦，已確實取得，可以自然提起。'

export function buildCalendarBlock(events: CalendarEvent[], nowMs: number, lookaheadHours: number): string {
  if (events.length === 0) {
    return `${CALENDAR_HEADER}\n接下來 ${lookaheadHours} 小時內沒有安排。`
  }
  const lines = events.map(ev => formatEvent(ev, nowMs))
  return `${CALENDAR_HEADER}\n${lines.join('\n')}`
}

// ── 對外：取得注入字串 ─────────────────────────────────────

/** Log 視窗 debug 面板用：不花 token 就能看到實際抓到什麼 */
export interface CalendarPeekResult {
  /** 有沒有填 Client ID */
  configured: boolean
  authenticated: boolean
  /** 模組開關（已套用情境覆蓋） */
  enabled: boolean
  lookaheadHours: number
  events: CalendarEvent[] | null
  /** 實際會被注入 prompt 的字串；null ＝ 這次不注入 */
  injectionText: string | null
  fetchedAt: number
  error?: string
}

/**
 * 略過快取直接抓一次，回報完整診斷。
 * 只供 UI 檢視，不影響聊天流程也不寫入快取。
 */
export async function peekCalendar(settings: AppSettings): Promise<CalendarPeekResult> {
  const c = settings.calendar
  const lookaheadHours = c?.lookaheadHours && c.lookaheadHours > 0
    ? c.lookaheadHours
    : DEFAULT_CALENDAR_SETTINGS.lookaheadHours
  const base: CalendarPeekResult = {
    configured: !!c?.clientId,
    authenticated: isCalendarAuthenticated(),
    enabled: !!c?.enabled,
    lookaheadHours,
    events: null,
    injectionText: null,
    fetchedAt: Date.now()
  }
  if (!base.configured) return { ...base, error: '尚未填入 Client ID' }
  if (!base.authenticated) return { ...base, error: '尚未完成授權' }

  try {
    const provider = resolveProvider(settings)
    if (!provider) return { ...base, error: '無法建立連線設定' }
    const now = Date.now()
    const maxEvents = c?.maxEvents && c.maxEvents > 0 ? c.maxEvents : DEFAULT_CALENDAR_SETTINGS.maxEvents
    const events = await provider.listUpcoming({
      fromMs: now,
      toMs: now + lookaheadHours * 3600_000,
      max: maxEvents
    })
    if (!events) return { ...base, error: '讀取失敗（可能離線、授權過期或 API 未啟用）' }

    const injectionText = (events.length === 0 && !c?.mentionWhenEmpty)
      ? null
      : buildCalendarBlock(events, now, lookaheadHours)
    return { ...base, events, injectionText, fetchedAt: now }
  } catch (e) {
    return { ...base, error: String(e) }
  }
}

/**
 * 取得日曆注入字串（附 10 分鐘快取）。
 *
 * 未啟用／未設定 Client ID／未授權／token 換不到／網路失敗，
 * 一律靜默回傳 null —— 聊天流程絕不能因為日曆而中斷。
 */
export async function getCalendarContextString(settings: AppSettings): Promise<string | null> {
  const c = settings.calendar
  if (!c?.enabled || !c.clientId) return null
  if (!isCalendarAuthenticated()) return null

  const lookaheadHours = c.lookaheadHours > 0 ? c.lookaheadHours : DEFAULT_CALENDAR_SETTINGS.lookaheadHours
  const maxEvents = c.maxEvents > 0 ? c.maxEvents : DEFAULT_CALENDAR_SETTINGS.maxEvents
  const now = Date.now()

  // 快取鍵含區間設定，設定一改就重抓
  const key = `${c.clientId}|${lookaheadHours}|${maxEvents}|${c.mentionWhenEmpty}`
  if (cache && cache.key === key && now - cache.fetchedAt < CACHE_TTL) {
    return cache.text
  }

  try {
    const provider = resolveProvider(settings)
    if (!provider) return null

    const events = await provider.listUpcoming({
      fromMs: now,
      toMs: now + lookaheadHours * 3600_000,
      max: maxEvents
    })
    // null ＝ 抓取失敗（未授權／離線）→ 不快取，下次再試
    if (!events) return null

    const text = (events.length === 0 && !c.mentionWhenEmpty)
      ? null
      : buildCalendarBlock(events, now, lookaheadHours)

    cache = { key, text, fetchedAt: now }
    return text
  } catch (e) {
    console.warn('[calendar] context build failed:', (e as Error).message)
    return null
  }
}
