import type { NutritionActivityLevel } from './types'

export const ACTIVITY_LEVEL_MULTIPLIERS: Record<NutritionActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  'very-active': 1.9
}

/**
 * 規格目前沒有性別欄位，因此採性別中性的 Mifflin 基礎式。
 * dailyKcalLimit 是使用者可編的值，呼叫端只應把這個結果當建議。
 */
export function calculateTdeeKcal(profile: {
  heightCm: number
  weightKg: number
  ageYears: number
  activityLevel: NutritionActivityLevel
}): number {
  const bmr = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.ageYears
  return Math.round(bmr * ACTIVITY_LEVEL_MULTIPLIERS[profile.activityLevel])
}
