import { describe, expect, it } from 'vitest'
import { buildFoodUsageIndex, foodUsageOf } from '@core/nutrition'
import { mealLog } from './fixtures'

describe('buildFoodUsageIndex', () => {
  it('數出每筆食物被幾筆餐次引用，並記下最後一次食用時間', () => {
    const older = new Date(2026, 7, 16, 8, 0).getTime()
    const newer = new Date(2026, 7, 18, 19, 30).getTime()
    const index = buildFoodUsageIndex([
      mealLog({ id: 'm1', foodItemId: 'food-1', eatenAt: newer }),
      mealLog({ id: 'm2', foodItemId: 'food-1', eatenAt: older }),
      mealLog({ id: 'm3', foodItemId: 'food-2', eatenAt: older })
    ])

    expect(foodUsageOf(index, 'food-1')).toEqual({ useCount: 2, lastEatenAt: newer })
    expect(foodUsageOf(index, 'food-2')).toEqual({ useCount: 1, lastEatenAt: older })
  })

  it('沒有被任何餐次引用的食物回傳 0 次（可以安心刪除）', () => {
    const index = buildFoodUsageIndex([])
    expect(foodUsageOf(index, 'food-1')).toEqual({ useCount: 0 })
  })
})
