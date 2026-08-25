import { describe, it, expect } from 'vitest'
import { diffCalendarReminders } from '../../src/main/calendar/reminderScanner'
import type { CalendarEventWithReminders } from '../../src/main/calendar/googleProvider'
import type { Reminder } from '../../src/core/types'

/**
 * 日曆驅動提醒的掃描器比對邏輯（`docs/calendar-driven-reminders-kickoff.md` §5）。
 *
 * 這支能進 vitest 是因為 `reminderScanner.ts` 對 electron **只有 type-only import**
 * （編譯後整個消失）。改它的時候不要順手 import `calendar/index.ts` 之類的東西，
 * 那會連帶拉進 electron，這份測試就跑不動了。
 */

function ev(
  id: string,
  title: string,
  start: Date,
  reminderMinutes: number[],
  location?: string
): CalendarEventWithReminders {
  return {
    id,
    title,
    start: start.getTime(),
    end: start.getTime() + 3600_000,
    allDay: false,
    location,
    kind: 'event',
    reminderMinutes
  }
}

/** 2026-10-08 15:45 本地時間（用本地時間建、也用本地時間格式化，跟時區無關） */
const CLASS_AT = new Date(2026, 9, 8, 15, 45)

describe('日曆驅動提醒：掃描器比對', () => {
  it('Google 有、本機沒有 → 新建，且不帶地點、不開 injectCalendar', () => {
    const events = [ev('e1', '大勇國小iPad繪圖社', CLASS_AT, [30], '大勇國小, 334台灣桃園市八德區')]

    const { toUpsert, toDeleteIds } = diffCalendarReminders(events, [])

    expect(toUpsert).toHaveLength(1)
    expect(toDeleteIds).toEqual([])

    const r = toUpsert[0]
    expect(r.source).toBe('calendar')
    expect(r.sourceEventId).toBe('e1')
    expect(r.sourceOverrideIndex).toBe(0)
    expect(r.label).toBe('大勇國小iPad繪圖社')
    // 提前 30 分鐘
    expect(r.schedule).toEqual({ type: 'once', at: CLASS_AT.getTime() - 30 * 60000 })

    // owner 2026-08-25 實測後拍板的兩件事
    expect(r.prompt).toBe('提醒使用者：大勇國小iPad繪圖社，時間 10月8日 15:45。')
    expect(r.prompt).not.toContain('334')
    expect(r.prompt).not.toContain('地點')
    expect(r.injectCalendar).toBe(false)
  })

  it('相對日期標籤不得出現在 prompt（會漂移，導致每次掃描都判定有變）', () => {
    const today = new Date()
    today.setHours(today.getHours() + 2)
    const [r] = diffCalendarReminders([ev('e1', '開會', today, [10])], []).toUpsert

    for (const drifting of ['今天', '明天', '後天']) {
      expect(r.prompt).not.toContain(drifting)
    }
  })

  it('同一份資料再掃一次 → 完全不動（不能重複增生，M3 踩過的失敗模式）', () => {
    const events = [ev('e1', '大勇國小iPad繪圖社', CLASS_AT, [30])]
    const first = diffCalendarReminders(events, []).toUpsert

    const second = diffCalendarReminders(events, first)

    expect(second.toUpsert).toEqual([])
    expect(second.toDeleteIds).toEqual([])
  })

  it('一個事件有幾筆 override 就建幾筆（不去重、不只挑一筆）', () => {
    const events = [ev('e1', '上課', CLASS_AT, [30, 1440])]

    const { toUpsert } = diffCalendarReminders(events, [])

    expect(toUpsert).toHaveLength(2)
    expect(toUpsert.map(r => r.sourceOverrideIndex)).toEqual([0, 1])
    expect(toUpsert.map(r => (r.schedule as { at: number }).at)).toEqual([
      CLASS_AT.getTime() - 30 * 60000,
      CLASS_AT.getTime() - 1440 * 60000
    ])
  })

  it('Google 端改期 → 更新時間，但保留使用者手動調過的欄位', () => {
    const [created] = diffCalendarReminders([ev('e1', '上課', CLASS_AT, [30])], []).toUpsert

    // 使用者事後在編輯器裡調過這些（§8.3 允許編輯的那幾項）
    const customised: Reminder = {
      ...created,
      characterId: 'char-42',
      notificationDevice: 'desktop',
      wakeMode: 'screen_on_only',
      enabled: false,
      injectCalendar: true
    }

    const moved = new Date(2026, 9, 8, 17, 0)
    const { toUpsert, toDeleteIds } = diffCalendarReminders([ev('e1', '上課', moved, [30])], [customised])

    expect(toDeleteIds).toEqual([])
    expect(toUpsert).toHaveLength(1)
    const r = toUpsert[0]

    // 跟著 Google 走的部分更新了
    expect(r.schedule).toEqual({ type: 'once', at: moved.getTime() - 30 * 60000 })
    expect(r.id).toBe(created.id)
    // 使用者的調整原封不動
    expect(r.characterId).toBe('char-42')
    expect(r.notificationDevice).toBe('desktop')
    expect(r.wakeMode).toBe('screen_on_only')
    expect(r.enabled).toBe(false)
    expect(r.injectCalendar).toBe(true)
  })

  it('Google 端事件消失 → 刪除對應提醒（唯讀鏡射，Google 才是唯一真相）', () => {
    const existing = diffCalendarReminders([ev('e1', '上課', CLASS_AT, [30])], []).toUpsert

    const { toUpsert, toDeleteIds } = diffCalendarReminders([], existing)

    expect(toUpsert).toEqual([])
    expect(toDeleteIds).toEqual([existing[0].id])
  })

  it('手動建立的提醒完全不受影響（不會被當成 Google 端已刪除而清掉）', () => {
    const manual: Reminder = {
      id: 'manual-1',
      label: '喝水',
      prompt: '提醒我喝水',
      schedule: { type: 'daily', hour: 9, minute: 0 },
      enabled: true,
      createdAt: Date.now()
    }

    const { toUpsert, toDeleteIds } = diffCalendarReminders([], [manual])

    expect(toUpsert).toEqual([])
    expect(toDeleteIds).toEqual([])
  })
})
