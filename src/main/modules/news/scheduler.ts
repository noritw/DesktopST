/**
 * scheduler.ts
 * 定時新聞陪聊：在 reminders 檔裡維護一條固定的特殊 Reminder，排程器自動吃到。
 *
 * 組出 Reminder 長什麼樣子的純函式搬到 `core/news/schedule.ts`（B1 抽 core，步驟⑤）；
 * 這裡只負責桌面平台特有的部分：讀寫 `reminders.json`、重新註冊桌面排程器。
 *
 * 桌面設定面板走 ipc.ts 的 `news:get-scheduler` / `news:sync-scheduler`，
 * 手機遙控走 mobileRoutes.ts 的 `/api/news/scheduler`，兩邊都呼叫這裡 ——
 * 理由同 `readerFetch.ts`：同一套規則不留第二份實作。
 */

import { loadNewsModuleSettings, saveNewsModuleSettings } from './settings'
import { loadReminders, saveReminders } from '../../fileStore'
import { reloadReminders } from '../../reminderScheduler'
import {
  NEWS_SCHEDULER_REMINDER_ID,
  getNewsSchedulerState,
  applyNewsSchedulerToReminders,
  type NewsSchedulerState
} from '../../../core/news/schedule'

export { NEWS_SCHEDULER_REMINDER_ID }
export type { NewsSchedulerState }

export function getNewsScheduler(): NewsSchedulerState {
  return getNewsSchedulerState(loadReminders(), loadNewsModuleSettings())
}

export function syncNewsScheduler(payload: NewsSchedulerState | undefined): { ok: true } {
  const reminders = applyNewsSchedulerToReminders(loadReminders(), payload)
  saveReminders(reminders)
  reloadReminders()
  const s = loadNewsModuleSettings()
  saveNewsModuleSettings({ ...s, reminder: { enabled: !!payload?.enabled, schedule: payload?.schedule } })
  return { ok: true }
}
