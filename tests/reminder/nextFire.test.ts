import { describe, it, expect } from 'vitest'
import {
  nextDailyMs, nextWeeklyMs, nextIntervalMs, validWeeklyDays, nextFireDelayMs,
  nextTimeoutStep, MIN_INTERVAL_MS, MAX_TIMEOUT_MS
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
   * ⚠️ **這支是 2026-08-04 修掉的一個既有行為的迴歸測試。**
   *
   * 修正前：沒有 `lastTriggeredAt` 時 `elapsed` 取 `clamped` 本身，
   * 於是 `clamped - elapsed = 0` 被夾成 1 分鐘 ——
   * 「每 2 小時提醒」設好後第一次是 1 分鐘後就跳。
   * 這行為在搬進 core 之前就存在（不是重構造成的），由自動測試撞出來，
   * owner 決議修正為字面語意。
   */
  it('沒有上次觸發（剛建立）→ 等滿一整個間隔', () => {
    expect(nextIntervalMs(2 * HOUR, undefined, now)).toBe(2 * HOUR)
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
    expect(nextFireDelayMs({ type: 'interval', intervalMs: 2 * HOUR } as ReminderSchedule, undefined, noonSunday)).toBe(2 * HOUR)
    expect(nextFireDelayMs({ type: 'interval', intervalMs: 2 * HOUR } as ReminderSchedule, noonSunday.getTime() - HOUR, noonSunday)).toBe(HOUR)
  })

  it('weekly 沒選任何一天 → null（不該排）', () => {
    expect(nextFireDelayMs({ type: 'weekly', days: [], hour: 9, minute: 0 } as ReminderSchedule, undefined, noonSunday)).toBeNull()
  })

  it('未知型別 → null', () => {
    expect(nextFireDelayMs({ type: 'startup' } as ReminderSchedule, undefined, noonSunday)).toBeNull()
  })
})

/**
 * setTimeout 24.85 天上限的分段等待（2026-08-25 日曆驅動提醒實測炸開後補的）。
 *
 * 這組測試守的是一個**沉默的**失敗：延遲超過 32-bit 上限時 setTimeout 不會報錯，
 * 只會立刻觸發。一旦回歸，症狀是「一開程式狂噴提醒，然後該響的都不響」。
 */
describe('分段等待（setTimeout 上限）', () => {
  const now = noonSunday.getTime()

  it('上限之內 → 直接排到底，delay 就是剩餘時間', () => {
    expect(nextTimeoutStep(now + 90 * 1000, now)).toEqual({ delay: 90 * 1000, final: true })
  })

  it('剛好等於上限 → 仍算上限之內（邊界不能落在溢位側）', () => {
    expect(nextTimeoutStep(now + MAX_TIMEOUT_MS, now)).toEqual({ delay: MAX_TIMEOUT_MS, final: true })
  })

  it('超過上限一毫秒 → 改成先睡滿上限，且標記還沒到', () => {
    expect(nextTimeoutStep(now + MAX_TIMEOUT_MS + 1, now)).toEqual({ delay: MAX_TIMEOUT_MS, final: false })
  })

  it('目標時間已過 → delay 夾成 0，不給負數（負數會被當成立刻，但語意要明確）', () => {
    expect(nextTimeoutStep(now - 5000, now)).toEqual({ delay: 0, final: true })
  })

  it('90 天後的提醒：反覆套用會剛好走到目標，中途每一段都不超過上限', () => {
    const target = now + 90 * DAY
    let clock = now
    let steps = 0

    for (;;) {
      const { delay, final } = nextTimeoutStep(target, clock)
      // 這是整組測試的重點：任何一段都不能超過 setTimeout 撐得住的長度
      expect(delay).toBeLessThanOrEqual(MAX_TIMEOUT_MS)
      clock += delay
      steps++
      if (final) break
      expect(steps).toBeLessThan(10) // 防呆：不該無限迴圈
    }

    // 分段睡完之後正好落在目標時間，沒有提早也沒有累積誤差
    expect(clock).toBe(target)
    // 90 天 ÷ 24.85 天 → 3 段滿的 + 最後一段
    expect(steps).toBe(4)
  })

  it('中途排程有誤差時用絕對目標重算，誤差不會累積', () => {
    // 30 天：一段睡滿上限（24.85 天）後剩約 5.1 天，第二段就能到底
    const target = now + 30 * DAY
    let clock = now

    const first = nextTimeoutStep(target, clock)
    expect(first.final).toBe(false)
    // 模擬系統排程晚了 250ms 才叫醒我們
    clock += first.delay + 250

    const second = nextTimeoutStep(target, clock)
    expect(second.final).toBe(true)
    clock += second.delay

    // 仍然精準落在目標，那 250ms 沒有被帶進最終時間
    expect(clock).toBe(target)
  })
})
