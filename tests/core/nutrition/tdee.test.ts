import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_LEVEL_MULTIPLIERS,
  GOAL_KCAL_ADJUSTMENT_RATIO,
  PROTEIN_ACTIVITY_MULTIPLIERS,
  calculateTdeeKcal,
  calculateBmr,
  calculateGoalAdjustedKcal,
  calculateProteinGoalG
} from '@core/nutrition'

describe('nutrition TDEE', () => {
  it('calculates male BMR with Mifflin-St Jeor', () => {
    // 男性 175cm 80kg 30歲：BMR = 10*80 + 6.25*175 - 5*30 + 5 = 1748.75 → 1749
    expect(calculateBmr({
      heightCm: 175,
      weightKg: 80,
      ageYears: 30,
      sex: 'male'
    })).toBe(1749)
  })

  it('calculates female BMR with Mifflin-St Jeor', () => {
    // 女性 155cm 51.6kg 43歲：BMR = 10*51.6 + 6.25*155 - 5*43 - 161 = 1108.75 → 1109
    expect(calculateBmr({
      heightCm: 155,
      weightKg: 51.6,
      ageYears: 43,
      sex: 'female'
    })).toBe(1109)
  })

  it('calculates BMR with Katch-McArdle when body fat is provided', () => {
    // 女性 51.6kg 體脂 30%：LBM = 51.6 * 0.7 = 36.12，BMR = 370 + 21.6*36.12 = 1150.59 → 1150（無條件捨去）
    expect(calculateBmr({
      heightCm: 155,
      weightKg: 51.6,
      ageYears: 43,
      sex: 'female',
      bodyFatPercent: 30
    })).toBe(1150)
  })

  it('calculates TDEE with male Mifflin and sedentary multiplier', () => {
    // 男性 Mifflin BMR 1749 × sedentary 1.2 = 2098.8 → 2099
    expect(calculateTdeeKcal({
      heightCm: 175,
      weightKg: 80,
      ageYears: 30,
      sex: 'male',
      activityLevel: 'sedentary'
    })).toBe(2099)
  })

  it('calculates TDEE with female Mifflin and sedentary multiplier', () => {
    // 女性 Mifflin BMR 1109 × sedentary 1.2 = 1330.8 → 1331
    expect(calculateTdeeKcal({
      heightCm: 155,
      weightKg: 51.6,
      ageYears: 43,
      sex: 'female',
      activityLevel: 'sedentary'
    })).toBe(1331)
  })

  it('calculates TDEE with Katch-McArdle when body fat is provided', () => {
    // 女性 Katch-McArdle BMR 1150 × sedentary 1.2 = 1380
    expect(calculateTdeeKcal({
      heightCm: 155,
      weightKg: 51.6,
      ageYears: 43,
      sex: 'female',
      bodyFatPercent: 30,
      activityLevel: 'sedentary'
    })).toBe(1380)
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

  it('adjusts TDEE by goal (lose/gain-muscle/maintain/gain)', () => {
    expect(calculateGoalAdjustedKcal(2000, 'lose-weight')).toBe(1700)
    expect(calculateGoalAdjustedKcal(2000, 'gain-muscle')).toBe(1800)
    expect(calculateGoalAdjustedKcal(2000, 'maintain')).toBe(2000)
    expect(calculateGoalAdjustedKcal(2000, 'gain-weight')).toBe(2200)
  })

  it('exposes the agreed goal kcal adjustment ratios', () => {
    expect(GOAL_KCAL_ADJUSTMENT_RATIO).toEqual({
      'lose-weight': 0.85,
      'gain-muscle': 0.9,
      maintain: 1.0,
      'gain-weight': 1.1
    })
  })

  it('calculates protein goal from official baseline (1.1 g/kg for adults under 70)', () => {
    // 51.6kg 43歲 久坐：51.6 × 1.1 × 1.0 = 56.76 → 57
    expect(calculateProteinGoalG({
      weightKg: 51.6,
      ageYears: 43,
      activityLevel: 'sedentary'
    })).toBe(57)
  })

  it('raises the baseline to 1.2 g/kg for age 70+', () => {
    // 60kg 70歲 久坐：60 × 1.2 × 1.0 = 72
    expect(calculateProteinGoalG({
      weightKg: 60,
      ageYears: 70,
      activityLevel: 'sedentary'
    })).toBe(72)
  })

  it('scales protein goal up with activity level for regular exercisers', () => {
    // 51.6kg 43歲 中度活動：51.6 × 1.1 × 1.27 = 72.08 → 72
    expect(calculateProteinGoalG({
      weightKg: 51.6,
      ageYears: 43,
      activityLevel: 'moderate'
    })).toBe(72)
  })

  it('exposes the agreed protein activity multipliers', () => {
    expect(PROTEIN_ACTIVITY_MULTIPLIERS).toEqual({
      sedentary: 1.0,
      light: 1.1,
      moderate: 1.27,
      active: 1.45,
      'very-active': 1.64
    })
  })
})
