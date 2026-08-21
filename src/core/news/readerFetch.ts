/**
 * 個人新聞報的抓取邏輯（批次 / 單欄）（B1 抽 core，
 * news-standalone-kickoff §4 步驟④）。
 *
 * 桌面走 ipc.ts 的 `news:fetch-batch` / `news:fetch-section`，
 * 手機走 `LocalDataSource`（獨立版）或 mobileRoutes.ts 的 `/api/news/reader/*`
 * （遙控版，仍走桌面），三邊都呼叫這裡，避免同一套抓取／篩選規則出現多份實作而走鐘。
 */
import type { StorageAdapter } from '../adapters/storage'
import { loadNewsModuleSettings, saveNewsModuleSettings, readerSelectionContext } from './settings'
import { fetchAllSources, fetchBreakoutItems, fetchSource, type NewsSourceDeps } from './sources'
import { filterForReader } from './filter'
import type { NewsItem, NewsKeywordGroup, NewsSource } from './types'

export interface ReaderFetchDeps extends NewsSourceDeps {
  storage: StorageAdapter
}

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

function snapshot(settings: Awaited<ReturnType<typeof loadNewsModuleSettings>>): ReaderSettingsSnapshot {
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
export async function fetchReaderBatch(deps: ReaderFetchDeps, req?: ReaderBatchRequest): Promise<ReaderFetchResult> {
  const settings = await loadNewsModuleSettings(deps.storage)
  if (!settings.enabled) return { ok: false, error: '新聞模組尚未啟用' }

  try {
    const maxItems =
      typeof req?.maxItems === 'number' && req.maxItems >= 5 && req.maxItems <= 100
        ? Math.floor(req.maxItems)
        : (settings.readerMaxItems ?? 30)
    const excludeIds = normalizeExcludeIds(req?.excludeIds)
    const selectionCtx = readerSelectionContext(settings)
    // 換一批時不吃快取，才抓得到新東西
    const items = await fetchAllSources(deps, settings, { useCache: excludeIds.length === 0 }, selectionCtx)
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
export async function fetchReaderSection(deps: ReaderFetchDeps, req?: ReaderSectionRequest): Promise<ReaderFetchResult> {
  const settings = await loadNewsModuleSettings(deps.storage)
  if (!settings.enabled) return { ok: false, error: '新聞模組尚未啟用' }

  const sectionGroupId = typeof req?.sectionGroupId === 'string' ? req.sectionGroupId : ''
  if (!sectionGroupId) return { ok: false, error: '缺少 sectionGroupId' }

  try {
    const excludeIds = normalizeExcludeIds(req?.excludeIds)
    const selectionCtx = readerSelectionContext(settings)
    let raw: NewsItem[] = []

    if (sectionGroupId === '__breakout__') {
      if (!settings.breakout.enabled) return { ok: false, error: '熱門話題未啟用' }
      raw = await fetchBreakoutItems(deps, settings.breakout.weight, {
        zhOnly: settings.breakout.zhOnly !== false
      })
    } else if (sectionGroupId.startsWith('kw:')) {
      const sourceId = sectionGroupId.slice(3)
      const src = settings.sources.find(s => s.id === sourceId && s.type === 'keyword')
      if (!src || !src.enabled) return { ok: false, error: '找不到此關鍵字來源' }
      raw = await fetchSource(deps, src, { useCache: false })
    } else if (sectionGroupId.startsWith('feed:')) {
      const sourceId = sectionGroupId.slice(5)
      const src = settings.sources.find(s => s.id === sourceId && (s.type === 'rss' || s.type === 'json'))
      if (!src || !src.enabled) return { ok: false, error: '找不到此訂閱來源' }
      raw = await fetchSource(deps, src, { useCache: false })
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

/**
 * 改某一欄的配額（每關鍵字幾則／熱門幾則），存檔後直接回該欄重抓的結果，
 * UI 就地換掉那一欄不必整頁重整。
 *
 * ⚠️ 這裡讀一次設定只是為了算出新值（例如 `nextSources`），**存檔時只送真的改到
 * 的那個欄位**——把整份 settings spread 進 `saveNewsModuleSettings` 等於連同沒改到
 * 的欄位一起送出去，若同時間有別的請求搶先寫入，會用手上這份舊資料把它蓋掉。
 * `saveNewsModuleSettings` 內部本來就會在寫入前重新讀一次現況，只疊上真的傳進去
 * 的欄位即可。
 */
export async function setReaderQuota(deps: ReaderFetchDeps, sectionGroupId: string, quota: number): Promise<ReaderFetchResult> {
  if (!sectionGroupId) return { ok: false, error: 'sectionGroupId required' }
  const n = Math.max(0, Math.min(20, Math.floor(quota)))
  if (!Number.isFinite(n)) return { ok: false, error: 'quota must be a number' }

  const s = await loadNewsModuleSettings(deps.storage)
  if (sectionGroupId === '__breakout__') {
    await saveNewsModuleSettings(deps.storage, { readerBreakoutQuota: n })
  } else if (sectionGroupId.startsWith('kw:')) {
    const sourceId = sectionGroupId.slice(3)
    const perKeyword = s.readerPerKeyword ?? 3
    const nextSources = s.sources.map(src => {
      if (src.id !== sourceId) return src
      // 與全域相同就清掉覆寫，回到「跟隨全域」
      if (n === perKeyword || n < 1) {
        const { readerQuota: _drop, ...rest } = src
        return rest as NewsSource
      }
      return { ...src, readerQuota: Math.max(1, n) }
    })
    await saveNewsModuleSettings(deps.storage, { sources: nextSources })
  } else {
    // 地方／RSS 等沒有單獨配額，改的是全域每關鍵字預設
    await saveNewsModuleSettings(deps.storage, { readerPerKeyword: Math.max(1, n) })
  }
  return fetchReaderSection(deps, { sectionGroupId })
}

/** 欄位排序：傳完整順序，回傳存檔後定案的清單。沒被列到的維持原相對順序接在後面。 */
export async function setReaderSourceOrder(deps: ReaderFetchDeps, orderedSourceIds: string[]): Promise<NewsSource[]> {
  const s = await loadNewsModuleSettings(deps.storage)
  const byId = new Map(s.sources.map(src => [src.id, src]))
  const seen = new Set<string>()
  const reordered: NewsSource[] = []
  for (const id of orderedSourceIds) {
    const src = byId.get(id)
    if (!src || seen.has(id)) continue
    seen.add(id)
    reordered.push(src)
  }
  for (const src of s.sources) {
    if (!seen.has(src.id)) reordered.push(src)
  }
  if (reordered.length !== s.sources.length) throw new Error('source list mismatch')

  const saved = await saveNewsModuleSettings(deps.storage, { sources: reordered })
  return saved.sources
}
