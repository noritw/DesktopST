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
  /** 備查用途，UI 不主打，收在「更多」／詳情頁。估不到時留空，不補假數字。 */
  sugarG?: number
  /** 單位固定毫克。備查用途，UI 不主打，收在「更多」／詳情頁。 */
  sodiumMg?: number
}

export type FoodItemPhotoKeys = [] | [string] | [string, string] | [string, string, string]

/** 台灣營養標示常見的三種基準，見 `docs/nutrition-photo-estimate-plan.md` §2.6.2。 */
export type NutritionLabelBasis = 'per100g' | 'perServing' | 'perPackage'

/** 拍到的營養成分表原始欄位，供日後查證與重算（`normalizeLabel`／`nutritionFromGrams`）。 */
export interface FoodNutritionLabel {
  basis: NutritionLabelBasis
  /** basis 為 per100g／perServing 時通常會有；perPackage 不需要。 */
  servingSizeG?: number
  servingsPerPackage?: number
  kcal: number
  proteinG: number
  carbsG?: number
  fatG?: number
  sugarG?: number
  sodiumMg?: number
}

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
  /**
   * `label` 來自營養成分表 OCR，最硬、不被任何 LLM 路徑覆寫；
   * `llm-photo` 為純影像估算新建；`llm-photo-edited` 為使用者確認／修改過或套用重估結果。
   */
  source: 'user' | 'imported' | 'label' | 'llm-photo' | 'llm-photo-edited'
  /** 可由 MealLog 聚合重算的快取，方便候選排序。 */
  useCount?: number
  lastEatenAt?: number
  /** 讀到的原始標示欄位，供日後查證與重算（§6）。 */
  labelRaw?: FoodNutritionLabel
  /** 上次記錄用的份量模式與數值，下次預設帶出（§2.8.3）。 */
  lastAmount?: { mode: 'servings' | 'grams'; value: number }
  createdAt: number
  updatedAt: number
}

export interface MealLog {
  id: string
  foodItemId: string
  servings: number
  eatenAt: number
  /** 送出前補充說明原文（§2.7），保留供日後回頭看當時吃了什麼。 */
  note?: string
  /** 當次餐次照片，與 FoodItem 的食物庫照片分開。 */
  photoKey?: string
  /** 份量輸入模式，秤重模式見 §2.8。未定義視為 'servings'。 */
  amountMode?: 'servings' | 'grams'
  /** amountMode 為 'grams' 時的實際克數。 */
  grams?: number
  /** `resolveEatenAt` 判斷 eatenAt 的依據，補記時可回頭查是誰決定了時間（§2.5.3）。 */
  eatenAtSource?: 'now' | 'exif' | 'mtime' | 'manual'
  /** 這張／這組照片的內容指紋，補記時用來避免重複入帳（§2.5.4）。單張時使用。 */
  photoHash?: string
  /** 一組多張時的其餘張指紋（不含 photoHash 那張），一併記錄以免重複入帳。 */
  photoHashes?: string[]
  /** 該次 AI 估算的預估花費，供「本月飲食估算花費」加總，可關（§2.9.3）。 */
  estimatedCostMinor?: number
  tokenUsage?: { inputTokens?: number; outputTokens?: number }
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
  /**
   * 每個供應商各自的端點，鍵是 provider。**不是單一欄位**——早期版本只有
   * 一個扁平的 `endpoint: string`，切供應商時舊值會被錯誤地沿用到新供應商
   * 送出請求（例如切去本機測完，切回 OpenAI 卻還在打本機那個位址）。
   * 這正是 CLAUDE.md §5「llm.endpoint 是遺留欄位」記載的同一類坑，
   * 這裡直接比照 `apiKeys` 做成 per-provider，從源頭避免。
   */
  endpoints?: Record<string, string>
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
  /**
   * 選配，預設關（未定義視為 false）。手機端頂部顯示目前體重與量測時間
   * （不需要 `health.connected`——手動記錄的體重一樣會顯示，時間退回
   * `BodyProfile.updatedAt`）。純顯示用途，跟 Health 同步無依賴關係。
   */
  showWeightBadge?: boolean
  /**
   * 第三層開關（母規格外的加值路徑），預設關。關閉時拍照／補記／重估
   * 入口全部隱藏（非變灰），手打路徑不受影響。
   * 見 `docs/nutrition-photo-estimate-plan.md` §2.10。
   */
  photoEstimate?: {
    enabled: boolean
    /**
     * 常駐的「比例尺校正」說明，每次估算都會附進 prompt。
     *
     * 存在的理由（owner 2026-08-19 實測）：用手當比例尺拍食物時，模型會套用
     * 「一般成人手掌 8～9 公分」來換算尺寸；手比一般人小的使用者會被系統性
     * 高估——**體積是長度的三次方**，線性差 20% 就是體積差約 1.7 倍，熱量跟著爆。
     * 這種校正資訊每次都一樣，不該逼使用者每張照片重打一次（違反 §1 原則 1「不打字」），
     * 所以做成設定裡填一次、之後每次自動帶入。
     */
    scaleReference?: string
  }
}
