import { describe, expect, it } from 'vitest'
import { NutritionSession } from '@core/nutrition'
import { createMemoryStorage } from '../../../src/mobile/adapters/memoryStorage'
import { bodyProfile, foodItem, mealLog } from './fixtures'

describe('NutritionSession', () => {
  it('persists food, meal, profile, and settings across boots', async () => {
    const storage = createMemoryStorage()
    const first = await NutritionSession.boot(storage)
    const events: string[] = []
    first.subscribe((event) => events.push(event.kind))

    await first.saveFoodItem(foodItem())
    await first.saveMealLog(mealLog())
    await first.saveBodyProfile(bodyProfile)
    await first.saveSettings({
      llm: { provider: 'local', model: 'qwen3', apiKeys: {} }
    })

    const second = await NutritionSession.boot(storage)
    expect(second.foodItems).toEqual([foodItem()])
    expect(second.mealLogs).toEqual([mealLog()])
    expect(second.bodyProfile).toEqual(bodyProfile)
    expect(second.settings.llm.provider).toBe('local')
    expect(events).toEqual([
      'state-invalidated',
      'state-invalidated',
      'state-invalidated',
      'state-invalidated'
    ])
  })

  it('updates by id instead of creating duplicate records', async () => {
    const storage = createMemoryStorage()
    const session = await NutritionSession.boot(storage)
    await session.saveFoodItem(foodItem())
    await session.saveFoodItem(foodItem({ name: '改名三明治', updatedAt: 2 }))
    await session.saveMealLog(mealLog())
    await session.removeMealLog('meal-1')

    expect(session.foodItems).toHaveLength(1)
    expect(session.foodItems[0].name).toBe('改名三明治')
    expect(session.mealLogs).toEqual([])
  })
})
