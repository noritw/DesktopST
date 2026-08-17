import type { BodyProfile, FoodItem, MealLog } from './types'

export interface DailyNutritionSummary {
  isoDate: string
  mealCount: number
  totalKcal: number
  totalProteinG: number
  mealsByTime: MealLog[]
  isExceededKcal: boolean
  isExceededProtein: boolean
}

export interface PeriodNutritionSummary {
  startIsoDate: string
  endIsoDate: string
  dayCount: number
  totalKcal: number
  totalProteinG: number
  averageKcalPerDay: number
  averageProteinPerDay: number
}

export function toIsoDateString(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseIsoDateToStartOfDayMs(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, month - 1, day).getTime()
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(parseIsoDateToStartOfDayMs(isoDate))
  date.setDate(date.getDate() + days)
  return toIsoDateString(date.getTime())
}

function dayDistance(startIsoDate: string, endIsoDate: string): number {
  const start = parseIsoDateToStartOfDayMs(startIsoDate)
  const end = parseIsoDateToStartOfDayMs(endIsoDate)
  return Math.round((end - start) / 86_400_000)
}

export function groupMealLogsByDay(mealLogs: MealLog[]): Map<string, MealLog[]> {
  const grouped = new Map<string, MealLog[]>()
  for (const mealLog of mealLogs) {
    const isoDate = toIsoDateString(mealLog.eatenAt)
    const logs = grouped.get(isoDate) ?? []
    logs.push(mealLog)
    grouped.set(isoDate, logs)
  }
  for (const logs of grouped.values()) logs.sort((a, b) => a.eatenAt - b.eatenAt)
  return grouped
}

function sumLogs(mealLogs: MealLog[], foodItems: Map<string, FoodItem>): { totalKcal: number; totalProteinG: number } {
  return mealLogs.reduce(
    (sum, mealLog) => {
      const foodItem = foodItems.get(mealLog.foodItemId)
      const perServingKcal = mealLog.override?.kcal ?? foodItem?.perServing.kcal
      const perServingProteinG = mealLog.override?.proteinG ?? foodItem?.perServing.proteinG
      if (perServingKcal === undefined && perServingProteinG === undefined) return sum
      sum.totalKcal += (perServingKcal ?? 0) * mealLog.servings
      sum.totalProteinG += (perServingProteinG ?? 0) * mealLog.servings
      return sum
    },
    { totalKcal: 0, totalProteinG: 0 }
  )
}

export function aggregateDailyNutrition(
  mealLogs: MealLog[],
  foodItems: Map<string, FoodItem>,
  bodyProfile: BodyProfile,
  isoDate: string
): DailyNutritionSummary {
  const mealsByTime = (groupMealLogsByDay(mealLogs).get(isoDate) ?? []).slice()
  const totals = sumLogs(mealsByTime, foodItems)
  return {
    isoDate,
    mealCount: mealsByTime.length,
    ...totals,
    mealsByTime,
    isExceededKcal: totals.totalKcal > bodyProfile.dailyKcalLimit,
    isExceededProtein: totals.totalProteinG > bodyProfile.dailyProteinGoalG
  }
}

function aggregatePeriod(
  mealLogs: MealLog[],
  foodItems: Map<string, FoodItem>,
  startIsoDate: string,
  endIsoDate: string
): PeriodNutritionSummary {
  const dayCount = Math.max(0, dayDistance(startIsoDate, endIsoDate) + 1)
  const grouped = groupMealLogsByDay(mealLogs)
  let totalKcal = 0
  let totalProteinG = 0
  for (let index = 0; index < dayCount; index++) {
    const totals = sumLogs(grouped.get(addDays(startIsoDate, index)) ?? [], foodItems)
    totalKcal += totals.totalKcal
    totalProteinG += totals.totalProteinG
  }
  return {
    startIsoDate,
    endIsoDate,
    dayCount,
    totalKcal,
    totalProteinG,
    averageKcalPerDay: dayCount > 0 ? totalKcal / dayCount : 0,
    averageProteinPerDay: dayCount > 0 ? totalProteinG / dayCount : 0
  }
}

export function aggregateWeeklyNutrition(
  mealLogs: MealLog[],
  foodItems: Map<string, FoodItem>,
  endIsoDate: string
): PeriodNutritionSummary {
  return aggregatePeriod(mealLogs, foodItems, addDays(endIsoDate, -6), endIsoDate)
}

export function aggregateMonthlyNutrition(
  mealLogs: MealLog[],
  foodItems: Map<string, FoodItem>,
  yearMonth: string
): PeriodNutritionSummary {
  const [year, month] = yearMonth.split('-').map(Number)
  const startIsoDate = `${yearMonth}-01`
  const endIsoDate = toIsoDateString(new Date(year, month, 0).getTime())
  return aggregatePeriod(mealLogs, foodItems, startIsoDate, endIsoDate)
}
