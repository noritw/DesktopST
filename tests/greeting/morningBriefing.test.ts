import { describe, expect, it } from 'vitest'
import {
  emptyMorningBriefingSnapshot,
  isConversationTooRecent,
  normalizeMorningBriefingSnapshot,
  shouldGreetToday,
  taipeiDateString
} from '@core/greeting'

describe('shouldGreetToday', () => {
  it('returns true when never greeted', () => {
    expect(shouldGreetToday(emptyMorningBriefingSnapshot(), '2026-09-03')).toBe(true)
  })

  it('returns false when already greeted today', () => {
    const snapshot = { lastGreetedDate: '2026-09-03' }
    expect(shouldGreetToday(snapshot, '2026-09-03')).toBe(false)
  })

  it('returns true when last greeted on a different day', () => {
    const snapshot = { lastGreetedDate: '2026-09-02' }
    expect(shouldGreetToday(snapshot, '2026-09-03')).toBe(true)
  })
})

describe('normalizeMorningBriefingSnapshot', () => {
  it('falls back to empty snapshot for garbage input', () => {
    expect(normalizeMorningBriefingSnapshot(null)).toEqual(emptyMorningBriefingSnapshot())
    expect(normalizeMorningBriefingSnapshot(undefined)).toEqual(emptyMorningBriefingSnapshot())
    expect(normalizeMorningBriefingSnapshot('not an object')).toEqual(emptyMorningBriefingSnapshot())
    expect(normalizeMorningBriefingSnapshot({})).toEqual(emptyMorningBriefingSnapshot())
  })

  it('passes through a valid lastGreetedDate', () => {
    expect(normalizeMorningBriefingSnapshot({ lastGreetedDate: '2026-09-01' })).toEqual({
      lastGreetedDate: '2026-09-01'
    })
  })

  it('ignores non-string lastGreetedDate', () => {
    expect(normalizeMorningBriefingSnapshot({ lastGreetedDate: 12345 })).toEqual(
      emptyMorningBriefingSnapshot()
    )
  })
})

describe('taipeiDateString', () => {
  it('formats a UTC timestamp as Taipei-local YYYY-MM-DD', () => {
    // 2026-09-03T16:30:00Z = 2026-09-04 00:30 台北時間
    expect(taipeiDateString(Date.parse('2026-09-03T16:30:00Z'))).toBe('2026-09-04')
  })

  it('stays on the previous day just before midnight Taipei time', () => {
    // 2026-09-03T15:59:00Z = 2026-09-03 23:59 台北時間
    expect(taipeiDateString(Date.parse('2026-09-03T15:59:00Z'))).toBe('2026-09-03')
  })
})

describe('isConversationTooRecent', () => {
  const now = Date.parse('2026-09-03T10:00:00Z')

  it('is false when there is no prior user message', () => {
    expect(isConversationTooRecent(null, now)).toBe(false)
  })

  it('is true within the 2-minute window', () => {
    expect(isConversationTooRecent(now - 60_000, now)).toBe(true)
  })

  it('is false right at the 2-minute boundary', () => {
    expect(isConversationTooRecent(now - 2 * 60_000, now)).toBe(false)
  })

  it('is false well outside the window', () => {
    expect(isConversationTooRecent(now - 10 * 60_000, now)).toBe(false)
  })
})
