import { describe, expect, it } from 'vitest'
import type { Reminder } from '../../src/core/types'
import type { NewsModuleSettings } from '../../src/core/news/types'
import {
  NEWS_SCHEDULER_REMINDER_ID,
  applyNewsSchedulerToReminders,
  getNewsSchedulerState
} from '../../src/core/news/schedule'

function baseSettings(): NewsModuleSettings {
  return {
    enabled: true,
    sources: [],
    keywordGroups: [],
    blacklist: [],
    excludedCategories: [],
    excludedSources: [],
    reducedSources: [],
    langMode: 'translate',
    speakButton: 'sometimes',
    replyModel: 'main',
    reminder: { enabled: false },
    breakout: { enabled: false, weight: 'normal' },
    localNews: { enabled: false, locations: [] },
    feedback: { adjustments: {} },
    seenIds: [],
    maxAgeDays: 30
  }
}

describe('core/news/schedule', () => {
  it('沒有那條特殊 Reminder 時視為關閉，但排程仍照設定回報', () => {
    const settings = { ...baseSettings(), reminder: { enabled: false, schedule: { type: 'daily' as const, hour: 8, minute: 0 } } }
    const state = getNewsSchedulerState([], settings)
    expect(state.enabled).toBe(false)
    expect(state.schedule).toEqual({ type: 'daily', hour: 8, minute: 0 })
  })

  it('提醒清單裡有啟用的那條就回 enabled: true', () => {
    const reminders: Reminder[] = [
      { id: NEWS_SCHEDULER_REMINDER_ID, label: 'x', prompt: '', schedule: { type: 'daily', hour: 8, minute: 0 }, enabled: true, createdAt: 0 }
    ]
    const state = getNewsSchedulerState(reminders, baseSettings())
    expect(state.enabled).toBe(true)
  })

  it('套用新排程：塞一條新的、移除舊的（同 id 只留一條）', () => {
    const existing: Reminder[] = [
      { id: NEWS_SCHEDULER_REMINDER_ID, label: '舊的', prompt: '', schedule: { type: 'daily', hour: 7, minute: 0 }, enabled: true, createdAt: 0 },
      { id: 'other', label: '別的提醒', prompt: '', schedule: { type: 'daily', hour: 9, minute: 0 }, enabled: true, createdAt: 0 }
    ]
    const next = applyNewsSchedulerToReminders(existing, { enabled: true, schedule: { type: 'daily', hour: 20, minute: 30 } })
    expect(next.filter(r => r.id === NEWS_SCHEDULER_REMINDER_ID)).toHaveLength(1)
    expect(next.find(r => r.id === NEWS_SCHEDULER_REMINDER_ID)?.schedule).toEqual({ type: 'daily', hour: 20, minute: 30 })
    expect(next.find(r => r.id === 'other')).toBeTruthy()
  })

  it('關閉時移除那條特殊 Reminder，不留殘影', () => {
    const existing: Reminder[] = [
      { id: NEWS_SCHEDULER_REMINDER_ID, label: '舊的', prompt: '', schedule: { type: 'daily', hour: 7, minute: 0 }, enabled: true, createdAt: 0 }
    ]
    const next = applyNewsSchedulerToReminders(existing, { enabled: false })
    expect(next.find(r => r.id === NEWS_SCHEDULER_REMINDER_ID)).toBeUndefined()
  })

  it('enabled true 但沒帶 schedule：視同關閉（開關開著卻永遠不會觸發是壞狀態）', () => {
    const next = applyNewsSchedulerToReminders([], { enabled: true })
    expect(next).toHaveLength(0)
  })
})
