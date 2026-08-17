import type { StorageAdapter } from '../adapters'
import type { FoodItem, MealLog, NutritionAppSettings, BodyProfile } from './types'

export const NUTRITION_STORAGE_KEYS = {
  bodyProfile: 'body-profile.json',
  foodItems: 'food-items.json',
  mealLogs: 'meal-logs.json',
  settings: 'settings.json'
} as const

export const DEFAULT_NUTRITION_APP_SETTINGS: NutritionAppSettings = {
  llm: {
    provider: 'openai',
    apiKeys: {}
  }
}

export interface NutritionSnapshot {
  foodItems: FoodItem[]
  mealLogs: MealLog[]
  bodyProfile: BodyProfile | null
  settings: NutritionAppSettings
}

export async function loadNutritionSnapshot(storage: StorageAdapter): Promise<NutritionSnapshot> {
  const [foodItems, mealLogs, bodyProfile, settings] = await Promise.all([
    storage.readJson<Array<FoodItem & { store?: string }>>(NUTRITION_STORAGE_KEYS.foodItems),
    storage.readJson<MealLog[]>(NUTRITION_STORAGE_KEYS.mealLogs),
    storage.readJson<BodyProfile>(NUTRITION_STORAGE_KEYS.bodyProfile),
    storage.readJson<NutritionAppSettings>(NUTRITION_STORAGE_KEYS.settings)
  ])
  return {
    foodItems: Array.isArray(foodItems) ? foodItems.map(normalizeFoodItem) : [],
    mealLogs: Array.isArray(mealLogs) ? mealLogs : [],
    bodyProfile: bodyProfile ?? null,
    settings: settings ? normalizeSettings(settings) : structuredClone(DEFAULT_NUTRITION_APP_SETTINGS)
  }
}

/** 舊版本別開存 brand／store，合一欄後舊資料還是要能顯示。 */
function normalizeFoodItem(raw: FoodItem & { store?: string }): FoodItem {
  const { store, ...rest } = raw
  return { ...rest, brand: rest.brand ?? store }
}

function normalizeSettings(settings: NutritionAppSettings): NutritionAppSettings {
  return {
    llm: {
      provider: settings.llm?.provider || DEFAULT_NUTRITION_APP_SETTINGS.llm.provider,
      model: settings.llm?.model,
      endpoint: settings.llm?.endpoint,
      apiKeys: { ...(settings.llm?.apiKeys ?? {}) }
    }
  }
}

export async function saveNutritionSnapshot(
  storage: StorageAdapter,
  snapshot: NutritionSnapshot
): Promise<void> {
  await Promise.all([
    storage.writeJson(NUTRITION_STORAGE_KEYS.foodItems, snapshot.foodItems),
    storage.writeJson(NUTRITION_STORAGE_KEYS.mealLogs, snapshot.mealLogs),
    storage.writeJson(NUTRITION_STORAGE_KEYS.bodyProfile, snapshot.bodyProfile),
    storage.writeJson(NUTRITION_STORAGE_KEYS.settings, snapshot.settings)
  ])
}
