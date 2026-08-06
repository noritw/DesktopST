import type { NewsItem, NewsKeywordGroup, NewsSource } from '../../modules/news/types'
import { DEFAULT_KEYWORD_GROUP_ID, effectiveGroupId } from '../../modules/news/types'
import {
  BREAKOUT_SECTION_ID, LOCAL_SECTION_ID, OTHER_SECTION_ID, groupReaderSections
} from '@core/news/reader'

export const BREAKOUT_GROUP_ID = BREAKOUT_SECTION_ID
export const BREAKOUT_GROUP_LABEL = '🔥 熱門話題'
export const LOCAL_GROUP_ID = LOCAL_SECTION_ID
export const LOCAL_GROUP_LABEL = '📍 地方新聞'
export const OTHER_GROUP_ID = OTHER_SECTION_ID
export const OTHER_GROUP_LABEL = '其他'

export interface GroupedNews {
  /** keywordGroup.id、sourceId、或特殊 id（破圈／地方／單一關鍵字） */
  groupId: string
  /** 顯示名稱 */
  label: string
  items: NewsItem[]
}

/**
 * 依「關鍵字標籤組」（情境／新聞報多選的那一層）分牆。
 * 用於頂部篩選 tab。
 */
export function groupNewsItems(
  items: NewsItem[],
  sources: NewsSource[],
  keywordGroups: NewsKeywordGroup[] = []
): GroupedNews[] {
  const sourceById = new Map(sources.map(s => [s.id, s]))
  const groups = keywordGroups.length > 0
    ? keywordGroups
    : [{ id: DEFAULT_KEYWORD_GROUP_ID, name: '預設組' }]

  const breakoutItems: NewsItem[] = []
  const localItems: NewsItem[] = []
  const otherItems: NewsItem[] = []
  const keywordBuckets = new Map<string, NewsItem[]>()
  const feedBuckets = new Map<string, { label: string; items: NewsItem[] }>()

  for (const g of groups) {
    keywordBuckets.set(g.id, [])
  }

  for (const item of items) {
    if (item.breakout === true) {
      breakoutItems.push(item)
      continue
    }
    if (item.sourceId.startsWith('loc-')) {
      localItems.push(item)
      continue
    }

    const src = sourceById.get(item.sourceId)
    if (src?.type === 'keyword' || item.sourceType === 'keyword') {
      const gid = effectiveGroupId(src?.groupId)
      const bucket = keywordBuckets.get(gid)
      if (bucket) bucket.push(item)
      else {
        const fallback = keywordBuckets.get(DEFAULT_KEYWORD_GROUP_ID)
        if (fallback) fallback.push(item)
        else otherItems.push(item)
      }
      continue
    }

    if (src) {
      const existing = feedBuckets.get(src.id)
      if (existing) existing.items.push(item)
      else feedBuckets.set(src.id, { label: src.label, items: [item] })
      continue
    }

    otherItems.push(item)
  }

  const result: GroupedNews[] = []

  if (breakoutItems.length > 0) {
    result.push({ groupId: BREAKOUT_GROUP_ID, label: BREAKOUT_GROUP_LABEL, items: breakoutItems })
  }

  for (const g of groups) {
    const list = keywordBuckets.get(g.id) ?? []
    if (list.length > 0) {
      result.push({ groupId: g.id, label: g.name, items: list })
    }
  }

  if (localItems.length > 0) {
    result.push({ groupId: LOCAL_GROUP_ID, label: LOCAL_GROUP_LABEL, items: localItems })
  }

  for (const [id, { label, items: feedItems }] of feedBuckets) {
    if (feedItems.length > 0) {
      result.push({ groupId: `feed:${id}`, label, items: feedItems })
    }
  }

  if (otherItems.length > 0) {
    result.push({ groupId: OTHER_GROUP_ID, label: OTHER_GROUP_LABEL, items: otherItems })
  }

  return result
}

/**
 * 報紙牆用：依「單一關鍵字／來源」分框。
 * 同樣關鍵字的新聞放同一格，破圈／地方／RSS 各自成框。
 *
 * ⚠️ **規則本體在 `@core/news/reader`**（B3 階段 6）：手機版原本在
 * `assets/mobile.html` 抄了第二份（`nrGroupByKeyword`），改 React 時統一走 core。
 * 這裡只剩「固定欄要顯示什麼標題」——那是 UI 文案，不進 core（roadmap §3.3）。
 */
export function groupNewsItemsByKeyword(
  items: NewsItem[],
  sources: NewsSource[]
): GroupedNews[] {
  return groupReaderSections(items, sources).map(sec => ({
    groupId: sec.groupId,
    label: sec.label || FIXED_SECTION_LABELS[sec.groupId] || sec.groupId,
    items: sec.items
  }))
}

const FIXED_SECTION_LABELS: Record<string, string> = {
  [BREAKOUT_GROUP_ID]: BREAKOUT_GROUP_LABEL,
  [LOCAL_GROUP_ID]: LOCAL_GROUP_LABEL,
  [OTHER_GROUP_ID]: OTHER_GROUP_LABEL
}
