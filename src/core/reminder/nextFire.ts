import type { ReminderSchedule } from '../types'

/**
 * 「下一次該在多久之後觸發」的計算（純邏輯）。
 * 原 `src/main/reminderScheduler.ts` 的 `nextDailyMs` / `nextWeeklyMs` 與 interval 首次延遲。
 *
 * 排程的**執行**方式各平台不同（桌面 `setTimeout`、Android AlarmManager），
 * 但「每天 08:00 是幾毫秒後」這件事兩邊必須算得一模一樣——
 * 算錯不會有錯誤訊息，只會變成提醒在錯的時間跳出來。
 *
 * 全部接受注入的 `now` 以便測試與重算；預設取當下時間。
 */

/** 每天固定時分：距離下一次的毫秒數（今天已過則算明天）。 */
export function nextDailyMs(hour: number, minute: number, now: Date = new Date()): number {
  const target = new Date(now)
  target.setHours(hour, minute, 0, 0)
  if (target <= now) target.setDate(target.getDate() + 1)
  return target.getTime() - now.getTime()
}

/**
 * 每週指定星期幾的固定時分：距離下一次的毫秒數。
 * `days` 為 0（週日）～6（週六）。找不到時回傳七天（防禦）。
 */
export function nextWeeklyMs(days: number[], hour: number, minute: number, now: Date = new Date()): number {
  const daySet = new Set(days)
  for (let add = 0; add < 8; add++) {
    const target = new Date(now)
    target.setDate(now.getDate() + add)
    target.setHours(hour, minute, 0, 0)
    if (daySet.has(target.getDay()) && target > now) {
      return target.getTime() - now.getTime()
    }
  }
  return 7 * 24 * 60 * 60 * 1000
}

/** interval 排程的最小間隔（一分鐘），避免設定值過小把自己洗版。 */
export const MIN_INTERVAL_MS = 60_000

/**
 * 固定間隔排程的**首次**延遲。
 *
 * 會把上次觸發後已經過的時間算進去——程式重開後不該從頭再等一輪。
 * 無論如何至少等 `MIN_INTERVAL_MS`。
 *
 * ⚠️ **從沒觸發過（剛建立的提醒）＝ 已經過 0，要等滿一整個間隔。**
 * 2026-08-04 前這裡是 `: clamped`，等於「已經過了一整輪」，
 * 於是 `clamped - elapsed = 0` 被夾成 1 分鐘 ——
 * 設「每 2 小時提醒」按下儲存後，第一次是 1 分鐘後就跳。
 * owner 決議修正為字面語意：每 N 小時就是 N 小時。
 */
export function nextIntervalMs(intervalMs: number, lastTriggeredAt?: number, nowMs: number = Date.now()): number {
  const clamped = Math.max(MIN_INTERVAL_MS, intervalMs)
  const elapsed = lastTriggeredAt ? nowMs - lastTriggeredAt : 0
  return Math.max(MIN_INTERVAL_MS, clamped - elapsed)
}

/** 星期陣列正規化：只留 0–6。 */
export function validWeeklyDays(days: unknown): number[] {
  return Array.isArray(days) ? days.filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6) : []
}

/**
 * 一個排程距離下次觸發還有多久（毫秒）。
 * 回傳 `null` 代表這個排程不該再排（一次性且已過期、weekly 沒選任何一天）。
 *
 * `startup` 不在此處理——那是「程式啟動後幾秒」，屬於平台生命週期而非時刻計算。
 */
export function nextFireDelayMs(
  schedule: ReminderSchedule,
  lastTriggeredAt?: number,
  now: Date = new Date()
): number | null {
  switch (schedule.type) {
    case 'once': {
      const delay = schedule.at - now.getTime()
      return delay > 0 ? delay : null
    }
    case 'daily':
      return nextDailyMs(schedule.hour, schedule.minute, now)
    case 'weekly': {
      const days = validWeeklyDays(schedule.days)
      if (days.length === 0) return null
      const delay = nextWeeklyMs(days, schedule.hour, schedule.minute, now)
      return Number.isFinite(delay) && delay > 0 ? delay : null
    }
    case 'interval':
      return nextIntervalMs(schedule.intervalMs, lastTriggeredAt, now.getTime())
    default:
      return null
  }
}
