import { describe, it, expect } from 'vitest'
import { nextDailyMs, nextWeeklyMs, nextIntervalMs, nextFireDelayMs } from '@core/reminder/nextFire'
import type { Reminder, ReminderSchedule } from '@core/types'

describe('Reminder Scheduling (Mobile)', () => {
  describe('nextDailyMs', () => {
    it('計算每日排程的延遲', () => {
      const now = new Date('2026-01-10T08:30:00Z')
      const delay = nextDailyMs(8, 0, now)
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
    })

    it('若已過該時間則延到明天', () => {
      const now = new Date('2026-01-10T10:00:00Z')
      const delay = nextDailyMs(8, 0, now)
      const nextFire = new Date(now.getTime() + delay)
      expect(nextFire.getHours()).toBe(8)
      expect(nextFire.getMinutes()).toBe(0)
      expect(nextFire.getDate()).toBe(11)
    })
  })

  describe('nextWeeklyMs', () => {
    it('計算每週排程的延遲', () => {
      const now = new Date('2026-01-10T12:00:00Z')
      const delay = nextWeeklyMs([1, 3, 5], 9, 0, now)
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000)
    })

    it('若無指定的星期則回傳七天', () => {
      const now = new Date('2026-01-10T12:00:00Z')
      const delay = nextWeeklyMs([], 9, 0, now)
      expect(delay).toBe(7 * 24 * 60 * 60 * 1000)
    })
  })

  describe('nextIntervalMs', () => {
    it('計算固定間隔的延遲', () => {
      const intervalMs = 2 * 60 * 60 * 1000
      const delay = nextIntervalMs(intervalMs, undefined, Date.now())
      expect(delay).toBe(intervalMs)
    })

    it('若已觸發過則計算剩餘延遲', () => {
      const now = Date.now()
      const intervalMs = 60 * 60 * 1000
      const lastTriggered = now - 30 * 60 * 1000
      const delay = nextIntervalMs(intervalMs, lastTriggered, now)
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(intervalMs)
    })
  })

  describe('nextFireDelayMs', () => {
    it('一次性排程：未來時間回傳延遲', () => {
      const future = Date.now() + 60 * 60 * 1000
      const schedule: ReminderSchedule = { type: 'once', at: future }
      const delay = nextFireDelayMs(schedule)
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(60 * 60 * 1000)
    })

    it('一次性排程：過去時間回傳 null', () => {
      const past = Date.now() - 60 * 60 * 1000
      const schedule: ReminderSchedule = { type: 'once', at: past }
      const delay = nextFireDelayMs(schedule)
      expect(delay).toBeNull()
    })

    it('日排程回傳正延遲', () => {
      const schedule: ReminderSchedule = { type: 'daily', hour: 8, minute: 0 }
      const delay = nextFireDelayMs(schedule)
      expect(delay).toBeGreaterThan(0)
    })

    it('無效週排程回傳 null', () => {
      const schedule: ReminderSchedule = { type: 'weekly', days: [], hour: 8, minute: 0 }
      const delay = nextFireDelayMs(schedule)
      expect(delay).toBeNull()
    })

    it('間隔排程回傳正延遲', () => {
      const schedule: ReminderSchedule = { type: 'interval', intervalMs: 60 * 60 * 1000 }
      const delay = nextFireDelayMs(schedule)
      expect(delay).toBeGreaterThan(0)
    })
  })

  describe('Reminder 資料結構', () => {
    it('新建的提醒應有 notificationDevice 欄位', () => {
      const reminder: Reminder = {
        id: 'test-1',
        label: '測試提醒',
        prompt: '這是測試內容',
        schedule: { type: 'daily', hour: 8, minute: 0 },
        enabled: true,
        notificationDevice: 'mobile',
        createdAt: Date.now()
      }
      expect(reminder.notificationDevice).toBe('mobile')
    })

    it('notificationDevice 可設為 desktop/mobile/both', () => {
      const devices: Array<'desktop' | 'mobile' | 'both'> = ['desktop', 'mobile', 'both']
      for (const device of devices) {
        const reminder: Reminder = {
          id: 'test-1',
          label: '測試',
          prompt: '內容',
          schedule: { type: 'daily', hour: 8, minute: 0 },
          enabled: true,
          notificationDevice: device,
          createdAt: Date.now()
        }
        expect(reminder.notificationDevice).toBe(device)
      }
    })
  })
})
