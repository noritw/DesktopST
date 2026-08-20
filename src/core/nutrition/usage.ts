import type { MealLog } from './types'

/** 某筆食物主檔被幾筆 `MealLog` 引用、上次吃是什麼時候。 */
export interface FoodUsage {
  useCount: number
  lastEatenAt?: number
}

/**
 * 一次掃過所有餐次，算出每筆食物的引用次數與上次食用時間
 * （`deriveUsageMetricsFromMealLogs` 是單筆版，逐筆呼叫會變 O(食物 × 餐次)）。
 *
 * 刻意**不**讀 `FoodItem.useCount` 這個快取欄位：食物庫要用這個數字判斷
 * 「這筆能不能刪」，就必須是當下餐次的真實聚合，不能是可能過期的快取
 * （規格 §3.2b：引用次數由 MealLog 聚合算出）。
 */
export function buildFoodUsageIndex(mealLogs: MealLog[]): Map<string, FoodUsage> {
  const index = new Map<string, FoodUsage>()
  for (const mealLog of mealLogs) {
    const current = index.get(mealLog.foodItemId)
    if (!current) {
      index.set(mealLog.foodItemId, { useCount: 1, lastEatenAt: mealLog.eatenAt })
    } else {
      current.useCount += 1
      if (current.lastEatenAt === undefined || mealLog.eatenAt > current.lastEatenAt) {
        current.lastEatenAt = mealLog.eatenAt
      }
    }
  }
  return index
}

export function foodUsageOf(index: Map<string, FoodUsage>, foodItemId: string): FoodUsage {
  return index.get(foodItemId) ?? { useCount: 0 }
}
