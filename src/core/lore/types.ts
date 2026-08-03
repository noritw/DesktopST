/**
 * Lorebook（用語解說）—— 資料模型。
 *
 * 規格：`docs/future-lorebook.md` §4／§5。做的是**用語解說子集**，不是完整 ST World Info：
 * 遞迴觸發（`recursive_scanning`）、插入深度（`position` / `depth`）、真 tokenizer 預算
 * 一律不實作，但**未實作的欄位原樣保存**（`_passthrough`），ST → DeST → ST 來回不掉資料。
 *
 * 欄位名沿用 ST V2 `character_book` 的 snake_case，方便直接對映。
 */

/** 一條用語解說。 */
export interface LoreEntry {
  id: string
  /** 觸發關鍵字；任一命中即觸發。同一件事的不同叫法都放這裡（規格 §1.1 的核心用法）。 */
  keys: string[]
  /** 注入 prompt 的內容 */
  content: string
  enabled: boolean
  /** true = 常駐注入，不需關鍵字命中 */
  constant: boolean
  case_sensitive?: boolean
  /** 排序用；小的在前 */
  insertion_order: number
  /** 超出預算時先砍**低**優先（沿用 ST 語意）。未設 = `DEFAULT_PRIORITY` */
  priority?: number
  /** 與 `selective` 搭配：keys 命中後還要 secondary_keys 也命中 */
  secondary_keys?: string[]
  selective?: boolean
  /** 使用者備註，不進 prompt */
  comment?: string
  /** 未實作欄位原樣保存，匯出時吐回（規格 §5.2） */
  _passthrough?: Record<string, unknown>
}

/** 一本用語解說。 */
export interface Lorebook {
  id: string
  name: string
  entries: LoreEntry[]
  /** 掃描最近幾則訊息；預設 `DEFAULT_SCAN_DEPTH` */
  scan_depth: number
  /** 注入上限，以**字元數**近似，非真 token；預設 `DEFAULT_TOKEN_BUDGET` */
  token_budget: number
  createdAt: number
  updatedAt: number
  /** 書層級未實作欄位原樣保存（`description` / `extensions` 等） */
  _passthrough?: Record<string, unknown>
}

/** 掃描最近幾則訊息（在 `keepRecentN` 之內再取後 N 則）。 */
export const DEFAULT_SCAN_DEPTH = 5

/** 注入上限（字元數近似，非真 token）。 */
export const DEFAULT_TOKEN_BUDGET = 2000

/**
 * `priority` 未設時的預設值。沿用 ST 的 100 ——
 * 使用者手動調高才會比預設更晚被砍，調低則更早被砍。
 */
export const DEFAULT_PRIORITY = 100

/** 情境模組覆蓋用的虛擬模組 id（比照 `desktopst.systemTime`）。 */
export const LORE_MODULE_ID = 'desktopst.lorebook'

export type LoreErrorCode = 'not-a-lorebook'

/**
 * core 只拋錯誤代碼，中文文案由平台層翻（roadmap §4.4b 的落地慣例，比照 `PngCardError`）。
 */
export class LoreError extends Error {
  readonly code: LoreErrorCode
  constructor(code: LoreErrorCode, message: string) {
    super(message)
    this.name = 'LoreError'
    this.code = code
  }
}
