import { describe, expect, it } from 'vitest'
import { foodPhotoKey, mealPhotoKey, nextFreeFoodPhotoIndex } from '@core/nutrition'

describe('nutrition photo keys', () => {
  it('builds stable per-food, indexed photo keys', () => {
    expect(foodPhotoKey('food-1', 0)).toBe('food-photos/food-1/0.webp')
    expect(foodPhotoKey('food-1', 2)).toBe('food-photos/food-1/2.webp')
  })

  it('builds a single meal photo key', () => {
    expect(mealPhotoKey('meal-1')).toBe('meal-photos/meal-1.webp')
  })

  it('picks the first unused index instead of the current count', () => {
    expect(nextFreeFoodPhotoIndex('food-1', [])).toBe(0)
    expect(nextFreeFoodPhotoIndex('food-1', ['food-photos/food-1/0.webp'])).toBe(1)
    // 刪掉 index 0 之後只剩 1.webp：目前張數是 1，但 1.webp 已經被佔用，正確答案是 0。
    expect(nextFreeFoodPhotoIndex('food-1', ['food-photos/food-1/1.webp'])).toBe(0)
  })
})
