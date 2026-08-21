import type { Reminder, ReminderHistoryItem, ReminderHistoryStatus } from '../types'

/**
 * 提醒通知歷史紀錄的純邏輯（新增／上限修剪／刪除）。
 * 實際存檔由呼叫端負責（獨立版走 `adapters.storage`，key 見 `core/store/keys.ts`）。
 *
 * 為什麼要留歷史：提醒是「背景發生的事」，使用者常常是看到通知欄一閃而過，
 * 或者根本沒看到（螢幕暗著、被手錶轉走）。沒有歷史的話「它到底有沒有響」
 * 完全無從查起，連 owner 自己除錯都得去翻 logcat。
 */

/** 最多保留幾筆。超過就丟最舊的——這是紀錄不是資料，不值得無限長。 */
export const REMINDER_HISTORY_LIMIT = 100

/**
 * 錯誤訊息的長度上限。
 *
 * SDK 的例外訊息可能**整包 API 回應都塞在裡面**（實測有 4KB 以上，
 * 連 reasoning 的加密內容都在）。原樣存進去會把 `reminder-history.json`
 * 撐爆，畫面也只會看到一大片亂碼。前 200 字就足以認出是哪種錯。
 */
export const ERROR_MESSAGE_LIMIT = 200

function truncateError(msg: string | undefined): string | undefined {
  if (!msg) return undefined
  const flat = msg.replace(/\s+/g, ' ').trim()
  return flat.length <= ERROR_MESSAGE_LIMIT ? flat : `${flat.slice(0, ERROR_MESSAGE_LIMIT)}…`
}

export interface ReminderHistoryDraft {
  status: ReminderHistoryStatus
  /** 實際發出去的台詞；略過類的狀態留空字串 */
  text?: string
  characterId?: string
  characterName?: string
  characterAvatar?: string
  errorMessage?: string
}

/**
 * 產生一筆歷史紀錄。
 *
 * `reminderLabel` 是**觸發當下的快照**：提醒之後被改名或刪掉，
 * 歷史仍要讀得懂當時響的是哪一則。
 */
export function buildHistoryItem(
  reminder: Reminder,
  draft: ReminderHistoryDraft,
  id: string,
  now: number = Date.now()
): ReminderHistoryItem {
  return {
    id,
    reminderId: reminder.id,
    reminderLabel: reminder.label || '提醒',
    characterId: draft.characterId,
    characterName: draft.characterName,
    characterAvatar: draft.characterAvatar,
    text: draft.text ?? '',
    status: draft.status,
    timestamp: now,
    errorMessage: truncateError(draft.errorMessage)
  }
}

/** 新的排在最前面（UI 由新到舊列），並套用上限。 */
export function appendHistory(
  list: ReminderHistoryItem[],
  item: ReminderHistoryItem,
  limit: number = REMINDER_HISTORY_LIMIT
): ReminderHistoryItem[] {
  return [item, ...list].slice(0, limit)
}

export function removeHistoryItem(list: ReminderHistoryItem[], id: string): ReminderHistoryItem[] {
  return list.filter((h) => h.id !== id)
}

/** 讀進來的東西不一定是陣列（檔案壞掉／舊格式），統一過濾成合法紀錄。 */
export function normalizeHistory(raw: unknown): ReminderHistoryItem[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (h): h is ReminderHistoryItem =>
      !!h && typeof h === 'object' && typeof (h as ReminderHistoryItem).id === 'string'
  )
}
