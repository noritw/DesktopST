import type { StorageAdapter } from '../adapters'
import type { FoodItem, MealLog, NutritionAppSettings, BodyProfile } from './types'
import { loadNutritionSnapshot, saveNutritionSnapshot } from './storage'

export interface NutritionStateInvalidatedEvent {
  kind: 'state-invalidated'
  reason: 'nutrition'
}

export type NutritionStateListener = (event: NutritionStateInvalidatedEvent) => void

export class NutritionSession {
  private readonly listeners = new Set<NutritionStateListener>()

  private constructor(
    readonly storage: StorageAdapter,
    private snapshot: {
      foodItems: FoodItem[]
      mealLogs: MealLog[]
      bodyProfile: BodyProfile | null
      settings: NutritionAppSettings
    }
  ) {}

  static async boot(storage: StorageAdapter): Promise<NutritionSession> {
    return new NutritionSession(storage, await loadNutritionSnapshot(storage))
  }

  get foodItems(): readonly FoodItem[] {
    return this.snapshot.foodItems
  }

  get mealLogs(): readonly MealLog[] {
    return this.snapshot.mealLogs
  }

  get bodyProfile(): BodyProfile | null {
    return this.snapshot.bodyProfile
  }

  get settings(): NutritionAppSettings {
    return this.snapshot.settings
  }

  subscribe(listener: NutritionStateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async saveFoodItem(foodItem: FoodItem): Promise<void> {
    this.snapshot.foodItems = upsertById(this.snapshot.foodItems, foodItem)
    await this.persistAndInvalidate()
  }

  async removeFoodItem(id: string): Promise<void> {
    const removed = this.snapshot.foodItems.find((foodItem) => foodItem.id === id)
    this.snapshot.foodItems = this.snapshot.foodItems.filter((foodItem) => foodItem.id !== id)
    await this.persistAndInvalidate()
    if (removed) await Promise.all(removed.photoKeys.map((key) => this.storage.remove(key)))
  }

  /**
   * 複製食物到新 id（照片也複製），用於建立類似但細節不同的食物版本。
   * 注意：照片二進位會重新複製一份，所以這個操作的時間成本跟圖片大小相關。
   */
  async duplicateFoodItem(id: string, newId: string): Promise<FoodItem | null> {
    const source = this.snapshot.foodItems.find((item) => item.id === id)
    if (!source) return null

    const newPhotoKeys: string[] = []
    try {
      for (let i = 0; i < source.photoKeys.length; i++) {
        const oldKey = source.photoKeys[i]
        const bytes = await this.storage.readBinary(oldKey)
        if (bytes) {
          // 照片 key 格式：food-photos/{foodItemId}/{index}.webp
          // 複製時改成新 id，但保留同一個 index
          const newKey = `food-photos/${newId}/${i}.webp`
          await this.storage.writeBinary(newKey, bytes)
          newPhotoKeys.push(newKey)
        }
      }
    } catch {
      // 如果照片複製失敗，仍然建立食物，但沒有照片
      // 呼叫端可以察覺 photoKeys 沒有全部複製過來
    }

    const photoKeysTyped = (
      newPhotoKeys.length === 0 ? [] :
      newPhotoKeys.length === 1 ? [newPhotoKeys[0]] :
      newPhotoKeys.length === 2 ? [newPhotoKeys[0], newPhotoKeys[1]] :
      [newPhotoKeys[0], newPhotoKeys[1], newPhotoKeys[2]]
    ) as typeof source.photoKeys

    const duplicated: FoodItem = {
      ...source,
      id: newId,
      photoKeys: photoKeysTyped,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.snapshot.foodItems.push(duplicated)
    await this.persistAndInvalidate()
    return duplicated
  }

  async saveMealLog(mealLog: MealLog): Promise<void> {
    this.snapshot.mealLogs = upsertById(this.snapshot.mealLogs, mealLog)
    await this.persistAndInvalidate()
  }

  async removeMealLog(id: string): Promise<void> {
    const removed = this.snapshot.mealLogs.find((mealLog) => mealLog.id === id)
    this.snapshot.mealLogs = this.snapshot.mealLogs.filter((mealLog) => mealLog.id !== id)
    await this.persistAndInvalidate()
    if (removed?.photoKey) await this.storage.remove(removed.photoKey)
  }

  async saveBodyProfile(bodyProfile: BodyProfile): Promise<void> {
    this.snapshot.bodyProfile = bodyProfile
    await this.persistAndInvalidate()
  }

  async saveSettings(settings: NutritionAppSettings): Promise<void> {
    this.snapshot.settings = settings
    await this.persistAndInvalidate()
  }

  /**
   * 搬家包匯入用：一次寫入整份合併結果，只觸發一次 persist／通知，
   * 不要對每一筆記錄各別呼叫 saveXxx（那樣既慢、又會讓畫面在匯入過程中閃過中間狀態）。
   */
  async replaceSnapshot(snapshot: {
    foodItems: FoodItem[]
    mealLogs: MealLog[]
    bodyProfile: BodyProfile | null
    settings: NutritionAppSettings
  }): Promise<void> {
    this.snapshot = snapshot
    await this.persistAndInvalidate()
  }

  private async persistAndInvalidate(): Promise<void> {
    await saveNutritionSnapshot(this.storage, this.snapshot)
    const event: NutritionStateInvalidatedEvent = { kind: 'state-invalidated', reason: 'nutrition' }
    for (const listener of this.listeners) listener(event)
  }
}

function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id)
  if (index < 0) return [...items, next]
  const result = items.slice()
  result[index] = next
  return result
}
