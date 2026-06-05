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
  origin?: 'user' | 'location' | 'builtin'
}

export interface NewsLocation {
  name: string
  weight: NewsWeight
  fromDetection?: boolean
}

export interface NewsModuleSettings {
  enabled: boolean
  sources: NewsSource[]
  blacklist: string[]
  excludedCategories: string[]
  excludedSources: string[]
  langMode: LangMode
  speakButton: SpeakMode
  replyModel: NewsReplyModel
  reminder: { enabled: boolean }
  breakout: { enabled: boolean; weight: NewsWeight }
  localNews: { enabled: boolean; locations: NewsLocation[] }
  feedback: { adjustments: Record<string, number> }
  seenIds: string[]
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
