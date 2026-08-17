import { describe, expect, it } from 'vitest'
import { loadNutritionSnapshot } from '@core/nutrition'
import { createMemoryStorage } from '../../../src/mobile/adapters/memoryStorage'

describe('nutrition storage migration', () => {
  it('migrates legacy per-item store into the merged brand field', async () => {
    const storage = createMemoryStorage()
    await storage.writeJson('food-items.json', [
      { id: 'food-1', name: '拿鐵', aliases: [], perServing: { kcal: 200, proteinG: 8 }, photoKeys: [], source: 'user', store: '7-11', createdAt: 1, updatedAt: 1 }
    ])

    const snapshot = await loadNutritionSnapshot(storage)

    expect(snapshot.foodItems[0].brand).toBe('7-11')
    expect(snapshot.foodItems[0]).not.toHaveProperty('store')
  })

  it('prefers an existing brand over the legacy store value', async () => {
    const storage = createMemoryStorage()
    await storage.writeJson('food-items.json', [
      { id: 'food-1', name: '拿鐵', aliases: [], brand: '星巴克', perServing: { kcal: 200, proteinG: 8 }, photoKeys: [], source: 'user', store: '7-11', createdAt: 1, updatedAt: 1 }
    ])

    const snapshot = await loadNutritionSnapshot(storage)

    expect(snapshot.foodItems[0].brand).toBe('星巴克')
  })
})
