import type { FoodItem, MealLog } from './types'
import { toIsoDateString } from './aggregation'

export interface DailyMealView {
  mealLog: MealLog
  foodItem: FoodItem | null
  /** \u5df2\u5957\u7528\u55ae\u7b46\u8986\u5beb\u5f8c\u7684\u986f\u793a\u540d\u7a31\uff08\u6c92\u8986\u5beb\u5c31\u662f\u98df\u7269\u4e3b\u6a94\u7684\u540d\u7a31\uff09\u3002 */
  name: string
  kcal: number
  proteinG: number
}

export interface DailyView {
  isoDate: string
  meals: DailyMealView[]
  totalKcal: number
  totalProteinG: number
}

export function buildDailyView(
  mealLogs: MealLog[],
  foodItems: FoodItem[],
  isoDate: string
): DailyView {
  const foodById = new Map(foodItems.map((foodItem) => [foodItem.id, foodItem]))
  const meals = mealLogs
    .filter((mealLog) => toIsoDateString(mealLog.eatenAt) === isoDate)
    .sort((a, b) => a.eatenAt - b.eatenAt)
    .map((mealLog) => {
      const foodItem = foodById.get(mealLog.foodItemId) ?? null
      const perServingKcal = mealLog.override?.kcal ?? foodItem?.perServing.kcal
      const perServingProteinG = mealLog.override?.proteinG ?? foodItem?.perServing.proteinG
      return {
        mealLog,
        foodItem,
        name: mealLog.override?.name ?? foodItem?.name ?? '已刪除的食物',
        kcal: perServingKcal !== undefined ? perServingKcal * mealLog.servings : 0,
        proteinG: perServingProteinG !== undefined ? perServingProteinG * mealLog.servings : 0
      }
    })

  return {
    isoDate,
    meals,
    totalKcal: meals.reduce((total, meal) => total + meal.kcal, 0),
    totalProteinG: meals.reduce((total, meal) => total + meal.proteinG, 0)
  }
}
