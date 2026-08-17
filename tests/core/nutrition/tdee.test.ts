import { describe, expect, it } from 'vitest'
import { ACTIVITY_LEVEL_MULTIPLIERS, calculateTdeeKcal } from '@core/nutrition'

describe('nutrition TDEE', () => {
  it('uses the neutral Mifflin base and sedentary multiplier', () => {
    expect(calculateTdeeKcal({
      heightCm: 175,
      weightKg: 80,
      ageYears: 30,
      activityLevel: 'sedentary'
    })).toBe(2_093)
  })

  it('exposes the agreed activity multipliers', () => {
    expect(ACTIVITY_LEVEL_MULTIPLIERS).toEqual({
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      'very-active': 1.9
    })
  })
})
