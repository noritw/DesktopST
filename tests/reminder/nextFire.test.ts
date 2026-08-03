import { describe, it, expect } from 'vitest'
import {
  nextDailyMs, nextWeeklyMs, nextIntervalMs, validWeeklyDays, nextFireDelayMs, MIN_INTERVAL_MS
} from '@core/reminder/nextFire'
import type { ReminderSchedule } from '@core/types'

/**
 * 提醒觸發時刻 —— §6.2 第 8 項。
 *
 * 搬進 core 時已用 20,000 個隨機時刻與搬移前逐一比對過，這裡固化成常設測試。
 * 算錯不會有錯誤訊息，只會變成「提醒在錯的時間跳出來」。
 *
 * ⚠️ 全部注入 `now`，不依賴當下時間 —— 否則測試會在半夜跑的時候莫名其妙紅字。
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR

// 2025-08-03(週日) 12:00 本地時間
const noonSunday = new Date(2025, 7, 3, 12, 0, 0, 0)

describe('nextDailyMs', () => {
  it('今天還沒到 → 今天', () => {
    expect(nextDailyMs(18, 0, noonSunday)).toBe(6 * HOUR)
  })

  it('今天已過 → 明天', () => {
    expect(nextDailyMs(8, 0, noonSunday)).toBe(20 * HOUR)
  })

  it('剛好是現在 → 算明天（不會立刻重複觸發）', () => {
    expect(nextDailyMs(12, 0, noonSunday)).toBe(DAY)
  })

  it('午夜 00:00', () => {
    expect(nextDailyMs(0, 0, noonSunday)).toBe(12 * HOUR)
  })
})

describe('nextWeeklyMs', () => {
  it('本週稍後的某天', () => {
    // 週日 12:00 → 下個週三 09:00
    expect(nextWeeklyMs([3], 9, 0, noonSunday)).toBe(3 * DAY - 3 * HOUR)
  })

  it('今天但時間已過 → 跳到下週同一天', () => {
    expect(nextWeeklyMs([0], 8, 0, noonSunday)).toBe(7 * DAY - 4 * HOUR)
  })

  it('今天且時間還沒到 → 就是今天', () => {
    expect(nextWeeklyMs([0], 18, 0, noonSunday)).toBe(6 * HOUR)
  })

  it('多天時取最近的一天', () => {
    const multi = nextWeeklyMs([1, 3, 5], 9, 0, noonSunday)
    expect(multi).toBe(DAY - 3 * HOUR) // 週一 09:00
  })

  it('空陣列 → 防禦性地回七天', () => {
    expect(nextWeeklyMs([], 9, 0, noonSunday)).toBe(7 * DAY)
  })
})

describe('nextIntervalMs', () => {
  const now = noonSunday.getTime()

  /**
   * ⚠️ **這是現況，不見得是本意。**
   *
   * 沒有 `lastTriggeredAt`（＝剛建立的提醒）時，`elapsed` 取的是 `clamped` 本身，
   * 於是 `clamped - elapsed = 0` → 夾成最小間隔 **1 分鐘**。
   * 也就是「每 2 小時提醒一次」設好之後，**第一次是 1 分鐘後就跳**。
   *
   * 這個行為在搬進 core 之前就存在（搬移時與舊版逐一比對過 20,000 個時刻，
   * 結果相同），所以不是重構造成的。測試先如實記錄現況；
   * 要不要改成「首次也等一整個間隔」是產品決定，已回報 owner。
   */
  it('沒有上次觸發 → 目前是 1 分鐘後就觸發（現況，見上方註解）', () => {
    expect(nextIntervalMs(2 * HOUR, undefined, now)).toBe(MIN_INTERVAL_MS)
  })

  it('重開程式時扣掉已經過的時間，不從頭再等一輪', () => {
    expect(nextIntervalMs(2 * HOUR, now - HOUR, now)).toBe(HOUR)
  })

  it('已經超過間隔 → 至少等最小間隔（不會立刻連環觸發）', () => {
    expect(nextIntervalMs(2 * HOUR, now - 5 * HOUR, now)).toBe(MIN_INTERVAL_MS)
  })

  it('設定值小於最小間隔時被夾住', () => {
    expect(nextIntervalMs(1000, undefined, now)).toBe(MIN_INTERVAL_MS)
  })
})

describe('validWeeklyDays', () => {
  it('只留 0–6 的數字', () => {
    expect(validWeeklyDays([0, 3, 6])).toEqual([0, 3, 6])
    expect(validWeeklyDays([-1, 7, 2, '3', null])).toEqual([2])
  })

  it('非陣列 → 空陣列', () => {
    expect(validWeeklyDays(undefined)).toEqual([])
    expect(validWeeklyDays('mon')).toEqual([])
  })
})

describe('nextFireDelayMs', () => {
  it('once 未到 → 剩餘時間；已過 → null（不再排）', () => {
    const future = { type: 'once', at: noonSunday.getTime() + HOUR } as ReminderSchedule
    const past = { type: 'once', at: noonSunday.getTime() - HOUR } as ReminderSchedule
    expect(nextFireDelayMs(future, undefined, noonSunday)).toBe(HOUR)
    expect(nextFireDelayMs(past, undefined, noonSunday)).toBeNull()
  })

  it('daily / weekly / interval 各自轉給對應算式', () => {
    expect(nextFireDelayMs({ type: 'daily', hour: 18, minute: 0 } as ReminderSchedule, undefined, noonSunday)).toBe(6 * HOUR)
    expect(nextFireDelayMs({ type: 'weekly', days: [3], hour: 9, minute: 0 } as ReminderSchedule, undefined, noonSunday)).toBe(3 * DAY - 3 * HOUR)
    // interval 沒有 lastTriggeredAt 時是 1 分鐘（現況，見 nextIntervalMs 那段註解）
    expect(nextFireDelayMs({ type: 'interval', intervalMs: 2 * HOUR } as ReminderSchedule, undefined, noonSunday)).toBe(MIN_INTERVAL_MS)
    expect(nextFireDelayMs({ type: 'interval', intervalMs: 2 * HOUR } as ReminderSchedule, noonSunday.getTime() - HOUR, noonSunday)).toBe(HOUR)
  })

  it('weekly 沒選任何一天 → null（不該排）', () => {
    expect(nextFireDelayMs({ type: 'weekly', days: [], hour: 9, minute: 0 } as ReminderSchedule, undefined, noonSunday)).toBeNull()
  })

  it('未知型別 → null', () => {
    expect(nextFireDelayMs({ type: 'startup' } as ReminderSchedule, undefined, noonSunday)).toBeNull()
  })
})
