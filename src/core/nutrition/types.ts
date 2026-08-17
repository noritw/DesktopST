export type NutritionActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very-active'

export interface FoodNutritionPerServing {
  kcal: number
  proteinG: number
  carbsG?: number
  fatG?: number
}

export type FoodItemPhotoKeys = [] | [string] | [string, string] | [string, string, string]

export interface FoodItem {
  id: string
  name: string
  aliases: string[]
  /** 品牌或店家（合一欄：包裝食品看品牌、現做食品看店家，兩者很難同時成立）。 */
  brand?: string
  flavor?: string
  /** 使用者自訂分類標籤（例如「早餐」「外食」），純字串、無階層。 */
  tags?: string[]
  perServing: FoodNutritionPerServing
  photoKeys: FoodItemPhotoKeys
  /** B9b 會再使用來源資訊接上照片估價，目前只保留手動／搬家匯入。 */
  source: 'user' | 'imported'
  /** 可由 MealLog 聚合重算的快取，方便候選排序。 */
  useCount?: number
  lastEatenAt?: number
  createdAt: number
  updatedAt: number
}

export interface MealLog {
  id: string
  foodItemId: string
  servings: number
  eatenAt: number
  note?: string
  /** 當次餐次照片，與 FoodItem 的食物庫照片分開。 */
  photoKey?: string
  /**
   * 只套用在這一筆的名稱／營養覆寫，用於「只儲存到當日飲食」——
   * 使用者選這個選項時不動食物庫主檔，改用這裡的值蓋過 FoodItem 的顯示與計算。
   * 選「更新食物庫資料」時應該清掉這個欄位，讓這筆餐次回頭吃主檔的值。
   */
  override?: {
    name?: string
    kcal?: number
    proteinG?: number
  }
  createdAt: number
  updatedAt: number
}

export interface BodyProfile {
  id: string
  heightCm: number
  weightKg: number
  ageYears: number
  activityLevel: NutritionActivityLevel
  /** 最近一次計算出的 TDEE 建議值，不是使用者最後確認的上限。 */
  tdeeEstimate?: number
  dailyKcalLimit: number
  dailyProteinGoalG: number
  createdAt: number
  updatedAt: number
}

export interface NutritionLlmSettings {
  provider: string
  model?: string
  endpoint?: string
  apiKeys: Record<string, string>
}

export interface NutritionAppSettings {
  llm: NutritionLlmSettings
}
