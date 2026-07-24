// 與 src/main/modules/news/types.ts 對應（兩邊手動同步，僅前端需要的欄位）

export type NewsWeight = 'often' | 'normal' | 'rarely'
export type LangMode = 'zh-only' | 'translate' | 'raw'
export type SpeakMode = 'off' | 'sometimes' | 'always'
export type NewsReplyModel = 'main' | 'utility'
export type NewsSourceType = 'keyword' | 'rss' | 'json'

export interface NewsSource {
  id: string
  type: NewsSourceType
  label: string
  url?: string
  weight: NewsWeight
  enabled: boolean
  origin?: 'user' | 'location' | 'builtin' | 'character'
  /** 興趣關鍵字所屬的組（只作用在 keyword）；未設視為預設組。 */
  groupId?: string
  /** 新聞報此關鍵字則數；未設跟全域 readerPerKeyword */
  readerQuota?: number
}

export interface NewsKeywordGroup {
  id: string
  name: string
}

/** 內建「預設組」id。 */
export const DEFAULT_KEYWORD_GROUP_ID = 'default'

/** undefined / 空字串視為預設組。 */
export function effectiveGroupId(groupId: string | undefined): string {
  return groupId && groupId.length > 0 ? groupId : DEFAULT_KEYWORD_GROUP_ID
}

export interface NewsLocation {
  name: string
  weight: NewsWeight
  fromDetection?: boolean
}

export interface NewsModuleSettings {
  enabled: boolean
  sources: NewsSource[]
  keywordGroups: NewsKeywordGroup[]
  blacklist: string[]
  excludedCategories: string[]
  excludedSources: string[]
  reducedSources: string[]
  langMode: LangMode
  speakButton: SpeakMode
  replyModel: NewsReplyModel
  reminder: { enabled: boolean }
  breakout: { enabled: boolean; weight: NewsWeight; /** 熱門只要中文，預設 true */ zhOnly?: boolean }
  localNews: { enabled: boolean; locations: NewsLocation[] }
  feedback: { adjustments: Record<string, number> }
  seenIds: string[]
  /** 幾天以前的文章排除，0 = 不限制，預設 30 */
  maxAgeDays: number
  /** 新聞報每次顯示筆數，預設 30，範圍 5–100 */
  readerMaxItems?: number
  /** 新聞報每個關鍵字預設抓幾則，預設 3，範圍 1–20 */
  readerPerKeyword?: number
  /** 新聞報熱門／破圈抓幾則，預設 3，範圍 0–20 */
  readerBreakoutQuota?: number
  /**
   * 個人新聞報要抓哪些關鍵字組（可多選）。
   * 空陣列／未設 = 全部組；聊天仍只用情境綁定的那一組。
   */
  readerKeywordGroupIds?: string[]
  conversationSearch?: {
    enabled: boolean
    triggerWords: string[]
    /** 只收幾小時內的文章；0 = 不限制 */
    maxAgeHours: number
  }
}

/**
 * 正規化後的單則新聞（與 src/main/modules/news/types.ts 同步，僅前端需要的欄位）。
 */
export interface NewsItem {
  id: string
  title: string
  summary: string
  source: string
  category?: string
  tags: string[]
  url: string
  publishedAt: string
  image?: string
  sourceId: string
  sourceType: NewsSourceType
  sourceWeight: NewsWeight
  breakout?: boolean
  keyword?: string
  lang?: string
}

export interface NewsPreviewItem {
  id: string
  title: string
  summary: string
  source: string
  url: string
  category?: string
  tags: string[]
  breakout?: boolean
}

export interface NewsPreviewResult {
  ok: boolean
  error?: string
  item?: NewsPreviewItem | null
  candidateCount?: number
  stats?: Record<string, number>
}

export const WEIGHT_LABELS: Record<NewsWeight, string> = {
  often: '常聊',
  normal: '普通',
  rarely: '偶爾'
}

export const WEIGHT_CYCLE: NewsWeight[] = ['normal', 'often', 'rarely']

export function nextWeight(w: NewsWeight): NewsWeight {
  const i = WEIGHT_CYCLE.indexOf(w)
  return WEIGHT_CYCLE[(i + 1) % WEIGHT_CYCLE.length]
}
