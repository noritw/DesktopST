import { describe, expect, it } from 'vitest'
import { applyMigrationPack, buildMigrationPack, collectReferencedPhotoKeys } from '@core/nutrition'
import type { NutritionSnapshot } from '@core/nutrition'
import { DEFAULT_NUTRITION_APP_SETTINGS } from '@core/nutrition'
import { bodyProfile, foodItem, mealLog } from './fixtures'

function snapshot(overrides: Partial<NutritionSnapshot> = {}): NutritionSnapshot {
  return {
    foodItems: [],
    mealLogs: [],
    bodyProfile: null,
    settings: structuredClone(DEFAULT_NUTRITION_APP_SETTINGS),
    ...overrides
  }
}

describe('nutrition migration pack', () => {
  it('bundles referenced photos as base64', () => {
    const food = foodItem({ photoKeys: ['food-photos/food-1/0.webp'] })
    const local = snapshot({ foodItems: [food] })
    const pack = buildMigrationPack(local, new Map([['food-photos/food-1/0.webp', new Uint8Array([1, 2, 3])]]))
    expect(pack.foodItems).toEqual([food])
    expect(Object.keys(pack.photos)).toEqual(['food-photos/food-1/0.webp'])
  })

  it('collects photo keys referenced by both food items and meal logs', () => {
    const food = foodItem({ photoKeys: ['food-photos/food-1/0.webp'] })
    const log = mealLog({ photoKey: 'meal-photos/meal-1.webp' })
    expect(collectReferencedPhotoKeys(snapshot({ foodItems: [food], mealLogs: [log] })).sort()).toEqual([
      'food-photos/food-1/0.webp',
      'meal-photos/meal-1.webp'
    ])
  })

  it('fill-only only adds items missing locally, never touches existing ones', () => {
    const local = snapshot({ foodItems: [foodItem({ name: '本機版本', updatedAt: 5 })] })
    const pack = buildMigrationPack(
      snapshot({ foodItems: [foodItem({ name: '匯入版本', updatedAt: 99 }), foodItem({ id: 'food-2', name: '新食物', updatedAt: 1 })] }),
      new Map()
    )
    const result = applyMigrationPack(local, pack, 'fill-only')
    const byId = new Map(result.snapshot.foodItems.map((item) => [item.id, item]))
    expect(byId.get('food-1')?.name).toBe('本機版本')
    expect(byId.get('food-2')?.name).toBe('新食物')
  })

  it('overwrite takes whichever side has the newer updatedAt, per record', () => {
    const local = snapshot({
      foodItems: [foodItem({ id: 'newer-local', name: '本機比較新', updatedAt: 100 }), foodItem({ id: 'newer-import', name: '本機比較舊', updatedAt: 1 })]
    })
    const pack = buildMigrationPack(
      snapshot({
        foodItems: [foodItem({ id: 'newer-local', name: '匯入比較舊', updatedAt: 1 }), foodItem({ id: 'newer-import', name: '匯入比較新', updatedAt: 100 })]
      }),
      new Map()
    )
    const result = applyMigrationPack(local, pack, 'overwrite')
    const byId = new Map(result.snapshot.foodItems.map((item) => [item.id, item]))
    expect(byId.get('newer-local')?.name).toBe('本機比較新')
    expect(byId.get('newer-import')?.name).toBe('匯入比較新')
  })

  it('only queues photo writes for imported records that actually win the merge', () => {
    const local = snapshot({ foodItems: [foodItem({ updatedAt: 100, photoKeys: [] })] })
    const pack = buildMigrationPack(
      snapshot({ foodItems: [foodItem({ updatedAt: 1, photoKeys: ['food-photos/food-1/0.webp'] })] }),
      new Map([['food-photos/food-1/0.webp', new Uint8Array([9])]])
    )
    const fillOnly = applyMigrationPack(local, pack, 'fill-only')
    expect(fillOnly.photosToWrite).toEqual([])

    const overwrite = applyMigrationPack(local, pack, 'overwrite')
    expect(overwrite.photosToWrite).toEqual([])
  })

  it('never deletes local-only records that are absent from the imported pack', () => {
    const local = snapshot({ foodItems: [foodItem({ id: 'local-only' })] })
    const pack = buildMigrationPack(snapshot(), new Map())
    const result = applyMigrationPack(local, pack, 'overwrite')
    expect(result.snapshot.foodItems.map((item) => item.id)).toEqual(['local-only'])
  })

  it('keeps local API keys when overwriting llm settings', () => {
    const local = snapshot({ settings: { llm: { provider: 'openai', apiKeys: { openai: 'secret' } } } })
    const pack = buildMigrationPack(snapshot({ settings: { llm: { provider: 'local', model: 'qwen3', apiKeys: { local: 'should-not-appear' } } } }), new Map())
    const result = applyMigrationPack(local, pack, 'overwrite')
    expect(result.snapshot.settings.llm.provider).toBe('local')
    expect(result.snapshot.settings.llm.apiKeys).toEqual({ openai: 'secret' })
  })

  it('body profile: fill-only only fills when local has none; overwrite compares updatedAt', () => {
    const importedProfile = { ...bodyProfile, updatedAt: 50, dailyKcalLimit: 1800 }
    const packWithProfile = buildMigrationPack(snapshot({ bodyProfile: importedProfile }), new Map())

    const fillOnlyResult = applyMigrationPack(snapshot({ bodyProfile: { ...bodyProfile, updatedAt: 5 } }), packWithProfile, 'fill-only')
    expect(fillOnlyResult.snapshot.bodyProfile?.dailyKcalLimit).toBe(bodyProfile.dailyKcalLimit)

    const overwriteOlderLocal = applyMigrationPack(snapshot({ bodyProfile: { ...bodyProfile, updatedAt: 5 } }), packWithProfile, 'overwrite')
    expect(overwriteOlderLocal.snapshot.bodyProfile?.dailyKcalLimit).toBe(1800)

    const overwriteNewerLocal = applyMigrationPack(snapshot({ bodyProfile: { ...bodyProfile, updatedAt: 999 } }), packWithProfile, 'overwrite')
    expect(overwriteNewerLocal.snapshot.bodyProfile?.dailyKcalLimit).toBe(bodyProfile.dailyKcalLimit)
  })
})
