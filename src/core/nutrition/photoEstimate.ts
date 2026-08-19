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

/** 組 prompt，不含個資（只送名稱清單，不送營養數字／體重／上限），見 §3.1。 */
export function buildPhotoEstimatePrompt(recentNames: readonly string[]): string {
  const lines: string[] = []
  lines.push('你是飲食記錄助手。使用者會提供 1～N 份食物的照片（每張標明所屬 slot），估算每份食物的營養資訊。')
  lines.push('')
  lines.push('規則（依優先序）：')
  lines.push('1. 若補充說明文字有提到品項或份量，一律以文字為準，不得用圖片推論覆蓋；文字未提到的部分才從圖片判斷。')
  lines.push('2. 若任一張是營養成分表，必須逐欄讀出填入 label，不得改用經驗值；nutritionSource 標記為 label（完整）或 label-partial（缺欄位）。')
  lines.push('3. 食物可能被包裝紙、紙袋、餐盒部分遮住，只根據可見部分推論，看不到的餡料不要編；用可見的份量線索推份量，不要一律預設一份。')
  lines.push('4. 同時估算 carbsG、fatG、sugarG（公克）、sodiumMg（毫克，注意台灣標示的鈉單位固定是毫克，不要跟公克搞混）；成分表有就讀、沒有就依常識粗估，抓不到就留空，不要求精確。')
  lines.push('5. 若文字與圖片明顯矛盾，以文字為準，並在 noteConflict 說明差異；無矛盾則 noteConflict 為 null。')
  if (recentNames.length > 0) {
    lines.push('')
    lines.push(`使用者最近／最常吃的食物名稱（優先沿用既有名稱以提高比對命中率）：${recentNames.join('、')}`)
  }
  lines.push('')
  lines.push('請以 JSON 陣列回覆，陣列順序須對齊送出的 slot（slot: 1..N），每個元素為單份食物的估算結果。')
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

function parsePerServing(raw: unknown): FoodNutritionPerServing | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const kcal = toFiniteNumber(obj.kcal)
  const proteinG = toFiniteNumber(obj.proteinG)
  if (kcal === undefined || proteinG === undefined) return null
  const result: FoodNutritionPerServing = { kcal, proteinG }
  const carbsG = toFiniteNumber(obj.carbsG)
  const fatG = toFiniteNumber(obj.fatG)
  const sugarG = toFiniteNumber(obj.sugarG)
  const sodiumMg = toFiniteNumber(obj.sodiumMg)
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
  return {
    slot,
    name: toStringOrNull(obj.name),
    brand: toStringOrNull(obj.brand),
    flavor: toStringOrNull(obj.flavor),
    servings: toFiniteNumber(obj.servings) ?? null,
    perServing: parsePerServing(obj.perServing),
    nutritionSource,
    label: parseLabel(obj.label),
    confidence,
    appliedNote: obj.appliedNote === true,
    noteConflict: toStringOrNull(obj.noteConflict),
    note: toStringOrNull(obj.note)
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

/** 從貼上的文字抓出營養數字，本機正則、不呼叫任何模型（§2.10.3）。抓不到就當沒事。 */
export function parsePastedNutrition(text: string): ParsedNutrition {
  const result: ParsedNutrition = {}

  const kcalMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:kcal|大卡)/i) ?? text.match(/熱量\s*[:：]?\s*(\d+(?:\.\d+)?)/)
  if (kcalMatch) result.kcal = Number(kcalMatch[1])

  const proteinMatch = text.match(/蛋白質?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:g|克|公克)/i)
  if (proteinMatch) result.proteinG = Number(proteinMatch[1])

  const carbsMatch = text.match(/碳水(?:化合物)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:g|克|公克)/i)
  if (carbsMatch) result.carbsG = Number(carbsMatch[1])

  const fatMatch = text.match(/脂肪\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:g|克|公克)/i)
  if (fatMatch) result.fatG = Number(fatMatch[1])

  const sugarMatch = text.match(/糖\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:g|克|公克)/i)
  if (sugarMatch) result.sugarG = Number(sugarMatch[1])

  const sodiumMatch = text.match(/鈉\s*[:：]?\s*(\d+(?:\.\d+)?)\s*mg/i)
  if (sodiumMatch) result.sodiumMg = Number(sodiumMatch[1])

  return result
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
