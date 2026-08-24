import type { StorageAdapter } from '../adapters'
import type { FoodItem, MealLog, NutritionAppSettings, BodyProfile } from './types'

export const NUTRITION_STORAGE_KEYS = {
  bodyProfile: 'body-profile.json',
  foodItems: 'food-items.json',
  mealLogs: 'meal-logs.json',
  settings: 'settings.json',
  burnedKcalHistory: 'burned-kcal-history.json'
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
  /**
   * 每日總消耗（Health Connect／手錶），isoDate → kcal。只有手機會寫入
   * （桌面沒有 Health Connect），但兩邊都要能讀寫這個欄位——桌面的統計頁
   * 要靠搬家包把這份資料帶過去才有消耗可以算，不然永遠只有攝取。
   */
  burnedKcalHistory: Record<string, number>
}

export async function loadNutritionSnapshot(storage: StorageAdapter): Promise<NutritionSnapshot> {
  const [foodItems, mealLogs, bodyProfile, settings, burnedKcalHistory] = await Promise.all([
    storage.readJson<Array<FoodItem & { store?: string }>>(NUTRITION_STORAGE_KEYS.foodItems),
    storage.readJson<MealLog[]>(NUTRITION_STORAGE_KEYS.mealLogs),
    storage.readJson<BodyProfile>(NUTRITION_STORAGE_KEYS.bodyProfile),
    storage.readJson<NutritionAppSettings>(NUTRITION_STORAGE_KEYS.settings),
    storage.readJson<Record<string, number>>(NUTRITION_STORAGE_KEYS.burnedKcalHistory)
  ])
  return {
    foodItems: Array.isArray(foodItems) ? foodItems.map(normalizeFoodItem) : [],
    mealLogs: Array.isArray(mealLogs) ? mealLogs : [],
    bodyProfile: bodyProfile ?? null,
    settings: settings ? normalizeSettings(settings) : structuredClone(DEFAULT_NUTRITION_APP_SETTINGS),
    burnedKcalHistory: burnedKcalHistory && typeof burnedKcalHistory === 'object' ? burnedKcalHistory : {}
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
      endpoints: settings.llm?.endpoints ? { ...settings.llm.endpoints } : undefined,
      apiKeys: { ...(settings.llm?.apiKeys ?? {}) }
    },
    // 舊資料沒有 health 欄位時保持 undefined（等同全部關閉），不要無中生有補一個全 false 物件——
    // 呼叫端讀取 settings.health?.connected 之類的寫法本來就要處理 undefined。
    health: settings.health
      ? {
          connected: settings.health.connected ?? false,
          autoSync: settings.health.autoSync ?? false,
          useWatchCalorieLimit: settings.health.useWatchCalorieLimit ?? false,
          writeCalories: settings.health.writeCalories ?? false
        }
      : undefined,
    // 這個函式過去只手動列出 llm／health 兩個欄位，之後每加一個新的頂層設定
    // （showWeightBadge、photoEstimate）都要記得跟著補，否則讀回來就悄悄消失
    // （2026-08-19 發現 showWeightBadge 已經踩到這個坑，一併修掉）。
    showWeightBadge: settings.showWeightBadge,
    colorTheme: settings.colorTheme,
    widgetAppearance: settings.widgetAppearance
      ? {
          theme: typeof settings.widgetAppearance.theme === 'string' ? settings.widgetAppearance.theme : null,
          bgOpacity: Number.isFinite(settings.widgetAppearance.bgOpacity)
            ? Math.min(100, Math.max(0, Math.round(settings.widgetAppearance.bgOpacity)))
            : 100
        }
      : undefined,
    photoEstimate: settings.photoEstimate
      ? {
          enabled: settings.photoEstimate.enabled ?? false,
          scaleReference: settings.photoEstimate.scaleReference
        }
      : undefined
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
    storage.writeJson(NUTRITION_STORAGE_KEYS.settings, snapshot.settings),
    storage.writeJson(NUTRITION_STORAGE_KEYS.burnedKcalHistory, snapshot.burnedKcalHistory)
  ])
}
