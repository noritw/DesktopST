import type { ReminderHistoryStatus } from '../types'

/**
 * 「最近一次生成的台詞」快取（純邏輯）。
 *
 * 用途只有一個：**現場生成失敗時的底線**（見
 * `docs/mobile-standalone-reminder-plan.md` §2.1）。主線永遠是到點現場生成。
 *
 * 為什麼不是「建立提醒時就先生好」：owner 的實際用法是先設提醒、之後才
 * 大量跟角色互動、最後才離開 App。建立當下生成的話，那段互動完全不會
 * 反映在台詞裡。所以快取的刷新時機是**離開前景時**與**對話閒置時**，
 * 不是建立時。
 */

export interface ReminderCacheEntry {
  reminderId: string
  characterId: string
  characterName: string
  text: string
  /** 生成當下的時間；太舊的快取寧可不用（見 `isCacheUsable`） */
  generatedAt: number
  /**
   * 生成時所依據的對話最後更新時間。
   * 對話沒動過就不必重新生成——這是省 Token 的主要手段。
   */
  basedOnConversationUpdatedAt?: number
  /**
   * 生成時那則提醒的內容指紋（見 `reminderFingerprint`）。
   *
   * ⚠️ 少了這個欄位，改提醒內容之後快取不會重生：
   * owner 2026-08-11 把提醒改成「再檢查一下功能」，跳出來的還是舊的「洗杯子」，
   * 一字不差——因為當時只比對「對話有沒有更新」，完全沒看提醒本身變了沒。
   */
  fingerprint?: string
}

/**
 * 提醒的內容指紋。
 *
 * 只放**會影響台詞內容**的欄位。排程時間不算——把時間放進來的話，
 * 每次算完下一輪都會被判定成「變了」而重生一次，白燒 Token。
 */
export function reminderFingerprint(r: {
  label: string
  prompt: string
  characterId?: string
  sceneId?: string
  conversationId?: string
  injectWeather?: boolean
  injectConversationContext?: boolean
}): string {
  // 用 JSON 而不是自訂分隔字元：不會有「看不見的控制字元被編輯器吃掉」的風險
  return JSON.stringify([
    r.label,
    r.prompt,
    r.characterId ?? '',
    r.sceneId ?? '',
    r.conversationId ?? '',
    !!r.injectWeather,
    !!r.injectConversationContext
  ])
}

export type ReminderCache = Record<string, ReminderCacheEntry>

/**
 * 快取的保鮮期。超過就不用了——
 * 三天前的一句「早安」現在拿出來講，比不講還糟。
 */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function isCacheUsable(
  entry: ReminderCacheEntry | undefined,
  nowMs: number = Date.now()
): entry is ReminderCacheEntry {
  if (!entry?.text?.trim()) return false
  return nowMs - entry.generatedAt <= CACHE_MAX_AGE_MS
}

/**
 * 這則提醒的快取需不需要重新生成。
 *
 * 三個條件任一成立就要：快取不存在／過期、**提醒內容被改過**、
 * 或者對話在上次生成之後又更新過。
 */
export function needsRefresh(
  entry: ReminderCacheEntry | undefined,
  conversationUpdatedAt: number | undefined,
  nowMs: number = Date.now(),
  fingerprint?: string
): boolean {
  if (!isCacheUsable(entry, nowMs)) return true
  // 提醒本身被改過（換了指令／角色／綁定）→ 舊台詞講的是別件事，一定要重生
  if (fingerprint != null && entry.fingerprint !== fingerprint) return true
  if (conversationUpdatedAt == null) return false
  return (entry.basedOnConversationUpdatedAt ?? 0) < conversationUpdatedAt
}

export function normalizeCache(raw: unknown): ReminderCache {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ReminderCache = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const e = v as ReminderCacheEntry
    if (e && typeof e === 'object' && typeof e.text === 'string' && typeof e.generatedAt === 'number') {
      out[k] = e
    }
  }
  return out
}

/** 提醒被刪掉時，對應快取也該走——不然它會一直躺在檔案裡。 */
export function pruneCache(cache: ReminderCache, liveReminderIds: string[]): ReminderCache {
  const live = new Set(liveReminderIds)
  const out: ReminderCache = {}
  for (const [k, v] of Object.entries(cache)) {
    if (live.has(k)) out[k] = v
  }
  return out
}

/** 現場生成失敗、且允許 fallback 時，用快取還是安靜略過。 */
export function fallbackStatusFor(hasUsableCache: boolean, allowFallback: boolean): ReminderHistoryStatus {
  if (!allowFallback) return 'skipped_offline'
  return hasUsableCache ? 'offline_fallback' : 'skipped_offline'
}
