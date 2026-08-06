/**
 * scheduler.ts
 * 定時新聞陪聊：在 reminders 檔裡維護一條固定的特殊 Reminder，排程器自動吃到。
 *
 * 桌面設定面板走 ipc.ts 的 `news:get-scheduler` / `news:sync-scheduler`，
 * 手機走 mobileRoutes.ts 的 `/api/news/scheduler`，兩邊都呼叫這裡 ——
 * 理由同 `readerFetch.ts`：同一套規則不留第二份實作。
 */

import { loadNewsModuleSettings, saveNewsModuleSettings } from './settings'
import { loadReminders, saveReminders } from '../../fileStore'
import { reloadReminders } from '../../reminderScheduler'
import type { ReminderSchedule } from '../../types'

/** 這條提醒由模組設定驅動，刻意不出現在「提醒管理員」。 */
export const NEWS_SCHEDULER_REMINDER_ID = 'news-module-scheduler'

export interface NewsSchedulerState {
  enabled: boolean
  schedule?: ReminderSchedule
}

export function getNewsScheduler(): NewsSchedulerState {
  const s = loadNewsModuleSettings()
  const active = loadReminders().find(r => r.id === NEWS_SCHEDULER_REMINDER_ID)
  return { enabled: !!active?.enabled, schedule: s.reminder.schedule }
}

export function syncNewsScheduler(payload: NewsSchedulerState | undefined): { ok: true } {
  const reminders = loadReminders().filter(r => r.id !== NEWS_SCHEDULER_REMINDER_ID)
  if (payload?.enabled && payload.schedule) {
    reminders.push({
      id: NEWS_SCHEDULER_REMINDER_ID,
      label: '新聞陪聊（自動）',
      prompt: '',
      schedule: payload.schedule,
      enabled: true,
      injectNews: true,
      createdAt: Date.now()
    })
  }
  saveReminders(reminders)
  reloadReminders()
  const s = loadNewsModuleSettings()
  saveNewsModuleSettings({ ...s, reminder: { enabled: !!payload?.enabled, schedule: payload?.schedule } })
  return { ok: true }
}
