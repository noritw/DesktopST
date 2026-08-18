export type NutritionActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very-active'

/** 顯示順序刻意把 gain-weight 放最後——需要增重的使用者是少數。 */
export type NutritionGoal =
  | 'lose-weight'
  | 'gain-muscle'
  | 'maintain'
  | 'gain-weight'

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
  sex: 'male' | 'female'
  /** 體脂率百分比（0-100）。可選；有填時用 Katch-McArdle 更精準；無值時退回 Mifflin-St Jeor。 */
  bodyFatPercent?: number
  activityLevel: NutritionActivityLevel
  goal: NutritionGoal
  /** 最近一次計算出的 TDEE 建議值，不是使用者最後確認的上限。 */
  tdeeEstimate?: number
  dailyKcalLimit: number
  dailyProteinGoalG: number
  /**
   * 體重／體脂上次從 Health Connect 同步的時間（App 端 `Date.now()`）。
   * 手動編輯 `weightKg`／`bodyFatPercent` 不會更新這個欄位。
   */
  healthSyncedAt?: number
  /**
   * 上次同步時 `HealthSnapshot.measuredAt`（Health Connect 回報的資料時間戳，
   * 不是同步發生的時間）。用來判斷資料新不新鮮，見
   * `docs/nutrition-health-lite-kickoff.md` §6。
   */
  healthMeasuredAt?: number
  createdAt: number
  updatedAt: number
}

export interface NutritionLlmSettings {
  provider: string
  model?: string
  endpoint?: string
  apiKeys: Record<string, string>
}

/**
 * 三個開關有依賴關係（`docs/nutrition-health-lite-kickoff.md` §2）：
 * `connected` 關閉時，`autoSync`／`useWatchCalorieLimit` 完全不生效
 * （UI 上也應該隱藏，不是顯示成灰階不可按）。只有手機端會用到；
 * 桌面（`nutrition/desktop`）不應該讀寫這個欄位。
 */
export interface NutritionHealthSettings {
  /** 開關 1：總開關，預設 false／未定義視為 false。 */
  connected: boolean
  /** 開關 2：App／小工具顯示時自動同步一次；關閉則只能手動按同步按鈕。 */
  autoSync: boolean
  /**
   * 開關 3：今日熱量上限是否用動態公式算（今天已消耗 + 剩餘時間 × 靜止代謝率），
   * 而不是固定顯示 `BodyProfile.dailyKcalLimit`。今天沒有新鮮的手錶資料時
   * 自動退回顯示 `dailyKcalLimit`，跟這個開關的開關狀態無關。
   */
  useWatchCalorieLimit: boolean
}

export interface NutritionAppSettings {
  llm: NutritionLlmSettings
  /** 選配，預設關（未定義視為全部 false）。手機端專用，見 `NutritionHealthSettings`。 */
  health?: NutritionHealthSettings
}
