import type { HealthSnapshot } from '../adapters'
import type { BodyProfile } from './types'
import { toIsoDateString, parseIsoDateToStartOfDayMs } from './aggregation'
import { calculateBmr } from './tdee'

const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 24 * MS_PER_HOUR

/**
 * 開關 3（「以手錶消耗熱量做為當日上限」）開啟時的今日動態熱量上限。
 *
 * 公式（owner 原話，見 `docs/nutrition-health-lite-kickoff.md` §5.1）：
 *   今日動態上限 = 今天已消耗的熱量（Health Connect 累計值，到查詢當下為止）
 *                + 今天剩餘時間（到隔日 00:00）× 靜止代謝率的每小時消耗量
 *
 * 刻意不套用 `activityLevel` 活動量乘數、也不套用 `calculateGoalAdjustedKcal()`
 * 的目標調整比例——owner 的算法是直接把「已消耗＋預計靜止消耗」當上限。
 * 如果之後要加目標調整，須先跟 owner 確認，不要自己加一層。
 *
 * `now` 用參數注入，不要在這裡呼叫 `Date.now()`（可測、跟現有慣例一致）。
 *
 * 回傳 `null` 的情況（呼叫端應退回顯示 `bodyProfile.dailyKcalLimit`）：
 * - `healthSnapshot.caloriesBurnedSoFarToday` 缺欄位（查不到資料或沒授權）
 * - `healthSnapshot.measuredAt` 不是「今天」（裝置本地時區）——資料是舊的，
 *   不能拿昨天以前的量測值當「今日」動態上限用
 */
export function suggestTodayKcalLimit(
  bodyProfile: BodyProfile,
  healthSnapshot: HealthSnapshot,
  now: number
): number | null {
  if (healthSnapshot.caloriesBurnedSoFarToday === undefined) return null
  if (toIsoDateString(healthSnapshot.measuredAt) !== toIsoDateString(now)) return null

  const startOfTodayMs = parseIsoDateToStartOfDayMs(toIsoDateString(now))
  const startOfTomorrowMs = startOfTodayMs + MS_PER_DAY
  const hoursRemaining = Math.max(0, (startOfTomorrowMs - now) / MS_PER_HOUR)

  const restingKcalPerHour = calculateBmr(bodyProfile) / 24
  return Math.round(healthSnapshot.caloriesBurnedSoFarToday + hoursRemaining * restingKcalPerHour)
}
