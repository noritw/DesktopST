import { sha1HexBytes } from '../util/sha1'
import type { FoodItem, FoodItemPhotoKeys, FoodNutritionLabel, FoodNutritionPerServing, MealLog, NutritionLabelBasis } from './types'

// ---------------------------------------------------------------------------
// §2.3／§4.3：本機比對既有食物庫（免 LLM 或省 LLM）
// ---------------------------------------------------------------------------

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

/** 以 name/aliases + 可選 brand 正規化比對，回傳 0/1/N 候選（`docs/nutrition-photo-estimate-plan.md` §2.3）。 */
export function matchFoodItem(
  name: string,
  brand: string | null | undefined,
  library: readonly FoodItem[]
): FoodItem[] {
  const normalizedName = normalizeText(name)
  if (!normalizedName) return []
  const normalizedBrand = brand ? normalizeText(brand) : undefined

  return library.filter((item) => {
    const terms = [item.name, ...item.aliases].map(normalizeText)
    if (!terms.includes(normalizedName)) return false
    if (normalizedBrand && item.brand && normalizeText(item.brand) !== normalizedBrand) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// §3：AI 呼叫規格 — prompt 組裝與結果解析
// ---------------------------------------------------------------------------

/**
 * 組 prompt，不含個資（只送名稱清單，不送營養數字／體重／上限），見 §3.1。
 *
 * ## 為什麼這支刻意寫得這麼短
 *
 * owner 2026-08-19 指出：他在自己的 LLM 網頁介面只打一句
 *「如果我拍食物照片，請幫我計算熱量、蛋白質、碳水化合物、脂肪、糖、鈉」
 * 就估得又快又準，而這裡堆了八條規則反而估出偏高很多的數字。
 *
 * 事後檢討，被砍掉的那幾條**本身就在製造偏差**，尤其：
 * - 「用可見的份量線索推份量，**不要一律預設一份**」——等於叫模型別保守、
 *   往大的推，配上偏小的比例尺（owner 用自己的手，比一般人小）就系統性高估。
 * - 「寧可保守也不要高估」——這是後來為了對沖上一條加的。**用偏見抵銷偏見**
 *   只會讓行為更難預測，兩條都該刪掉而不是留著互相拉扯。
 *
 * 所以規則只留**結構上非有不可**的：
 * 1. 輸出 JSON schema —— 我們是程式解析，不像人在網頁上用讀的。缺這段就是
 *    「一直回問號」那次的根因（模型自己發明欄位名 → parse 全滅）。
 * 2. 營養標示優先 —— 有標示卻用經驗值猜是實質錯誤，不是風格問題。
 * 3. 使用者的補充說明優先 —— 那是使用者主動給的資訊。
 *
 * **想再加規則前先問：這條是在補一個結構性缺口，還是在微調模型的判斷傾向？**
 * 後者請不要加，改用 `scaleReference`（使用者自己填的校正資訊）或補充說明。
 */
export function buildPhotoEstimatePrompt(recentNames: readonly string[], scaleReference?: string): string {
  const lines: string[] = []
  lines.push('請看照片估算食物的熱量、蛋白質、碳水化合物、脂肪、糖、鈉。')
  lines.push('同一份食物可能有多張照片（包裝正面、營養成分表、內容物），請合併判讀成一筆結果。')
  lines.push('照片中有營養成分表時，數字以標示為準，不要用經驗值覆蓋。')
  if (scaleReference) {
    lines.push('')
    lines.push(`使用者提供的比例尺參考資訊（推估尺寸時請以此為準）：${scaleReference}`)
  }
  if (recentNames.length > 0) {
    lines.push('')
    lines.push(`使用者最近吃過的食物名稱（若照片就是其中之一，請沿用相同名稱）：${recentNames.join('、')}`)
  }
  lines.push('')
  lines.push('只回傳 JSON，不要有其他文字。格式如下（欄位名稱與大小寫必須完全一致）：')
  lines.push('')
  lines.push('{')
  lines.push('  "results": [')
  lines.push('    {')
  lines.push('      "name": "燻雞三明治",            // 食物名稱，必填')
  lines.push('      "brand": "7-11",                 // 品牌或店家，不確定填 null')
  lines.push('      "flavor": null,                  // 口味，沒有填 null')
  lines.push('      "servings": 1,                   // 照片中看到的份數')
  lines.push('      "estimatedWeightG": 180,         // 你認為這一份大約幾公克，必填數字')
  lines.push('      "portionBasis": "依常見超商三明治份量",  // 你是根據什麼判斷份量的，一句話')
  lines.push('      "perServing": {                  // 「一份」的營養，必填')
  lines.push('        "kcal": 320,                   // 熱量（大卡），必填數字')
  lines.push('        "proteinG": 18,                // 蛋白質（公克），必填數字')
  lines.push('        "carbsG": 34,                  // 碳水（公克），估不到填 null')
  lines.push('        "fatG": 12,                    // 脂肪（公克），估不到填 null')
  lines.push('        "sugarG": 5,                   // 糖（公克），估不到填 null')
  lines.push('        "sodiumMg": 610                // 鈉（毫克），估不到填 null')
  lines.push('      },')
  lines.push('      "nutritionSource": "estimate",   // "label"=依營養標示 / "label-partial"=標示不完整 / "estimate"=你估的')
  lines.push('      "label": null,                   // 有讀到營養標示才填，格式見下方')
  lines.push('      "confidence": "high",            // "high" / "medium" / "low"')
  lines.push('      "appliedNote": true,             // 是否採用了使用者的補充說明')
  lines.push('      "noteConflict": null,            // 文字與圖片矛盾時的一句說明，否則 null')
  lines.push('      "note": "三明治，內含雞肉與生菜"  // 一句話描述你看到什麼，讓使用者判斷有沒有認錯')
  lines.push('    }')
  lines.push('  ]')
  lines.push('}')
  lines.push('')
  lines.push('讀到營養標示時，label 欄位格式：')
  lines.push('{ "basis": "per100g" | "perServing" | "perPackage", "servingSizeG": 60, "servingsPerPackage": 2, "kcal": 250, "proteinG": 9, "carbsG": 27, "fatG": 9, "sugarG": 8, "sodiumMg": 480 }')
  lines.push('（basis 表示標示上的數字是「每100公克」/「每一份量」/「每包裝」；換算由程式處理，你只要照實讀出表上的數字即可，不要自己換算。）')
  return lines.join('\n')
}

export interface PhotoEstimateLabel {
  basis: NutritionLabelBasis
  servingSizeG?: number
  servingsPerPackage?: number
  kcal?: number
  proteinG?: number
  carbsG?: number
  fatG?: number
  sugarG?: number
  sodiumMg?: number
}

export interface PhotoEstimateResult {
  slot: number
  name: string | null
  brand: string | null
  flavor: string | null
  servings: number | null
  /** 模型認為這一份大約幾公克。顯示給使用者當作「數字怎麼來的」的線索，不參與計算。 */
  estimatedWeightG: number | null
  /** 模型判斷份量的依據（例如「以手掌寬度推估」）。比信心分數有用——看得出是哪一步估錯。 */
  portionBasis: string | null
  perServing: FoodNutritionPerServing | null
  nutritionSource: 'label' | 'estimate' | 'label-partial'
  label: PhotoEstimateLabel | null
  confidence: 'high' | 'medium' | 'low'
  appliedNote: boolean
  noteConflict: string | null
  note: string | null
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function parseLabel(raw: unknown): PhotoEstimateLabel | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const basis = obj.basis === 'per100g' || obj.basis === 'perServing' || obj.basis === 'perPackage' ? obj.basis : null
  if (!basis) return null
  return {
    basis,
    servingSizeG: toFiniteNumber(obj.servingSizeG),
    servingsPerPackage: toFiniteNumber(obj.servingsPerPackage),
    kcal: toFiniteNumber(obj.kcal),
    proteinG: toFiniteNumber(obj.proteinG),
    carbsG: toFiniteNumber(obj.carbsG),
    fatG: toFiniteNumber(obj.fatG),
    sugarG: toFiniteNumber(obj.sugarG),
    sodiumMg: toFiniteNumber(obj.sodiumMg)
  }
}

/**
 * 取第一個有值的鍵。**別名不是裝飾用的**：prompt 雖然已經逐欄指定格式
 * （見 `buildPhotoEstimatePrompt` 的說明），但不同模型／不同溫度下偶爾還是會
 * 吐 `calories`／`protein` 這種近義名，而這個 App 一旦 parse 失敗就只能顯示
 * 「？」——與其讓使用者白花一次 token，不如在這裡多認幾個常見寫法。
 */
function pickNumber(obj: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = toFiniteNumber(obj[key])
    if (value !== undefined) return value
  }
  return undefined
}

const KCAL_KEYS = ['kcal', 'calories', 'calorie', 'energyKcal', 'kCal'] as const
const PROTEIN_KEYS = ['proteinG', 'protein', 'proteinGrams'] as const
const CARBS_KEYS = ['carbsG', 'carbs', 'carbohydrateG', 'carbohydratesG', 'carbohydrates'] as const
const FAT_KEYS = ['fatG', 'fat', 'fatGrams'] as const
const SUGAR_KEYS = ['sugarG', 'sugar', 'sugarsG'] as const
const SODIUM_KEYS = ['sodiumMg', 'sodium', 'sodiumMilligrams'] as const

function parsePerServing(raw: unknown): FoodNutritionPerServing | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const kcal = pickNumber(obj, KCAL_KEYS)
  const proteinG = pickNumber(obj, PROTEIN_KEYS)
  // kcal 是這個 App 的核心欄位，沒有它整筆記錄沒有意義；蛋白質缺值時補 0
  // 讓使用者至少能先存下熱量、之後在食物庫補（比整筆變「？」有用）。
  if (kcal === undefined) return null
  const result: FoodNutritionPerServing = { kcal, proteinG: proteinG ?? 0 }
  const carbsG = pickNumber(obj, CARBS_KEYS)
  const fatG = pickNumber(obj, FAT_KEYS)
  const sugarG = pickNumber(obj, SUGAR_KEYS)
  const sodiumMg = pickNumber(obj, SODIUM_KEYS)
  if (carbsG !== undefined) result.carbsG = carbsG
  if (fatG !== undefined) result.fatG = fatG
  if (sugarG !== undefined) result.sugarG = sugarG
  if (sodiumMg !== undefined) result.sodiumMg = sodiumMg
  return result
}

function parseOne(raw: unknown, fallbackSlot: number): PhotoEstimateResult {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const slot = toFiniteNumber(obj.slot) ?? fallbackSlot
  const confidence = obj.confidence === 'high' || obj.confidence === 'medium' || obj.confidence === 'low' ? obj.confidence : 'low'
  const nutritionSource =
    obj.nutritionSource === 'label' || obj.nutritionSource === 'label-partial' ? obj.nutritionSource : 'estimate'
  // 有些模型會把營養數字直接攤在最外層而不是包進 perServing，退而求其次從外層撈。
  const perServing = parsePerServing(obj.perServing) ?? parsePerServing(obj.nutrition) ?? parsePerServing(obj)
  return {
    slot,
    name: toStringOrNull(obj.name) ?? toStringOrNull(obj.foodName) ?? toStringOrNull(obj.food),
    brand: toStringOrNull(obj.brand) ?? toStringOrNull(obj.store),
    flavor: toStringOrNull(obj.flavor),
    servings: toFiniteNumber(obj.servings) ?? null,
    estimatedWeightG: pickNumber(obj, ['estimatedWeightG', 'weightG', 'estimatedWeight', 'grams']) ?? null,
    portionBasis: toStringOrNull(obj.portionBasis) ?? toStringOrNull(obj.portionReasoning),
    perServing,
    nutritionSource,
    label: parseLabel(obj.label),
    confidence,
    appliedNote: obj.appliedNote === true,
    noteConflict: toStringOrNull(obj.noteConflict),
    note: toStringOrNull(obj.note) ?? toStringOrNull(obj.description)
  }
}

/** 寬鬆解析 LLM 回傳的 JSON，缺欄位標記而非丟錯（§3.2）。接受單一物件或陣列。 */
export function parseEstimateResult(raw: unknown): PhotoEstimateResult[] {
  if (Array.isArray(raw)) return raw.map((entry, index) => parseOne(entry, index + 1))
  if (raw && typeof raw === 'object') return [parseOne(raw, 1)]
  return []
}

// ---------------------------------------------------------------------------
// §4.3：回存規則 — 產出要寫入的 FoodItem?／MealLog
// ---------------------------------------------------------------------------

export interface ApplyEstimateOptions {
  /** 比對到既有食物時傳入；未命中傳 null（會新建 FoodItem）。 */
  matchedFoodItem: FoodItem | null
  newFoodItemId: string
  newMealLogId: string
  now: number
  eatenAt: number
  eatenAtSource: NonNullable<MealLog['eatenAtSource']>
  servings: number
  photoKeys?: FoodItemPhotoKeys
  mealPhotoKey?: string
  photoHash?: string
  photoHashes?: string[]
  note?: string
  amountMode?: MealLog['amountMode']
  grams?: number
  estimatedCostMinor?: number
}

export function applyEstimateToEntries(
  result: PhotoEstimateResult,
  options: ApplyEstimateOptions
): { foodItem: FoodItem | null; mealLog: MealLog } {
  const foodItemId = options.matchedFoodItem ? options.matchedFoodItem.id : options.newFoodItemId

  let foodItem: FoodItem | null = null
  if (!options.matchedFoodItem) {
    const perServing: FoodNutritionPerServing = result.perServing ?? { kcal: 0, proteinG: 0 }
    const source = result.nutritionSource === 'label' || result.nutritionSource === 'label-partial' ? 'label' : 'llm-photo'
    foodItem = {
      id: options.newFoodItemId,
      name: result.name ?? '未命名',
      aliases: [],
      brand: result.brand ?? undefined,
      flavor: result.flavor ?? undefined,
      perServing,
      photoKeys: options.photoKeys ?? [],
      source,
      labelRaw: result.label
        ? {
            basis: result.label.basis,
            servingSizeG: result.label.servingSizeG,
            servingsPerPackage: result.label.servingsPerPackage,
            kcal: result.label.kcal ?? 0,
            proteinG: result.label.proteinG ?? 0,
            carbsG: result.label.carbsG,
            fatG: result.label.fatG,
            sugarG: result.label.sugarG,
            sodiumMg: result.label.sodiumMg
          }
        : undefined,
      createdAt: options.now,
      updatedAt: options.now
    }
  }

  const mealLog: MealLog = {
    id: options.newMealLogId,
    foodItemId,
    servings: options.servings,
    eatenAt: options.eatenAt,
    eatenAtSource: options.eatenAtSource,
    createdAt: options.now,
    updatedAt: options.now
  }
  if (options.note) mealLog.note = options.note
  if (options.mealPhotoKey) mealLog.photoKey = options.mealPhotoKey
  if (options.photoHash) mealLog.photoHash = options.photoHash
  if (options.photoHashes && options.photoHashes.length > 0) mealLog.photoHashes = options.photoHashes
  if (options.amountMode) mealLog.amountMode = options.amountMode
  if (options.grams !== undefined) mealLog.grams = options.grams
  if (options.estimatedCostMinor !== undefined) mealLog.estimatedCostMinor = options.estimatedCostMinor

  return { foodItem, mealLog }
}

// ---------------------------------------------------------------------------
// §2.5.3：補記時間怎麼決定
// ---------------------------------------------------------------------------

export interface ResolvedEatenAt {
  eatenAt: number
  eatenAtSource: NonNullable<MealLog['eatenAtSource']>
}

/**
 * 依 EXIF → mtime → now 的優先序決定時間（§2.5.3）。
 * 前兩者都沒有時退回 `now`，但標記 `eatenAtSource: 'manual'`——
 * 呼叫端應該把這個情況顯示成「請確認時間」讓使用者互動，而不是靜靜當作正確時間。
 */
export function resolveEatenAt(
  exifDateTimeOriginal: number | null | undefined,
  fileMtime: number | null | undefined,
  now: number
): ResolvedEatenAt {
  if (exifDateTimeOriginal !== null && exifDateTimeOriginal !== undefined) {
    return { eatenAt: exifDateTimeOriginal, eatenAtSource: 'exif' }
  }
  if (fileMtime !== null && fileMtime !== undefined) {
    return { eatenAt: fileMtime, eatenAtSource: 'mtime' }
  }
  return { eatenAt: now, eatenAtSource: 'manual' }
}

// ---------------------------------------------------------------------------
// §2.5.4：補記去重
// ---------------------------------------------------------------------------

/** 照片內容指紋，只在本機比對、不上傳（§2.5.4）。 */
export function hashPhoto(bytes: Uint8Array): string {
  return sha1HexBytes(bytes)
}

/** 找出已經記錄過這張照片（依指紋）的 MealLog，供補記時提示「已記錄過」。 */
export function findDuplicateLog(hash: string, logs: readonly MealLog[]): MealLog | null {
  return logs.find((log) => log.photoHash === hash || (log.photoHashes ?? []).includes(hash)) ?? null
}

// ---------------------------------------------------------------------------
// §2.9：模型能力與費用
// ---------------------------------------------------------------------------

export interface ModelCapabilities {
  id: string
  vision: boolean
  maxImagesPerRequest: number
  maxImageEdgePx?: number
  pricing?: {
    currency: string
    inputPerMTok?: number | null
    outputPerMTok?: number | null
    imageTokensFormula?: 'tiles' | 'fixed' | 'unknown'
  } | null
}

/** 未知模型（使用者自填、沒列在能力表裡）的保守預設，owner 拍板 2026-08-19（§2.9.1）。 */
export const UNKNOWN_MODEL_MAX_IMAGES_PER_REQUEST = 3

/** 每份食物最多張數（正面／成分表／內容物），對應 `FoodItem.photoKeys` 上限。 */
export const MAX_PHOTOS_PER_FOOD_SLOT = 3

/** 補充頁「加一份食物」的硬上限，即使模型能力表允許更多也不超過（§2.9.2）。 */
export const MAX_FOOD_SLOTS_HARD_CAP = 8

/** 依模型能力算最多可加幾份食物（最壞情況：每份都用滿 3 張），見 §2.9.2。 */
export function resolveMaxFoodSlots(caps: ModelCapabilities): number {
  const byCapacity = Math.floor(caps.maxImagesPerRequest / MAX_PHOTOS_PER_FOOD_SLOT)
  return Math.min(byCapacity, MAX_FOOD_SLOTS_HARD_CAP)
}

/** 用「目前實際已放的張數」動態算還能不能再加一份食物（比 resolveMaxFoodSlots 寬鬆）。 */
export function canAddAnotherFoodSlot(caps: ModelCapabilities, currentTotalPhotoCount: number): boolean {
  return currentTotalPhotoCount + 1 <= caps.maxImagesPerRequest
}

export interface EstimatedCost {
  currency: string
  /** 幣別的主要單位金額（不是分／不是 minor unit），例如 USD 0.0041。小額不得四捨五入成 0（§2.9.3）。 */
  amount: number
}

const FIXED_MODEL_IMAGE_TOKENS = 765
const TILED_MODEL_IMAGE_TOKENS = 1105
const CHARS_PER_TOKEN_ESTIMATE = 4
const ESTIMATED_OUTPUT_TOKENS = 300

/** 送出前費用預估；缺價格表／幣別／或 formula 為 unknown 一律回 null（顯示「費用未知」，§2.9.3）。 */
export function estimateRequestCost(caps: ModelCapabilities, photoCount: number, promptChars: number): EstimatedCost | null {
  const pricing = caps.pricing
  if (!pricing || !pricing.currency) return null
  if (pricing.inputPerMTok == null || pricing.outputPerMTok == null) return null
  if (!pricing.imageTokensFormula || pricing.imageTokensFormula === 'unknown') return null

  const perImageTokens = pricing.imageTokensFormula === 'tiles' ? TILED_MODEL_IMAGE_TOKENS : FIXED_MODEL_IMAGE_TOKENS
  const imageTokens = perImageTokens * photoCount
  const textTokens = Math.ceil(promptChars / CHARS_PER_TOKEN_ESTIMATE)
  const inputTokens = imageTokens + textTokens

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMTok
  const outputCost = (ESTIMATED_OUTPUT_TOKENS / 1_000_000) * pricing.outputPerMTok
  return { currency: pricing.currency, amount: inputCost + outputCost }
}

/**
 * 從 `core/llm/modelCatalog` 的單價表推出能力／價格（§2.9.1 說的
 * `model-capabilities.json` 之前，先用既有那份表，**不另外自己編一組數字**——
 * 憑印象填價格比不顯示更糟）。查無單價就回 `pricing: null`，UI 顯示「費用未知」。
 *
 * 幣別固定 `USD`：`MODEL_PRICES` 整張表就是美金每百萬 tokens 價。
 * `imageTokensFormula` 一律 `tiles`（OpenAI／Claude 這類分塊計價的上界較保守，
 * 寧可估高一點，避免使用者事後看到帳單比預估多）。
 */
export function capabilitiesFromPriceTable(
  modelId: string,
  price: readonly [number, number] | null,
  isLocal: boolean
): ModelCapabilities {
  return {
    id: modelId,
    vision: true,
    maxImagesPerRequest: UNKNOWN_MODEL_MAX_IMAGES_PER_REQUEST,
    pricing: isLocal || !price
      ? null
      : { currency: 'USD', inputPerMTok: price[0], outputPerMTok: price[1], imageTokensFormula: 'tiles' }
  }
}

/**
 * 費用金額轉顯示字串（§2.9.3）：一律帶 ISO 幣別代碼、不換算匯率、
 * **絕不顯示 `0.00`**（那會讓人以為免費），小額改用更多位數。
 */
export function formatEstimatedCost(cost: EstimatedCost): string {
  const digits = cost.amount < 0.01 ? 4 : 2
  return `${cost.currency} $${cost.amount.toFixed(digits)}`
}

export interface PhotoEstimateRequest {
  photoCount: number
  hasApiKey: boolean
  isLocalModel: boolean
}

export type CompatibilityIssue =
  | { kind: 'no-vision' }
  | { kind: 'too-many-images'; max: number; excess: number }
  | { kind: 'missing-api-key' }

/** 送出前本機先擋掉必然失敗的組合，不浪費一次請求（§2.9.4）。 */
export function checkRequestCompatibility(caps: ModelCapabilities, request: PhotoEstimateRequest): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = []
  if (!caps.vision) issues.push({ kind: 'no-vision' })
  if (request.photoCount > caps.maxImagesPerRequest) {
    issues.push({ kind: 'too-many-images', max: caps.maxImagesPerRequest, excess: request.photoCount - caps.maxImagesPerRequest })
  }
  if (!request.hasApiKey && !request.isLocalModel) issues.push({ kind: 'missing-api-key' })
  return issues
}

// ---------------------------------------------------------------------------
// §2.10.3：關掉 AI 時，從別處算好貼回來
// ---------------------------------------------------------------------------

export interface ParsedNutrition {
  kcal?: number
  proteinG?: number
  carbsG?: number
  fatG?: number
  sugarG?: number
  sodiumMg?: number
}

/**
 * 從貼上的文字抓出營養數字，本機正則、不呼叫任何模型（§2.10.3）。抓不到就當沒事。
 *
 * ⚠️ **不要假設格式。** 這段文字是使用者從任意一家網頁 LLM 複製回來的，
 * 每一家（甚至同一家的不同次回答）排版都不一樣，owner 2026-08-19 實測第一版
 * 全部抓不到，因為第一版要求數字**緊接在**標籤後面，而實際拿到的是：
 *
 * ```
 * 蛋白質：約4克
 * 碳水化合物：約30克
 * ```
 *
 * ——中間多了一個「約」就整段失效。**與其要求使用者照格式貼，不如讓解析寬鬆**
 * （要求使用者去改 prompt 等於把問題丟回去給他，而且換一家 LLM 又要重來）。
 * 現在容許：全形數字與冒號、`約`／`大約`／`~`／`≈` 之類的模糊詞、
 * 標籤與數字間的空白與換行、單位可有可無、中英文標籤、千分位逗號。
 */
export function parsePastedNutrition(text: string): ParsedNutrition {
  const normalized = normalizeForParsing(text)
  const result: ParsedNutrition = {}

  // 熱量另外處理：它常常是「320 大卡」這種**數字在前**的寫法，其他營養素則幾乎都是標籤在前。
  // 順序有意義：`320 kcal` 這種數字在前的寫法要先試——否則把 `kcal` 當標籤去找
  // 「後面第一個數字」，`320 kcal 蛋白 18g` 會把蛋白質的 18 當成熱量。
  const kcal =
    matchNumberBeforeUnit(normalized, ['kcal', '大卡', '卡路里']) ??
    matchLabelled(normalized, ['熱量', '卡路里', 'calories', 'calorie', 'energy'], ['kcal', '大卡', '卡'])
  if (kcal !== undefined) result.kcal = kcal

  const proteinG = matchLabelled(normalized, ['蛋白質', '蛋白', 'protein'], G_UNITS)
  if (proteinG !== undefined) result.proteinG = proteinG

  const carbsG = matchLabelled(normalized, ['碳水化合物', '碳水', '醣類', 'carbohydrates', 'carbohydrate', 'carbs'], G_UNITS)
  if (carbsG !== undefined) result.carbsG = carbsG

  const fatG = matchLabelled(normalized, ['總脂肪', '脂肪', 'fat'], G_UNITS)
  if (fatG !== undefined) result.fatG = fatG

  const sugarG = matchLabelled(normalized, ['糖', 'sugars', 'sugar'], G_UNITS)
  if (sugarG !== undefined) result.sugarG = sugarG

  const sodiumMg = matchLabelled(normalized, ['鈉', 'sodium', 'salt'], ['mg', '毫克'])
  if (sodiumMg !== undefined) result.sodiumMg = sodiumMg

  return result
}

const G_UNITS = ['g', 'gram', 'grams', '公克', '克']

/** 半形化：全形數字／冒號／括號一律轉成半形，各種空白（含不斷行空格）壓成一般空白。 */
function normalizeForParsing(text: string): string {
  return text
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[：︰]/g, ':')
    .replace(/[，、]/g, ',')
    .replace(/[ 　\t]/g, ' ')
}

/**
 * `標籤 …… 數字`：中間容許冒號／等號／破折號、`約`這類模糊詞、以及少量空白。
 *
 * 刻意**不**跨太遠（`[^\d\n]{0,12}`）：跨行或跨很多字去抓數字，
 * 「蛋白質很低，這份 320 大卡」這種句子就會把熱量誤認成蛋白質。
 * 寧可抓不到讓使用者手打，也不要填一個錯的數字進去——錯的數字他不會發現。
 */
function matchLabelled(text: string, labels: readonly string[], units: readonly string[]): number | undefined {
  const unitPattern = units.map(escapeRegExp).join('|')
  for (const label of labels) {
    const pattern = new RegExp(
      `${escapeRegExp(label)}[^\\d\\n,。;；]{0,10}?(\\d+(?:[.,]\\d+)?)\\s*(?:${unitPattern})?`,
      'i'
    )
    const match = text.match(pattern)
    if (match) {
      const value = toNumber(match[1])
      if (value !== undefined) return value
    }
  }
  return undefined
}

/** `320 大卡` 這種數字在前、標籤即單位的寫法。 */
function matchNumberBeforeUnit(text: string, units: readonly string[]): number | undefined {
  const unitPattern = units.map(escapeRegExp).join('|')
  const match = text.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:${unitPattern})`, 'i'))
  return match ? toNumber(match[1]) : undefined
}

function toNumber(raw: string): number | undefined {
  // `1,234` 是千分位、`1,5` 在部分語系是小數點——都先把逗號當千分位去掉，
  // 營養數字很少大到需要千分位，猜錯的代價比留著逗號讓 Number() 回 NaN 小。
  const value = Number(raw.replace(/,/g, ''))
  return Number.isFinite(value) ? value : undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// §2.6.2／§2.8.2：標示換算（算術一律本機做，模型只負責讀）
// ---------------------------------------------------------------------------

export interface NormalizedNutrition {
  kcal: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  sugarG: number | null
  sodiumMg: number | null
}

function scaleLabelValue(value: number | undefined, multiplier: number): number | null {
  return value === undefined ? null : value * multiplier
}

/**
 * 每100公克／每一份量／每包裝 → 實際吃下去的營養（§2.6.2）。
 * `eatenPortion` 依 basis 意義不同：`perServing`／`perPackage` 是吃了幾份／幾包；
 * `per100g` 是吃了幾個「一份量 × 份數」的包裝單位（缺 servingSizeG 時退化為直接倍率）。
 * 缺值一律回 null，不補假數字。
 */
export function normalizeLabel(label: FoodNutritionLabel, eatenPortion: number): NormalizedNutrition {
  const multiplier = resolveLabelMultiplier(label, eatenPortion)
  return {
    kcal: scaleLabelValue(label.kcal, multiplier),
    proteinG: scaleLabelValue(label.proteinG, multiplier),
    carbsG: scaleLabelValue(label.carbsG, multiplier),
    fatG: scaleLabelValue(label.fatG, multiplier),
    sugarG: scaleLabelValue(label.sugarG, multiplier),
    sodiumMg: scaleLabelValue(label.sodiumMg, multiplier)
  }
}

function resolveLabelMultiplier(label: FoodNutritionLabel, eatenPortion: number): number {
  if (label.basis === 'per100g') {
    if (label.servingSizeG === undefined) return eatenPortion
    const servingsPerPackage = label.servingsPerPackage ?? 1
    const totalGrams = label.servingSizeG * servingsPerPackage * eatenPortion
    return totalGrams / 100
  }
  // perServing／perPackage：標示本身已經是「一份」或「一包」的量，直接乘吃了幾份／幾包
  return eatenPortion
}

function resolvePer100g(label: FoodNutritionLabel): FoodNutritionLabel | null {
  if (label.basis === 'per100g') return label
  if (label.basis === 'perServing' && label.servingSizeG) {
    const factor = 100 / label.servingSizeG
    return {
      basis: 'per100g',
      kcal: label.kcal * factor,
      proteinG: label.proteinG * factor,
      carbsG: label.carbsG !== undefined ? label.carbsG * factor : undefined,
      fatG: label.fatG !== undefined ? label.fatG * factor : undefined,
      sugarG: label.sugarG !== undefined ? label.sugarG * factor : undefined,
      sodiumMg: label.sodiumMg !== undefined ? label.sodiumMg * factor : undefined
    }
  }
  return null
}

/** 秤重模式換算（§2.8.2）：標示缺每100公克基準且無法從 perServing 推得時回 null（呼叫端應提示改用份數）。 */
export function nutritionFromGrams(label: FoodNutritionLabel, grams: number): NormalizedNutrition | null {
  const per100g = resolvePer100g(label)
  if (!per100g) return null
  const multiplier = grams / 100
  return {
    kcal: scaleLabelValue(per100g.kcal, multiplier),
    proteinG: scaleLabelValue(per100g.proteinG, multiplier),
    carbsG: scaleLabelValue(per100g.carbsG, multiplier),
    fatG: scaleLabelValue(per100g.fatG, multiplier),
    sugarG: scaleLabelValue(per100g.sugarG, multiplier),
    sodiumMg: scaleLabelValue(per100g.sodiumMg, multiplier)
  }
}

// ---------------------------------------------------------------------------
// §2.7.3：份量欄級距
// ---------------------------------------------------------------------------

const SERVINGS_STEPS = [1 / 3, 1 / 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const SERVINGS_STEP_EPSILON = 1e-9

/** `−`／`＋` 走 1/3→1/2→1→2→…→10，到底不溢出；手打的非級距值會先找相鄰級距再走一步。 */
export function stepServings(current: number, direction: 'up' | 'down'): number {
  const exactIndex = SERVINGS_STEPS.findIndex((v) => Math.abs(v - current) < SERVINGS_STEP_EPSILON)
  if (exactIndex !== -1) {
    const nextIndex = direction === 'up' ? Math.min(exactIndex + 1, SERVINGS_STEPS.length - 1) : Math.max(exactIndex - 1, 0)
    return SERVINGS_STEPS[nextIndex]
  }
  if (direction === 'up') {
    const next = SERVINGS_STEPS.find((v) => v > current)
    return next ?? SERVINGS_STEPS[SERVINGS_STEPS.length - 1]
  }
  const prev = [...SERVINGS_STEPS].reverse().find((v) => v < current)
  return prev ?? SERVINGS_STEPS[0]
}

const SERVINGS_FRACTION_LABELS: Array<[number, string]> = [
  [1 / 3, '1/3'],
  [1 / 2, '1/2']
]

/** 顯示用分數（1/3、1/2），其餘直接顯示數字（含手打的非級距值，如 0.75）。 */
export function formatServings(value: number): string {
  for (const [fraction, label] of SERVINGS_FRACTION_LABELS) {
    if (Math.abs(value - fraction) < SERVINGS_STEP_EPSILON) return label
  }
  return Number.isInteger(value) ? String(value) : String(value)
}
