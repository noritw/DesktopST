import { describe, it, expect } from 'vitest'
import { groupCalendarReminders } from '../../src/core/reminder/calendarGroups'
import type { Reminder } from '../../src/core/types'

/**
 * 日曆同步分頁的分組邏輯（`docs/calendar-reminders-mobile-kickoff.md` §4.2／§4.3）。
 * 桌面與手機共用同一份，這裡的測試兩邊都算數。
 */

function once(id: string, at: number, lastTriggeredAt?: number): Reminder {
  return {
    id,
    label: id,
    prompt: '',
    schedule: { type: 'once', at },
    enabled: true,
    injectPinnedNotes: false,
    injectConversationContext: false,
    injectWeather: false,
    injectCalendar: false,
    createdAt: 0,
    lastTriggeredAt,
    source: 'calendar'
  }
}

describe('groupCalendarReminders', () => {
  // 2026-08-25 是週二，用它當「現在」的基準
  const TUESDAY = new Date(2026, 7, 25, 10, 0).getTime()

  it('已過期只認「沒觸發過」的', () => {
    const past = new Date(2026, 7, 20, 9, 0).getTime()
    const untriggered = once('a', past)
    const triggered = once('b', past, past + 1000)

    const groups = groupCalendarReminders([untriggered, triggered], TUESDAY)
    const expiredGroup = groups.find((g) => g.label === '已過期')

    expect(expiredGroup?.reminders.map((r) => r.id)).toEqual(['a'])
  })

  it('空分組不出現', () => {
    // 只有一筆本週的提醒，其餘分組都該是空的
    const thisWeek = once('a', new Date(2026, 7, 26, 9, 0).getTime())
    const groups = groupCalendarReminders([thisWeek], TUESDAY)

    expect(groups.map((g) => g.label)).toEqual(['本週'])
  })

  it('週一起始日邊界：週日晚上算本週，週一凌晨算下週', () => {
    // 現在是週二 2026-08-25，本週一是 2026-08-24、下週一是 2026-08-31
    const sundayNight = once('sun', new Date(2026, 7, 30, 23, 0).getTime()) // 週日晚上 → 本週
    const mondayMorning = once('mon', new Date(2026, 7, 31, 0, 30).getTime()) // 下週一凌晨 → 下週

    const groups = groupCalendarReminders([sundayNight, mondayMorning], TUESDAY)

    expect(groups.find((g) => g.label === '本週')?.reminders.map((r) => r.id)).toEqual(['sun'])
    expect(groups.find((g) => g.label === '下週')?.reminders.map((r) => r.id)).toEqual(['mon'])
  })

  it('跨年時的月分組排序（12月排在隔年1月前面）', () => {
    const dec = once('dec', new Date(2026, 11, 15, 9, 0).getTime())
    const janNextYear = once('jan', new Date(2027, 0, 15, 9, 0).getTime())

    const groups = groupCalendarReminders([janNextYear, dec], TUESDAY)
    const monthLabels = groups.filter((g) => g.label.endsWith('月')).map((g) => g.label)

    expect(monthLabels).toEqual(['12月', '1月'])
  })

  it('非 once 排程一律忽略', () => {
    const daily: Reminder = {
      id: 'daily',
      label: 'daily',
      prompt: '',
      schedule: { type: 'daily', hour: 8, minute: 0 },
      enabled: true,
      injectPinnedNotes: false,
      injectConversationContext: false,
      injectWeather: false,
      injectCalendar: false,
      createdAt: 0
    }
    expect(groupCalendarReminders([daily], TUESDAY)).toEqual([])
  })
})
