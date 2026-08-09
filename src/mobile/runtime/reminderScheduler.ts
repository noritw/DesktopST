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

/**
 * 提醒專用的通知頻道。
 *
 * ⚠️ **不要用 Capacitor 的預設頻道**（`default`，importance=3）。
 * importance 3 只會安靜地躺進通知欄，**不會有橫幅彈出**——
 * 手機又常常在震動模式，結果就是「時間到了什麼都沒發生」
 * （owner 2026-08-09 實機回報，dumpsys 證實通知有送出但沒人看見）。
 * 提醒的重點就是要被看到，所以固定用 importance 4（HIGH）＋震動。
 *
 * 頻道建立後 **importance 就改不動了**（Android 限制，除非重裝），
 * 所以 id 帶版號，日後要調整就換一個 id。
 */
const CHANNEL_ID = 'dest-reminders-v1'

let triggerFn: TriggerFn | null = null
let reminders: Reminder[] = []
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let initialized = false

export async function initReminderScheduler(trigger: TriggerFn): Promise<void> {
  triggerFn = trigger
  initialized = true

  // 僅在 Web 環境請求通知權限
  if (typeof window !== 'undefined') {
    try {
      const status = await LocalNotifications.requestPermissions()
      if (status.display !== 'granted') {
        console.warn('[Reminder] 通知權限未授予，提醒不會跳出來')
      }
    } catch (e) {
      console.error('[Reminder] 請求通知權限失敗:', e)
    }

    // Android 專屬；其他平台會擲錯，忽略即可
    try {
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: '提醒',
        description: '排定的角色提醒',
        importance: 4,
        visibility: 1,
        vibration: true,
        lights: true
      })
      console.log('[Reminder] 通知頻道已就緒')
    } catch (e) {
      console.warn('[Reminder] 建立通知頻道失敗（非 Android 可忽略）:', e)
    }
  }
}

export function updateReminders(newReminders: Reminder[]): void {
  if (!initialized) {
    console.warn('[Reminder] updateReminders 被呼叫但排程器未初始化')
    return
  }
  console.log(`[Reminder] 更新 ${newReminders.length} 個提醒`)
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

  if (delay === null || delay <= 0) {
    console.log(`[Reminder] 跳過 "${r.label}"（延遲無效: ${delay}）`)
    return
  }

  console.log(`[Reminder] 排程 "${r.label}" - ${delay}ms 後 (${new Date(Date.now() + delay).toLocaleTimeString()})`)

  const t = setTimeout(() => {
    timers.delete(r.id)
    console.log(`[Reminder] 觸發 "${r.label}"`)
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

    // 僅在 Web 環境發送本機通知
    if (typeof window !== 'undefined') {
      const notifId = hashStringToNumber(reminder.id)
      console.log(`[Reminder] 發送通知: "${reminder.label}" (ID: ${notifId})`)
      await LocalNotifications.schedule({
        notifications: [
          {
            title: reminder.label || '提醒',
            body: reminder.prompt,
            id: notifId,
            channelId: CHANNEL_ID,
            smallIcon: 'ic_launcher_foreground',
            autoCancel: true
          }
        ]
      })
      console.log(`[Reminder] 通知已發送`)
    } else {
      console.log(`[Reminder] 跳過通知（非 Web 環境）`)
    }
  } catch (e) {
    console.error('[Reminder] 觸發失敗:', e)
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
