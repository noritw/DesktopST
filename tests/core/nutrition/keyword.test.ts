import { describe, expect, it } from 'vitest'
import { deriveUsageMetricsFromMealLogs, matchFoodKeyword } from '@core/nutrition'
import { foodItem, mealLog } from './fixtures'

describe('nutrition keyword matching', () => {
  it('ranks exact, prefix, and substring matches in that order', () => {
    const results = matchFoodKeyword('sandwich', [
      foodItem({ id: 'exact', name: 'sandwich', aliases: [] }),
      foodItem({ id: 'prefix', name: 'sandwich box', aliases: [] }),
      foodItem({ id: 'substring', name: '燻雞 sandwich', aliases: [] })
    ])

    expect(results.map((result) => [result.foodItem.id, result.matchScore])).toEqual([
      ['exact', 100],
      ['prefix', 80],
      ['substring', 60]
    ])
  })

  it('matches aliases and sorts equal matches by usage', () => {
    const logs = [
      mealLog({ id: 'meal-1', foodItemId: 'food-a' }),
      mealLog({ id: 'meal-2', foodItemId: 'food-a' })
    ]
    const results = matchFoodKeyword('咖啡', [
      foodItem({ id: 'food-a', name: '拿鐵', aliases: ['咖啡'] }),
      foodItem({ id: 'food-b', name: '冰咖啡', aliases: [] })
    ], logs)

    expect(results.map((result) => result.foodItem.id)).toEqual(['food-a', 'food-b'])
    expect(results[0].displayContext.useCount).toBe(2)
  })

  it('returns no candidates for blank queries and derives usage metrics', () => {
    const logs = [
      mealLog({ id: 'old', eatenAt: 10 }),
      mealLog({ id: 'new', eatenAt: 20 }),
      mealLog({ id: 'other', foodItemId: 'other-food', eatenAt: 30 })
    ]

    expect(matchFoodKeyword('  ', [foodItem()])).toEqual([])
    expect(deriveUsageMetricsFromMealLogs('food-1', logs)).toEqual({
      useCount: 2,
      lastEatenAt: 20
    })
  })
})
