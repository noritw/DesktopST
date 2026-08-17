import { describe, expect, it } from 'vitest'
import { buildDailyView } from '@core/nutrition'
import { foodItem, mealLog } from './fixtures'

describe('nutrition daily view', () => {
  it('resolves the shared food master and multiplies servings', () => {
    const food = foodItem({ name: '燕麥', perServing: { kcal: 300, proteinG: 12 } })
    const logs = [
      mealLog({ id: 'first', servings: 0.5 }),
      mealLog({ id: 'second', servings: 2, eatenAt: new Date(2026, 7, 17, 18, 0).getTime() })
    ]
    const view = buildDailyView(logs, [food], '2026-08-17')

    expect(view.meals.map((meal) => meal.foodItem?.name)).toEqual(['燕麥', '燕麥'])
    expect(view.totalKcal).toBe(750)
    expect(view.totalProteinG).toBe(30)
  })

  it('uses a per-meal override without touching the shared food master', () => {
    const food = foodItem({ name: '燕麥', perServing: { kcal: 300, proteinG: 12 } })
    const logs = [
      mealLog({ id: 'overridden', servings: 2, override: { name: '大燕麥碗', kcal: 350, proteinG: 15 } })
    ]
    const view = buildDailyView(logs, [food], '2026-08-17')

    expect(view.meals[0].name).toBe('大燕麥碗')
    expect(view.meals[0].kcal).toBe(700)
    expect(view.meals[0].proteinG).toBe(30)
    expect(view.meals[0].foodItem?.name).toBe('燕麥')
  })
})
