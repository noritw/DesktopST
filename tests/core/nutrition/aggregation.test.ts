import { describe, expect, it } from 'vitest'
import {
  aggregateDailyNutrition,
  aggregateMonthlyNutrition,
  aggregateWeeklyNutrition,
  groupMealLogsByDay,
  toIsoDateString
} from '@core/nutrition'
import { bodyProfile, foodItem, mealLog } from './fixtures'

describe('nutrition aggregation', () => {
  const sandwich = foodItem({ perServing: { kcal: 400, proteinG: 25 } })
  const fruit = foodItem({ id: 'food-2', name: '香蕉', perServing: { kcal: 100, proteinG: 1 } })
  const foodItems = new Map([sandwich, fruit].map((food) => [food.id, food]))
  const logs = [
    mealLog({ id: 'morning', eatenAt: new Date(2026, 7, 17, 8, 0).getTime(), servings: 0.5 }),
    mealLog({ id: 'noon', eatenAt: new Date(2026, 7, 17, 12, 0).getTime(), servings: 1 }),
    mealLog({ id: 'fruit', foodItemId: 'food-2', eatenAt: new Date(2026, 7, 18, 9, 0).getTime() }),
    mealLog({ id: 'missing', foodItemId: 'deleted', eatenAt: new Date(2026, 7, 17, 20, 0).getTime() })
  ]

  it('groups by local calendar date and sorts meals by time', () => {
    expect(toIsoDateString(new Date(2026, 7, 17, 23, 30).getTime())).toBe('2026-08-17')
    const grouped = groupMealLogsByDay(logs)
    expect([...grouped.keys()]).toEqual(['2026-08-17', '2026-08-18'])
    expect(grouped.get('2026-08-17')?.map((log) => log.id)).toEqual(['morning', 'noon', 'missing'])
  })

  it('calculates daily totals from the shared food master and flags limits', () => {
    expect(aggregateDailyNutrition(logs, foodItems, bodyProfile, '2026-08-17')).toEqual({
      isoDate: '2026-08-17',
      mealCount: 3,
      totalKcal: 600,
      totalProteinG: 38,
      mealsByTime: [logs[0], logs[1], logs[3]],
      isExceededKcal: false,
      isExceededProtein: false
    })
  })

  it('includes empty days in weekly and monthly averages', () => {
    const weekly = aggregateWeeklyNutrition(logs, foodItems, '2026-08-23')
    expect(weekly.dayCount).toBe(7)
    expect(weekly.totalKcal).toBe(700)
    expect(weekly.averageKcalPerDay).toBe(100)

    const monthly = aggregateMonthlyNutrition(logs, foodItems, '2026-08')
    expect(monthly.startIsoDate).toBe('2026-08-01')
    expect(monthly.endIsoDate).toBe('2026-08-31')
    expect(monthly.dayCount).toBe(31)
    expect(monthly.totalProteinG).toBe(39)
  })
})
