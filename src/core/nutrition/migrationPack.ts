import type { BodyProfile, FoodItem, MealLog, NutritionAppSettings, NutritionLlmSettings } from './types'
import type { NutritionSnapshot } from './storage'
import { bytesToBase64, base64ToBytes } from '../util/base64'

/**
 * 手機／桌面各自獨立運作（B9a 決議，見 nutrition-module-kickoff.md §3.2），
 * 換機或想讓兩邊資料一致靠這份搬家包手動匯出／匯入，不是背景即時同步。
 * 不含 API Key（跟角色卡搬家包同一個原則）。
 */
export const NUTRITION_PACK_VERSION = 2
export const NUTRITION_PACK_EXTENSION = '.destnutrition'

export type NutritionSettingsPack = Omit<NutritionLlmSettings, 'apiKeys'>

export interface NutritionMigrationPack {
  version: number
  exportedAt: number
  foodItems: FoodItem[]
  mealLogs: MealLog[]
  bodyProfile: BodyProfile | null
  llmSettings: NutritionSettingsPack
  /** photoKey → base64 內容，涵蓋 foodItems／mealLogs 目前參照到的每一張照片。 */
  photos: Record<string, string>
  /**
   * 每日總消耗（Health Connect），isoDate → kcal（v1 的舊搬家包沒有這個欄位，
   * 讀取端要當成 `{}` 處理，不要假設一定存在）。桌面沒有 Health Connect，
   * 靠這個欄位才能在統計頁算出消耗與淨值。
   */
  burnedKcalHistory: Record<string, number>
}

export type MigrationMergeMode = 'fill-only' | 'overwrite'

export interface ApplyMigrationPackResult {
  snapshot: NutritionSnapshot
  /** 因為合併而需要真的寫進儲存空間的照片（key 對應 pack.photos 裡的 base64）。 */
  photosToWrite: Array<{ key: string; bytes: Uint8Array }>
}

export function buildMigrationPack(
  snapshot: NutritionSnapshot,
  photoBytes: ReadonlyMap<string, Uint8Array>
): NutritionMigrationPack {
  const photos: Record<string, string> = {}
  for (const [key, bytes] of photoBytes) photos[key] = bytesToBase64(bytes)
  return {
    version: NUTRITION_PACK_VERSION,
    exportedAt: Date.now(),
    foodItems: snapshot.foodItems,
    mealLogs: snapshot.mealLogs,
    bodyProfile: snapshot.bodyProfile,
    llmSettings: { provider: snapshot.settings.llm.provider, model: snapshot.settings.llm.model, endpoints: snapshot.settings.llm.endpoints },
    photos,
    burnedKcalHistory: snapshot.burnedKcalHistory
  }
}

/** 搜集一個 snapshot 目前實際參照到的所有照片 key（食物庫照片＋餐次照片）。 */
export function collectReferencedPhotoKeys(snapshot: NutritionSnapshot): string[] {
  const keys = new Set<string>()
  for (const foodItem of snapshot.foodItems) for (const key of foodItem.photoKeys) keys.add(key)
  for (const mealLog of snapshot.mealLogs) if (mealLog.photoKey) keys.add(mealLog.photoKey)
  return [...keys]
}

function mergeById<T extends { id: string; updatedAt: number }>(
  localItems: readonly T[],
  importedItems: readonly T[],
  mode: MigrationMergeMode,
  onImportedWins: (item: T) => void
): T[] {
  const localById = new Map(localItems.map((item) => [item.id, item]))
  const result: T[] = []
  const seenIds = new Set<string>()

  for (const imported of importedItems) {
    seenIds.add(imported.id)
    const local = localById.get(imported.id)
    if (!local) {
      result.push(imported)
      onImportedWins(imported)
      continue
    }
    if (mode === 'overwrite' && imported.updatedAt >= local.updatedAt) {
      result.push(imported)
      onImportedWins(imported)
    } else {
      result.push(local)
    }
  }
  for (const local of localItems) if (!seenIds.has(local.id)) result.push(local)
  return result
}

/**
 * fill-only：只補本機沒有的資料，本機既有的一律不動（安全、不會蓋掉本機新做的修改）。
 * overwrite：同 id 比較 updatedAt，較新的贏（含本機比較新時保留本機）。
 * 兩種模式都不會刪除本機獨有、匯入包裡沒有的資料。
 */
export function applyMigrationPack(
  local: NutritionSnapshot,
  pack: NutritionMigrationPack,
  mode: MigrationMergeMode
): ApplyMigrationPackResult {
  const photosToWrite: Array<{ key: string; bytes: Uint8Array }> = []
  const queuePhoto = (key: string | undefined): void => {
    if (!key) return
    const base64 = pack.photos[key]
    if (base64) photosToWrite.push({ key, bytes: base64ToBytes(base64) })
  }

  const foodItems = mergeById(local.foodItems, pack.foodItems, mode, (item) => {
    for (const key of item.photoKeys) queuePhoto(key)
  })
  const mealLogs = mergeById(local.mealLogs, pack.mealLogs, mode, (item) => queuePhoto(item.photoKey))

  let bodyProfile = local.bodyProfile
  if (pack.bodyProfile) {
    if (!local.bodyProfile) bodyProfile = pack.bodyProfile
    else if (mode === 'overwrite' && pack.bodyProfile.updatedAt >= local.bodyProfile.updatedAt) bodyProfile = pack.bodyProfile
  }

  const settings: NutritionAppSettings = mode === 'overwrite'
    ? { llm: { ...pack.llmSettings, apiKeys: local.settings.llm.apiKeys } }
    : local.settings

  // 逐日 kcal 沒有 updatedAt 可比，用「哪邊贏就整包蓋在另一邊底下」簡化：
  // overwrite 讓匯入值贏、fill-only 讓本機值贏，兩種模式都不會漏掉另一邊獨有的日期。
  const packBurnedKcalHistory = pack.burnedKcalHistory ?? {}
  const burnedKcalHistory = mode === 'overwrite'
    ? { ...local.burnedKcalHistory, ...packBurnedKcalHistory }
    : { ...packBurnedKcalHistory, ...local.burnedKcalHistory }

  return {
    snapshot: { foodItems, mealLogs, bodyProfile, settings, burnedKcalHistory },
    photosToWrite
  }
}
