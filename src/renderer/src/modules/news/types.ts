/**
 * 新聞模組型別（前端入口）。
 *
 * ⚠️ 這裡曾經是「與 main 手動同步的第二份定義」，包含自己複製的
 * `DEFAULT_KEYWORD_GROUP_ID` 與 `effectiveGroupId`——正是 roadmap §4.1 要防的 drift。
 *
 * 現已改為 **re-export `@core/news/`**，共用同一份定義（B2）。
 * 既有 import 路徑一律不變。新增程式碼請直接 import `@core/news/...`。
 *
 * 本檔只保留**前端專屬**的東西：IPC 回傳形狀，以及 UI 文案
 * （UI 文案依 roadmap §3.3 不得進 `core/`）。
 */

export type {
  NewsWeight,
  LangMode,
  SpeakMode,
  NewsReplyModel,
  NewsSourceType,
  NewsSource,
  NewsKeywordGroup,
  NewsSelectionContext,
  NewsLocation,
  NewsModuleSettings,
  NewsItem
} from '@core/news/types'

export { DEFAULT_KEYWORD_GROUP_ID, effectiveGroupId } from '@core/news/keywordGroups'

import type { NewsWeight } from '@core/news/types'

// ── 以下為前端專屬，不進 core ────────────────────────────────

/** `news:preview` IPC 回傳的單則預覽（欄位少於 NewsItem，僅供設定頁試抽顯示）。 */
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

/** UI 文案：依 roadmap §3.3，介面用字一律留在前端。 */
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
