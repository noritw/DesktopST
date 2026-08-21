/**
 * 定時新聞陪聊：在提醒清單裡維護一條固定的特殊 Reminder，排程器自動吃到
 * （B1 抽 core，news-standalone-kickoff §4 步驟⑤）。
 *
 * ⚠️ **只抽「組出那條 Reminder 長什麼樣子」的純函式**，不碰實際存檔與鬧鐘註冊——
 * 桌面走 `fileStore` + `reminderScheduler.reloadReminders()`，
 * 手機獨立版走自己的原生精準鬧鐘（`mobile-standalone-reminder-plan.md` §2.1）。
 * 兩邊排程機制完全不同，硬併成一支會逼手機去理解桌面的 reminders.json 語意，
 * 或逼桌面去理解 Android AlarmManager——呼叫端各自用自己既有的提醒存檔流程即可。
 */
import type { Reminder, ReminderSchedule } from '../types'
import type { NewsModuleSettings } from './types'

/** 這條提醒由模組設定驅動，刻意不出現在「提醒管理員」。 */
export const NEWS_SCHEDULER_REMINDER_ID = 'news-module-scheduler'

export interface NewsSchedulerState {
  enabled: boolean
  schedule?: ReminderSchedule
}

/** 讀：提醒清單裡那條特殊 Reminder 是否啟用 ＋ 模組設定裡記的排程。 */
export function getNewsSchedulerState(reminders: Reminder[], settings: NewsModuleSettings): NewsSchedulerState {
  const active = reminders.find(r => r.id === NEWS_SCHEDULER_REMINDER_ID)
  return { enabled: !!active?.enabled, schedule: settings.reminder.schedule }
}

/** 寫：把新排程套進提醒清單（移除舊的、視需要塞一條新的）。呼叫端負責存檔＋重新註冊鬧鐘。 */
export function applyNewsSchedulerToReminders(reminders: Reminder[], payload: NewsSchedulerState | undefined): Reminder[] {
  const next = reminders.filter(r => r.id !== NEWS_SCHEDULER_REMINDER_ID)
  if (payload?.enabled && payload.schedule) {
    next.push({
      id: NEWS_SCHEDULER_REMINDER_ID,
      label: '新聞陪聊（自動）',
      prompt: '',
      schedule: payload.schedule,
      enabled: true,
      injectNews: true,
      createdAt: Date.now()
    })
  }
  return next
}
