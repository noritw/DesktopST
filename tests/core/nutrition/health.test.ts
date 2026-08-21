import { describe, expect, it } from 'vitest'
import { suggestTodayKcalLimit, calculateBmr } from '@core/nutrition'
import type { HealthSnapshot } from '@core/adapters'
import { bodyProfile } from './fixtures'

describe('suggestTodayKcalLimit', () => {
  it('adds calories burned so far today to the projected resting burn for the rest of the day', () => {
    // now = 2026-08-17 18:30，距離隔日 00:00 剛好 5.5 小時
    const now = new Date(2026, 7, 17, 18, 30).getTime()
    const measuredAt = new Date(2026, 7, 17, 18, 25).getTime()
    const snapshot: HealthSnapshot = { caloriesBurnedSoFarToday: 1187, measuredAt }

    const result = suggestTodayKcalLimit(bodyProfile, snapshot, now)

    const restingKcalPerHour = calculateBmr(bodyProfile) / 24
    const expected = Math.round(1187 + 5.5 * restingKcalPerHour)
    expect(result).toBe(expected)
  })

  it('returns null when the snapshot has no calories data', () => {
    const now = new Date(2026, 7, 17, 12, 0).getTime()
    const snapshot: HealthSnapshot = { measuredAt: now }

    expect(suggestTodayKcalLimit(bodyProfile, snapshot, now)).toBeNull()
  })

  it('returns null when the snapshot is stale (not from today)', () => {
    const now = new Date(2026, 7, 17, 12, 0).getTime()
    const yesterday = new Date(2026, 7, 16, 23, 0).getTime()
    const snapshot: HealthSnapshot = { caloriesBurnedSoFarToday: 900, measuredAt: yesterday }

    expect(suggestTodayKcalLimit(bodyProfile, snapshot, now)).toBeNull()
  })

  it('projects resting burn down to zero remaining hours right before midnight', () => {
    const now = new Date(2026, 7, 17, 23, 59, 30).getTime()
    const snapshot: HealthSnapshot = { caloriesBurnedSoFarToday: 2400, measuredAt: now }

    const result = suggestTodayKcalLimit(bodyProfile, snapshot, now)

    // 剩不到一分鐘，靜止代謝那部分幾乎是 0，結果應非常接近已消耗量
    expect(result).toBeGreaterThanOrEqual(2400)
    expect(result!).toBeLessThan(2402)
  })
})
