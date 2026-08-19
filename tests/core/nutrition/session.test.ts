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

  it('cleans up photo files when the owning food or meal log is removed', async () => {
    const storage = createMemoryStorage()
    const session = await NutritionSession.boot(storage)
    await storage.writeBinary('food-photos/food-1/0.webp', new Uint8Array([1]))
    await storage.writeBinary('meal-photos/meal-1.webp', new Uint8Array([2]))
    await session.saveFoodItem(foodItem({ photoKeys: ['food-photos/food-1/0.webp'] }))
    await session.saveMealLog(mealLog({ photoKey: 'meal-photos/meal-1.webp' }))

    await session.removeFoodItem('food-1')
    expect(await storage.exists('food-photos/food-1/0.webp')).toBe(false)

    await session.removeMealLog('meal-1')
    expect(await storage.exists('meal-photos/meal-1.webp')).toBe(false)
  })

  it('replaceSnapshot overwrites everything in one persist, for migration-pack imports', async () => {
    const storage = createMemoryStorage()
    const session = await NutritionSession.boot(storage)
    await session.saveFoodItem(foodItem())
    const events: string[] = []
    session.subscribe((event) => events.push(event.kind))

    await session.replaceSnapshot({
      foodItems: [foodItem({ id: 'food-2', name: '匯入食物' })],
      mealLogs: [mealLog()],
      bodyProfile,
      settings: session.settings
    })

    expect(session.foodItems.map((item) => item.id)).toEqual(['food-2'])
    expect(session.mealLogs).toEqual([mealLog()])
    expect(session.bodyProfile).toEqual(bodyProfile)
    expect(events).toEqual(['state-invalidated'])
  })

  it('duplicateFoodItem creates a new food with copied data and photos', async () => {
    const storage = createMemoryStorage()
    const session = await NutritionSession.boot(storage)
    const original = foodItem({ id: 'food-1', name: '三明治' })
    await session.saveFoodItem(original)

    // 寫入照片
    const photoData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    await storage.writeBinary('food-photos/food-1/0.webp', photoData)
    const withPhoto = foodItem({ id: 'food-1', name: '三明治', photoKeys: ['food-photos/food-1/0.webp'] as any })
    await session.saveFoodItem(withPhoto)

    const events: string[] = []
    session.subscribe((event) => events.push(event.kind))

    const duplicated = await session.duplicateFoodItem('food-1', 'food-999')

    expect(duplicated).not.toBeNull()
    expect(duplicated?.id).toBe('food-999')
    expect(duplicated?.name).toBe('三明治')
    expect(duplicated?.aliases).toEqual(original.aliases)
    expect(duplicated?.brand).toEqual(original.brand)
    expect(duplicated?.perServing).toEqual(original.perServing)
    expect(duplicated?.createdAt).not.toBe(original.createdAt) // 新的時間戳
    expect(duplicated?.photoKeys).toHaveLength(1)
    expect(duplicated?.photoKeys[0]).toBe('food-photos/food-999/0.webp')

    // 驗證照片也複製過來了
    const copiedPhotoData = await storage.readBinary('food-photos/food-999/0.webp')
    expect(copiedPhotoData).toEqual(photoData)

    // 驗證加入食物庫清單
    expect(session.foodItems).toHaveLength(2)
    expect(session.foodItems.find((item) => item.id === 'food-999')).toBeDefined()
    expect(events).toEqual(['state-invalidated'])
  })

  it('duplicateFoodItem returns null if food does not exist', async () => {
    const storage = createMemoryStorage()
    const session = await NutritionSession.boot(storage)

    const result = await session.duplicateFoodItem('nonexistent', 'food-999')
    expect(result).toBeNull()
    expect(session.foodItems).toHaveLength(0)
  })
})
