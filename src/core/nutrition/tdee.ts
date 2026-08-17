import type { NutritionActivityLevel, NutritionGoal } from './types'

export const ACTIVITY_LEVEL_MULTIPLIERS: Record<NutritionActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  'very-active': 1.9
}

/**
 * 目標熱量調整係數，套用在 TDEE 上得出建議的每日熱量上限。
 * 數值為常見經驗法則（約 10~15% 的赤字／盈餘），非醫療處方。
 */
export const GOAL_KCAL_ADJUSTMENT_RATIO: Record<NutritionGoal, number> = {
  'lose-weight': 0.85,
  'gain-muscle': 0.9,
  maintain: 1.0,
  'gain-weight': 1.1
}

/**
 * 蛋白質基礎需求量（g/kg/日），依衛福部國健署《國人膳食營養素參考攝取量》第八版：
 * 19～69 歲成人約 1.1 g/kg/日；70 歲以上提高至約 1.2 g/kg/日。
 */
function proteinBaseRatioPerKg(ageYears: number): number {
  return ageYears >= 70 ? 1.2 : 1.1
}

/**
 * 活動量對蛋白質需求的加成係數。規律運動／重訓者建議量落在 1.4~2.0 g/kg/日，
 * 這裡把官方基礎值（約 1.1 g/kg）依活動等級往上調到落在該區間內。
 */
export const PROTEIN_ACTIVITY_MULTIPLIERS: Record<NutritionActivityLevel, number> = {
  sedentary: 1.0,
  light: 1.1,
  moderate: 1.27,
  active: 1.45,
  'very-active': 1.64
}

/**
 * 計算基礎代謝率 (BMR)。
 * 優先用 Katch-McArdle 公式（需要體脂率）；無體脂率時退回 Mifflin-St Jeor（含性別係數）。
 */
export function calculateBmr(profile: {
  heightCm: number
  weightKg: number
  ageYears: number
  sex: 'male' | 'female'
  bodyFatPercent?: number
}): number {
  // 優先：有體脂率時用 Katch-McArdle（更精準）
  if (profile.bodyFatPercent !== undefined && profile.bodyFatPercent >= 0 && profile.bodyFatPercent < 100) {
    const lbm = profile.weightKg * (1 - profile.bodyFatPercent / 100)
    return Math.round(370 + 21.6 * lbm)
  }

  // 退回：Mifflin-St Jeor（性別版本）
  const bmr = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.ageYears
    + (profile.sex === 'male' ? 5 : -161)
  return Math.round(bmr)
}

/**
 * 計算每日總消耗熱量 (TDEE = BMR × 活動倍數)。
 * dailyKcalLimit 是使用者可編的值，呼叫端只應把這個結果當建議。
 */
export function calculateTdeeKcal(profile: {
  heightCm: number
  weightKg: number
  ageYears: number
  sex: 'male' | 'female'
  bodyFatPercent?: number
  activityLevel: NutritionActivityLevel
}): number {
  const bmr = calculateBmr(profile)
  return Math.round(bmr * ACTIVITY_LEVEL_MULTIPLIERS[profile.activityLevel])
}

/**
 * 依目標把 TDEE 換算成建議的每日熱量上限（減重打折、增重加成、維持不變）。
 * 僅供參考，使用者應依實際狀況手動調整。
 */
export function calculateGoalAdjustedKcal(tdeeKcal: number, goal: NutritionGoal): number {
  return Math.round(tdeeKcal * GOAL_KCAL_ADJUSTMENT_RATIO[goal])
}

/**
 * 計算每日蛋白質建議量（g）＝ 體重 × 年齡基礎值 × 活動量係數。
 * 資料來源：衛生福利部國民健康署《國人膳食營養素參考攝取量》第八版（成人基礎值）；
 * 活動量加成參考一般重訓／規律運動族群建議區間（1.4~2.0 g/kg/日）。
 * 僅供參考，非醫療或營養專業建議；腎臟病、肝病等需限制蛋白質者請諮詢醫師或營養師。
 */
export function calculateProteinGoalG(profile: {
  weightKg: number
  ageYears: number
  activityLevel: NutritionActivityLevel
}): number {
  const base = profile.weightKg * proteinBaseRatioPerKg(profile.ageYears)
  return Math.round(base * PROTEIN_ACTIVITY_MULTIPLIERS[profile.activityLevel])
}
