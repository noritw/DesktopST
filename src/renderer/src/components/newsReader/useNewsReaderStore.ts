import { create } from 'zustand'
import type { NewsItem, NewsKeywordGroup, NewsSource } from '../../modules/news/types'

const LS_DISPLAY_MODE = 'desktopst.newsReader.displayMode'
const LS_ACTIVE_TAB = 'desktopst.newsReader.activeTab'
const LS_PINNED_ITEMS = 'desktopst.newsReader.pinnedItems'
const LS_DISMISSED = 'desktopst.newsReader.dismissedIds'

type DisplayMode = 'title' | 'title-summary'

function readDisplayMode(): DisplayMode {
  const stored = localStorage.getItem(LS_DISPLAY_MODE)
  return stored === 'title-summary' ? 'title-summary' : 'title'
}

function readActiveTab(): string {
  return localStorage.getItem(LS_ACTIVE_TAB) || 'all'
}

function readPinnedItems(): NewsItem[] {
  try {
    const raw = localStorage.getItem(LS_PINNED_ITEMS)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((it): it is NewsItem =>
      !!it && typeof it === 'object' && typeof (it as NewsItem).id === 'string' && typeof (it as NewsItem).title === 'string'
    )
  } catch {
    return []
  }
}

function writePinnedItems(items: NewsItem[]): void {
  localStorage.setItem(LS_PINNED_ITEMS, JSON.stringify(items))
}

function readDismissedIds(): string[] {
  try {
    const raw = localStorage.getItem(LS_DISMISSED)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(-500)
  } catch {
    return []
  }
}

function writeDismissedIds(ids: string[]): void {
  localStorage.setItem(LS_DISMISSED, JSON.stringify(ids.slice(-500)))
}

function itemBucketKey(item: NewsItem): string {
  if (item.breakout) return '__breakout__'
  if (item.sourceId?.startsWith('loc-')) return '__local__'
  if (item.sourceType === 'keyword' || item.keyword) return `kw:${item.sourceId}`
  return `feed:${item.sourceId || item.id}`
}

/**
 * 釘選換一批：各欄最多保留「釘選 +（配額−釘選數）則新稿」。
 * 不會沿用舊畫面已膨脹的長度（修「設 3 卻留 46」）。
 */
function mergeKeepingPins(
  previous: NewsItem[],
  fresh: NewsItem[],
  pinnedIds: ReadonlySet<string>,
  pinnedItems: NewsItem[],
  getQuota: (bucketKey: string) => number
): NewsItem[] {
  const pinnedById = new Map<string, NewsItem>()
  for (const p of pinnedItems) pinnedById.set(p.id, p)
  for (const p of previous) {
    if (pinnedIds.has(p.id)) pinnedById.set(p.id, p)
  }

  const freshByBucket = new Map<string, NewsItem[]>()
  for (const item of fresh) {
    if (pinnedIds.has(item.id)) continue
    const key = itemBucketKey(item)
    const list = freshByBucket.get(key)
    if (list) list.push(item)
    else freshByBucket.set(key, [item])
  }

  const prevByBucket = new Map<string, NewsItem[]>()
  for (const item of previous) {
    const key = itemBucketKey(item)
    const list = prevByBucket.get(key)
    if (list) list.push(item)
    else prevByBucket.set(key, [item])
  }

  const bucketOrder: string[] = []
  const seenBucket = new Set<string>()
  const pushBucket = (key: string) => {
    if (seenBucket.has(key)) return
    seenBucket.add(key)
    bucketOrder.push(key)
  }
  for (const item of previous) pushBucket(itemBucketKey(item))
  for (const p of pinnedById.values()) pushBucket(itemBucketKey(p))
  for (const key of freshByBucket.keys()) pushBucket(key)

  const usedFresh = new Set<string>()
  const result: NewsItem[] = []
  const seen = new Set<string>()

  const takeFresh = (bucket: string): NewsItem | null => {
    const list = freshByBucket.get(bucket)
    if (!list || list.length === 0) return null
    while (list.length > 0) {
      const next = list.shift()!
      if (usedFresh.has(next.id) || pinnedIds.has(next.id) || seen.has(next.id)) continue
      usedFresh.add(next.id)
      return next
    }
    return null
  }

  for (const bucket of bucketOrder) {
    const prevItems = prevByBucket.get(bucket) ?? []
    const pinnedInOrder: NewsItem[] = []
    for (const item of prevItems) {
      if (!pinnedIds.has(item.id)) continue
      const kept = pinnedById.get(item.id) ?? item
      if (!seen.has(kept.id)) {
        pinnedInOrder.push(kept)
        seen.add(kept.id)
      }
    }
    for (const p of pinnedById.values()) {
      if (itemBucketKey(p) !== bucket || seen.has(p.id)) continue
      pinnedInOrder.push(p)
      seen.add(p.id)
    }

    const quota = getQuota(bucket)
    // 釘選永遠保留；其餘名額 = max(0, quota - 釘選數)
    const need = Math.max(0, quota - pinnedInOrder.length)

    const section: NewsItem[] = [...pinnedInOrder]
    let taken = 0

    // 依舊順序把未釘選格換成新稿，但最多 need 則（裁掉膨脹的舊格）
    for (const item of prevItems) {
      if (taken >= need) break
      if (pinnedIds.has(item.id)) continue
      const replacement = takeFresh(bucket)
      if (!replacement) break
      section.push(replacement)
      seen.add(replacement.id)
      taken++
    }
    while (taken < need) {
      const replacement = takeFresh(bucket)
      if (!replacement) break
      section.push(replacement)
      seen.add(replacement.id)
      taken++
    }

    result.push(...section)
  }

  return result
}

interface NewsReaderState {
  items: NewsItem[]
  sources: NewsSource[]
  keywordGroups: NewsKeywordGroup[]
  readerKeywordGroupIds: string[]
  readerMaxItems: number
  readerPerKeyword: number
  readerBreakoutQuota: number
  pinnedItems: NewsItem[]
  dismissedIds: string[]
  isLoading: boolean
  error: string | null
  displayMode: DisplayMode
  activeTab: string
  fetchedAt: number | null

  fetchNews: (opts?: { excludeCurrent?: boolean }) => Promise<void>
  setDisplayMode: (mode: DisplayMode) => void
  setActiveTab: (tab: string) => void
  setReaderKeywordGroups: (ids: string[]) => Promise<void>
  /** 讀取某報紙欄的目標抓取則數（section.groupId） */
  getSectionQuota: (sectionGroupId: string) => number
  /** 直接改某欄則數並重新整理 */
  setSectionQuota: (sectionGroupId: string, quota: number) => Promise<void>
  togglePin: (item: NewsItem) => void
  isPinned: (itemId: string) => boolean
  /** 這則不要看了：從畫面拿掉，之後換一批／重整也不再出現 */
  dismissItem: (itemId: string) => void
  insertToInput: (item: NewsItem) => void
}

type FetchBatchResponse =
  | {
      ok: true
      items: NewsItem[]
      fetchedAt: number
      sources?: NewsSource[]
      keywordGroups?: NewsKeywordGroup[]
      readerKeywordGroupIds?: string[]
      readerMaxItems?: number
      readerPerKeyword?: number
      readerBreakoutQuota?: number
    }
  | { ok: false; error: string }

export const useNewsReaderStore = create<NewsReaderState>((set, get) => ({
  items: [],
  sources: [],
  keywordGroups: [],
  readerKeywordGroupIds: [],
  readerMaxItems: 30,
  readerPerKeyword: 3,
  readerBreakoutQuota: 3,
  pinnedItems: readPinnedItems(),
  dismissedIds: readDismissedIds(),
  isLoading: false,
  error: null,
  displayMode: readDisplayMode(),
  activeTab: readActiveTab(),
  fetchedAt: null,

  fetchNews: async (opts) => {
    set({ isLoading: true, error: null })
    try {
      const { items: current, readerMaxItems, pinnedItems, dismissedIds } = get()
      const pinnedIds = new Set(pinnedItems.map(p => p.id))
      const dismissedSet = new Set(dismissedIds)
      const excludeCurrent = opts?.excludeCurrent === true

      // 換一批：排除畫面上全部（含釘選）以免重複；釘選之後本地併回
      // 一般整理：至少排除釘選 id；已消掉的一律排除
      const excludeIds = [...new Set([
        ...(excludeCurrent
          ? [...current.map(i => i.id), ...pinnedItems.map(p => p.id)]
          : pinnedIds.size > 0
            ? [...pinnedIds]
            : []),
        ...dismissedIds
      ].filter(Boolean))]

      const result = (await window.api.invoke('news:fetch-batch', {
        maxItems: readerMaxItems,
        excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
        strictExclude: excludeCurrent || pinnedIds.size > 0 || dismissedIds.length > 0
      })) as FetchBatchResponse

      if (result.ok) {
        let nextItems = result.items.filter(i => !dismissedSet.has(i.id))
        if (pinnedIds.size > 0 || excludeCurrent) {
          nextItems = mergeKeepingPins(
            current,
            nextItems,
            pinnedIds,
            pinnedItems,
            (bucket) => get().getSectionQuota(bucket)
          ).filter(i => !dismissedSet.has(i.id))
        }

        // 釘選清單只保留還「概念上釘著」的；內容用最新 items 同步
        const nextPinned = pinnedItems
          .map(p => nextItems.find(i => i.id === p.id) ?? p)
          .filter(p => pinnedIds.has(p.id))
        writePinnedItems(nextPinned)

        set({
          items: nextItems,
          fetchedAt: result.fetchedAt,
          sources: Array.isArray(result.sources) ? result.sources : [],
          keywordGroups: Array.isArray(result.keywordGroups) ? result.keywordGroups : [],
          readerKeywordGroupIds: Array.isArray(result.readerKeywordGroupIds)
            ? result.readerKeywordGroupIds
            : [],
          readerMaxItems: typeof result.readerMaxItems === 'number' ? result.readerMaxItems : 30,
          readerPerKeyword: typeof result.readerPerKeyword === 'number' ? result.readerPerKeyword : 3,
          readerBreakoutQuota: typeof result.readerBreakoutQuota === 'number' ? result.readerBreakoutQuota : 3,
          pinnedItems: nextPinned,
          isLoading: false
        })
      } else {
        set({ error: result.error, isLoading: false })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message, isLoading: false })
    }
  },

  setDisplayMode: (mode: DisplayMode) => {
    localStorage.setItem(LS_DISPLAY_MODE, mode)
    set({ displayMode: mode })
  },

  setActiveTab: (tab: string) => {
    localStorage.setItem(LS_ACTIVE_TAB, tab)
    set({ activeTab: tab })
  },

  setReaderKeywordGroups: async (ids: string[]) => {
    set({ readerKeywordGroupIds: ids, isLoading: true, error: null })
    try {
      await window.api.invoke('news:save-settings', { readerKeywordGroupIds: ids })
      await get().fetchNews()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message, isLoading: false })
    }
  },

  getSectionQuota: (sectionGroupId: string) => {
    const { sources, readerPerKeyword, readerBreakoutQuota } = get()
    if (sectionGroupId === '__breakout__') return readerBreakoutQuota
    if (sectionGroupId.startsWith('kw:')) {
      const src = sources.find(s => s.id === sectionGroupId.slice(3))
      if (typeof src?.readerQuota === 'number' && src.readerQuota >= 1) return src.readerQuota
      return readerPerKeyword
    }
    return readerPerKeyword
  },

  setSectionQuota: async (sectionGroupId: string, quota: number) => {
    const n = Math.max(0, Math.min(20, Math.floor(quota)))
    if (!Number.isFinite(n)) return
    set({ isLoading: true, error: null })
    try {
      if (sectionGroupId === '__breakout__') {
        await window.api.invoke('news:save-settings', { readerBreakoutQuota: n })
        set({ readerBreakoutQuota: n })
      } else if (sectionGroupId.startsWith('kw:')) {
        const sourceId = sectionGroupId.slice(3)
        const { sources, readerPerKeyword } = get()
        const nextSources = sources.map(s => {
          if (s.id !== sourceId) return s
          // 與全域相同就清掉覆寫，改回「報·—」
          if (n === readerPerKeyword || n < 1) {
            const { readerQuota: _drop, ...rest } = s
            return rest
          }
          return { ...s, readerQuota: Math.max(1, n) }
        })
        await window.api.invoke('news:save-settings', { sources: nextSources })
        set({ sources: nextSources })
      } else {
        // 地方／RSS 等：改全域每關鍵字預設
        const v = Math.max(1, n)
        await window.api.invoke('news:save-settings', { readerPerKeyword: v })
        set({ readerPerKeyword: v })
      }
      await get().fetchNews()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message, isLoading: false })
    }
  },

  togglePin: (item: NewsItem) => {
    const { pinnedItems, dismissedIds } = get()
    const exists = pinnedItems.some(p => p.id === item.id)
    const next = exists
      ? pinnedItems.filter(p => p.id !== item.id)
      : [...pinnedItems.filter(p => !dismissedIds.includes(p.id)), item]
    writePinnedItems(next)
    set({ pinnedItems: next })
  },

  isPinned: (itemId: string) => get().pinnedItems.some(p => p.id === itemId),

  dismissItem: (itemId: string) => {
    const { items, pinnedItems, dismissedIds } = get()
    if (!itemId) return
    const nextDismissed = dismissedIds.includes(itemId)
      ? dismissedIds
      : [...dismissedIds, itemId].slice(-500)
    writeDismissedIds(nextDismissed)
    const nextPinned = pinnedItems.filter(p => p.id !== itemId)
    if (nextPinned.length !== pinnedItems.length) writePinnedItems(nextPinned)
    set({
      dismissedIds: nextDismissed,
      pinnedItems: nextPinned,
      items: items.filter(i => i.id !== itemId)
    })
  },

  insertToInput: (item: NewsItem) => {
    window.api.invoke('news:insert-to-input', {
      title: item.title,
      summary: item.summary,
      newsId: item.id,
      sourceId: item.sourceId
    })
  }
}))
