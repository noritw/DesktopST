import type { ReminderSchedule } from '../types'

/** 常聊 / 普通 / 偶爾（加權隨機時約對應 3 / 2 / 1） */
export type NewsWeight = 'often' | 'normal' | 'rarely'

/** 只要繁中 / 翻成繁中 / 原文照收 */
export type LangMode = 'zh-only' | 'translate' | 'raw'

/** 「說點什麼」抓新聞：關 / 偶爾 / 每次 */
export type SpeakMode = 'off' | 'sometimes' | 'always'

/** 新聞陪聊的角色化輸出要走哪個模型：主要（口吻優先）/ 輔助（成本優先） */
export type NewsReplyModel = 'main' | 'utility'

/** 來源類型：興趣關鍵字 / 任意 RSS / 自架聚合站 JSON */
export type NewsSourceType = 'keyword' | 'rss' | 'json'

export interface NewsSource {
  id: string
  type: NewsSourceType
  /** keyword 時即關鍵字本身；rss / json 為使用者命名 */
  label: string
  /** rss / json 用；keyword 由 label 自動組成、不存 */
  url?: string
  /** 預設 'normal' */
  weight: NewsWeight
  enabled: boolean
  /** 來源出處：使用者新增 / 地方新聞帶入 / 內建 / 角色卡帶入 */
  origin?: 'user' | 'location' | 'builtin' | 'character'
  /**
   * 興趣關鍵字所屬的組（只作用在 type === 'keyword'）；未設視為預設組。
   * rss / json 維持全域 always-on，不分組。
   */
  groupId?: string
  /**
   * 個人新聞報：此關鍵字最多顯示幾則（1–20）。
   * 未設則用全域 `readerPerKeyword`；只影響新聞報，不影響聊天抽選權重。
   */
  readerQuota?: number
}

/** 關鍵字分組（情境綁定用，取代式切換興趣池） */
export interface NewsKeywordGroup {
  id: string
  /** 情境設定下拉只顯示這個名稱 */
  name: string
}

/**
 * 抽選一則新聞時的情境 / 角色脈絡：
 * - sceneGroupId：當前 Scene 綁定的關鍵字組（取代式，undefined = 預設組）。
 * - characterKeywords：當前發話角色的 newsKeywords（疊加，普通權重）。
 * - allKeywordGroups：個人新聞報舊捷徑，抓全部組。
 * - readerKeywordGroupIds：個人新聞報多選組；有值且非空時只抓這些組（優先於 allKeywordGroups）。
 */
export interface NewsSelectionContext {
  sceneGroupId?: string
  characterKeywords?: string[]
  /** true 時抓取／比對所有啟用的關鍵字組（新聞報：未指定多選時） */
  allKeywordGroups?: boolean
  /** 新聞報指定要抓的關鍵字組；非空時只抓這些組 */
  readerKeywordGroupIds?: string[]
}

/** 地方新聞的單一縣市 */
export interface NewsLocation {
  name: string
  weight: NewsWeight
  /** 由天氣定位自動帶入 */
  fromDetection?: boolean
}

/** 模組設定（存模組設定信封 ModuleSettingsEnvelope.data，design §12） */
export interface NewsModuleSettings {
  enabled: boolean
  sources: NewsSource[]
  /** 關鍵字分組（必含一個內建「預設組」，id = 'default'）。情境靠 groupId 取代式切換興趣池。 */
  keywordGroups: NewsKeywordGroup[]
  /** 黑名單關鍵字（比對 title / summary / tags / category / source） */
  blacklist: string[]
  excludedCategories: string[]
  excludedSources: string[]
  /** 降低顯示權重的來源（非封鎖，仍會抽到只是機率變低；比對方式同 excludedSources） */
  reducedSources: string[]
  /** 語言處理，預設 'translate' */
  langMode: LangMode
  /** 「說點什麼」抓新聞，預設 'sometimes' */
  speakButton: SpeakMode
  /** 新聞陪聊走哪個模型，預設 'main'（口吻優先，避免便宜模型壓平角色語氣） */
  replyModel: NewsReplyModel
  /** 選配的提醒觸發 */
  reminder: {
    enabled: boolean
    schedule?: ReminderSchedule
  }
  /** 破圈話題（防同溫層） */
  breakout: {
    enabled: boolean
    weight: NewsWeight
    /**
     * 熱門話題只要中文標題（預設 true）。
     * 與全域 langMode 分開：聊天可收外文翻譯，熱門／新聞報仍可只要看得懂的中文。
     */
    zhOnly?: boolean
  }
  /** 地方新聞（沿用天氣定位，多縣市） */
  localNews: {
    enabled: boolean
    locations: NewsLocation[]
  }
  /** 學習到的微調（key = sourceId / 關鍵字 / 分類），可一鍵重置 */
  feedback: {
    adjustments: Record<string, number>
  }
  /** 已聊過的新聞 id（去重） */
  seenIds: string[]
  /** 幾天以前的文章排除，0 = 不限制，預設 30 */
  maxAgeDays: number
  /** 新聞報每次顯示筆數，預設 30，範圍 5–100 */
  readerMaxItems?: number
  /** 新聞報每個關鍵字預設抓幾則，預設 3，範圍 1–20（可被單一關鍵字 readerQuota 覆蓋） */
  readerPerKeyword?: number
  /** 新聞報熱門／破圈話題抓幾則，預設 3，範圍 0–20（0＝新聞報不顯示熱門） */
  readerBreakoutQuota?: number
  /**
   * 個人新聞報要抓哪些關鍵字組（可多選）。
   * 空陣列／未設 = 全部組（逛書店感預設）；聊天仍只用情境綁定的那一組。
   */
  readerKeywordGroupIds?: string[]
  /** 對話新聞搜尋（被動、對話觸發的即時 Google News 查詢） */
  conversationSearch?: {
    enabled: boolean
    /** 前置過濾觸發詞；空陣列 = 不過濾（每則都送 LLM） */
    triggerWords: string[]
    /** 只收幾小時內的文章；0 = 不限制 */
    maxAgeHours: number
  }
  /**
   * 聊新聞時是否補強上下文（抓原文／輔助模型大意）。
   * 預設 true；關閉＝舊行為（標題＋RSS summary）。
   */
  enrichForChat?: boolean
}

/** 偵測到的文字主要語言（輕量字元判斷，非完整語言庫） */
export type DetectedLang = 'zh-hant' | 'zh-hans' | 'ja' | 'ko' | 'other'

/**
 * 正規化後的單則新聞（沿用 news-feed-spec.md 欄位 + 抓取後附掛的內部欄位）。
 */
export interface NewsItem {
  /** 全站唯一且穩定的識別碼（去重靠它） */
  id: string
  title: string
  summary: string
  source: string
  category?: string
  tags: string[]
  url: string
  /** ISO 8601；抓不到時為空字串 */
  publishedAt: string
  image?: string
  // ----- 抓取後附掛（非來源資料） -----
  /** 來自哪個 NewsSource */
  sourceId: string
  sourceType: NewsSourceType
  /** 該來源的權重，供加權隨機 */
  sourceWeight: NewsWeight
  /** 是否為破圈（圈外熱門）話題 */
  breakout?: boolean
  /** 來源若為 keyword，帶上該興趣關鍵字（供「封鎖關鍵字」用） */
  keyword?: string
  /** 偵測語言（filter 階段填入） */
  lang?: DetectedLang
  /**
   * 這次聊天實際進 Prompt 的上下文（節錄／摘要／使用者改過的版本）。
   * 不寫回 RSS；只掛在執行期／訊息 newsLink 上。
   */
  promptContext?: string
}

/** json 來源的最外層契約（news-feed-spec.md §3.1） */
export interface NewsFeedJson {
  version: number
  generatedAt: string
  categories?: string[]
  items: Array<{
    id: string
    title: string
    summary?: string
    source: string
    category?: string
    tags?: string[]
    url: string
    publishedAt: string
    image?: string
  }>
}
