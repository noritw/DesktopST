import { describe, expect, it } from 'vitest'
import { foodPhotoKey, mealPhotoKey } from '@core/nutrition'

describe('nutrition photo keys', () => {
  it('builds stable per-food, indexed photo keys', () => {
    expect(foodPhotoKey('food-1', 0)).toBe('food-photos/food-1/0.webp')
    expect(foodPhotoKey('food-1', 2)).toBe('food-photos/food-1/2.webp')
  })

  it('builds a single meal photo key', () => {
    expect(mealPhotoKey('meal-1')).toBe('meal-photos/meal-1.webp')
  })
})
