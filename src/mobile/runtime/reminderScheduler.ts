import { LocalNotifications } from '@capacitor/local-notifications'
import type { Reminder } from '@core/types'
import {
  nextDailyMs,
  nextWeeklyMs,
  nextIntervalMs,
  validWeeklyDays,
  nextFireDelayMs,
  MIN_INTERVAL_MS
} from '@core/reminder/nextFire'

/**
 * 手機端提醒排程器（Capacitor LocalNotifications）。
 *
 * 提醒觸發時發送本機通知。排程計算邏輯與桌面版一致（共用 `core/reminder/nextFire.ts`）。
 */

type TriggerFn = (reminder: Reminder) => Promise<void>

let triggerFn: TriggerFn | null = null
let reminders: Reminder[] = []
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let initialized = false

export async function initReminderScheduler(trigger: TriggerFn): Promise<void> {
  triggerFn = trigger
  initialized = true

  // 請求通知權限
  try {
    const status = await LocalNotifications.requestPermissions()
    if (status.display !== 'granted') {
      console.warn('提醒通知權限未授予')
    }
  } catch (e) {
    console.error('請求通知權限失敗:', e)
  }
}

export function updateReminders(newReminders: Reminder[]): void {
  if (!initialized) return
  reminders = newReminders
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  scheduleAll()
}

function scheduleAll(): void {
  for (const r of reminders) {
    if (r.enabled && (r.notificationDevice === 'mobile' || r.notificationDevice === 'both')) {
      scheduleOne(r)
    }
  }
}

function scheduleOne(r: Reminder): void {
  clearTimerFor(r.id)
  const delay = nextFireDelayMs(r.schedule, r.lastTriggeredAt)

  if (delay === null || delay <= 0) return

  const t = setTimeout(() => {
    timers.delete(r.id)
    void fire(r)

    if (r.schedule.type === 'once') {
      r.enabled = false
    } else if (r.enabled) {
      scheduleOne(r)
    }
  }, delay)

  timers.set(r.id, t)
}

function clearTimerFor(id: string): void {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
}

async function fire(reminder: Reminder): Promise<void> {
  try {
    if (triggerFn) {
      await triggerFn(reminder)
    }

    // 發送本機通知（立即）
    const notifId = hashStringToNumber(reminder.id)
    await LocalNotifications.schedule({
      notifications: [
        {
          title: reminder.label || '提醒',
          body: reminder.prompt,
          id: notifId,
          smallIcon: 'ic_launcher_foreground',
          autoCancel: true
        }
      ]
    })
  } catch (e) {
    console.error('提醒觸發失敗:', e)
  }
}

function hashStringToNumber(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  const absHash = Math.abs(hash)
  return (absHash % 2147483647) + 1
}

export function stopReminderScheduler(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  initialized = false
}
