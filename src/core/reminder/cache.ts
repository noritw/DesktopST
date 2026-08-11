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
 * 兩個條件任一成立就要：快取不存在／過期，或者對話在上次生成之後又更新過。
 */
export function needsRefresh(
  entry: ReminderCacheEntry | undefined,
  conversationUpdatedAt: number | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!isCacheUsable(entry, nowMs)) return true
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
