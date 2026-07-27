/**
 * readerFetch.ts
 * 個人新聞報的抓取邏輯（批次 / 單欄）。
 *
 * 桌面走 ipc.ts 的 `news:fetch-batch` / `news:fetch-section`，
 * 手機走 mobileRoutes.ts 的 `/api/news/reader/*`，兩邊都呼叫這裡，
 * 避免同一套抓取／篩選規則出現兩份實作而走鐘。
 */

import { loadNewsModuleSettings, readerSelectionContext } from './settings'
import { fetchAllSources, fetchBreakoutItems, fetchSource } from './sources'
import { filterForReader } from './filter'
import type { NewsItem, NewsKeywordGroup, NewsSource } from './types'

export interface ReaderFetchRequest {
  /** 換一批：排除目前畫面上的新聞 id */
  excludeIds?: string[]
  /** true＝絕不回填已排除 id（釘選換一批） */
  strictExclude?: boolean
}

export interface ReaderBatchRequest extends ReaderFetchRequest {
  maxItems?: number
}

export interface ReaderSectionRequest extends ReaderFetchRequest {
  sectionGroupId?: string
}

/** 成功回應共同附帶的設定快照，讓 UI 一次拿齊欄位資訊 */
export interface ReaderSettingsSnapshot {
  sources: NewsSource[]
  keywordGroups: NewsKeywordGroup[]
  readerKeywordGroupIds: string[]
  readerMaxItems: number
  readerPerKeyword: number
  readerBreakoutQuota: number
}

export type ReaderFetchResult =
  | ({ ok: true; items: NewsItem[]; fetchedAt: number; sectionGroupId?: string } & ReaderSettingsSnapshot)
  | { ok: false; error: string }

function snapshot(settings: ReturnType<typeof loadNewsModuleSettings>): ReaderSettingsSnapshot {
  return {
    sources: settings.sources,
    keywordGroups: settings.keywordGroups,
    readerKeywordGroupIds: settings.readerKeywordGroupIds ?? [],
    readerMaxItems: settings.readerMaxItems ?? 30,
    readerPerKeyword: settings.readerPerKeyword ?? 3,
    readerBreakoutQuota: settings.readerBreakoutQuota ?? 3
  }
}

function normalizeExcludeIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
}

/** 新聞報：批次抓取（略過 seenIds，取前 N 則） */
export async function fetchReaderBatch(req?: ReaderBatchRequest): Promise<ReaderFetchResult> {
  const settings = loadNewsModuleSettings()
  if (!settings.enabled) return { ok: false, error: '新聞模組尚未啟用' }

  try {
    const maxItems =
      typeof req?.maxItems === 'number' && req.maxItems >= 5 && req.maxItems <= 100
        ? Math.floor(req.maxItems)
        : (settings.readerMaxItems ?? 30)
    const excludeIds = normalizeExcludeIds(req?.excludeIds)
    const selectionCtx = readerSelectionContext(settings)
    // 換一批時不吃快取，才抓得到新東西
    const items = await fetchAllSources(settings, { useCache: excludeIds.length === 0 }, selectionCtx)
    const filtered = filterForReader(
      items,
      settings,
      maxItems,
      selectionCtx,
      excludeIds,
      { strictExclude: req?.strictExclude === true }
    )
    return { ok: true, items: filtered, fetchedAt: Date.now(), ...snapshot(settings) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 新聞報：只重抓一欄（`kw:` / `feed:` / `__breakout__` / `__local__`） */
export async function fetchReaderSection(req?: ReaderSectionRequest): Promise<ReaderFetchResult> {
  const settings = loadNewsModuleSettings()
  if (!settings.enabled) return { ok: false, error: '新聞模組尚未啟用' }

  const sectionGroupId = typeof req?.sectionGroupId === 'string' ? req.sectionGroupId : ''
  if (!sectionGroupId) return { ok: false, error: '缺少 sectionGroupId' }

  try {
    const excludeIds = normalizeExcludeIds(req?.excludeIds)
    const selectionCtx = readerSelectionContext(settings)
    let raw: NewsItem[] = []

    if (sectionGroupId === '__breakout__') {
      if (!settings.breakout.enabled) return { ok: false, error: '熱門話題未啟用' }
      raw = await fetchBreakoutItems(settings.breakout.weight, {
        zhOnly: settings.breakout.zhOnly !== false
      })
    } else if (sectionGroupId === '__local__') {
      if (!settings.localNews.enabled || settings.localNews.locations.length === 0) {
        return { ok: false, error: '地方新聞未啟用' }
      }
      const parts = await Promise.all(
        settings.localNews.locations.map(loc =>
          fetchSource(
            {
              id: `loc-${loc.name}`,
              type: 'keyword',
              label: loc.name,
              weight: loc.weight,
              enabled: true,
              origin: 'location'
            },
            { useCache: false }
          )
        )
      )
      raw = parts.flat()
    } else if (sectionGroupId.startsWith('kw:')) {
      const sourceId = sectionGroupId.slice(3)
      const src = settings.sources.find(s => s.id === sourceId && s.type === 'keyword')
      if (!src || !src.enabled) return { ok: false, error: '找不到此關鍵字來源' }
      raw = await fetchSource(src, { useCache: false })
    } else if (sectionGroupId.startsWith('feed:')) {
      const sourceId = sectionGroupId.slice(5)
      const src = settings.sources.find(s => s.id === sourceId && (s.type === 'rss' || s.type === 'json'))
      if (!src || !src.enabled) return { ok: false, error: '找不到此訂閱來源' }
      raw = await fetchSource(src, { useCache: false })
    } else {
      return { ok: false, error: '不支援的欄位類型' }
    }

    // 單欄：總上限用較高值，真正限制靠該桶配額
    const filtered = filterForReader(
      raw,
      settings,
      100,
      selectionCtx,
      excludeIds,
      {
        strictExclude: req?.strictExclude !== false,
        onlyBucketKeys: [sectionGroupId]
      }
    )

    return { ok: true, sectionGroupId, items: filtered, fetchedAt: Date.now(), ...snapshot(settings) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
