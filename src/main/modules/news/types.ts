import type { ReminderSchedule } from '../../types'

/** 常聊 / 普通 / 偶爾（加權隨機時約對應 3 / 2 / 1） */
export type NewsWeight = 'often' | 'normal' | 'rarely'

/** 只要繁中 / 翻成繁中 / 原文照收 */
export type LangMode = 'zh-only' | 'translate' | 'raw'

/** 「說點什麼」抓新聞：關 / 偶爾 / 每次 */
export type SpeakMode = 'off' | 'sometimes' | 'always'

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
  /** 來源出處：使用者新增 / 地方新聞帶入 / 內建 */
  origin?: 'user' | 'location' | 'builtin'
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
  /** 黑名單關鍵字（比對 title / summary / tags / category / source） */
  blacklist: string[]
  excludedCategories: string[]
  excludedSources: string[]
  /** 語言處理，預設 'translate' */
  langMode: LangMode
  /** 「說點什麼」抓新聞，預設 'sometimes' */
  speakButton: SpeakMode
  /** 選配的提醒觸發 */
  reminder: {
    enabled: boolean
    schedule?: ReminderSchedule
  }
  /** 破圈話題（防同溫層） */
  breakout: {
    enabled: boolean
    weight: NewsWeight
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
