import type { DetectedLang, NewsItem, NewsModuleSettings, NewsSelectionContext } from './types'
import { weightToValue, keywordSourceInGroup, keywordSourceInReaderGroups } from './keywordGroups'

// ---------------------------------------------------------------------------
// 語言偵測（輕量字元判斷，不引入完整語言庫，design §6.4）
// ---------------------------------------------------------------------------

/** 常見「簡體獨有」字，命中即視為簡中（非繁中台灣用語） */
const SIMPLIFIED_MARKERS = '们这国发会东车书长门问时间样话说对开关爱过还样实现样军农产业铁应该没钱龙岁严丽医凤为乐书买卖广'

export function detectLang(text: string): DetectedLang {
  if (!text) return 'other'
  // 日文假名
  if (/[぀-ゟ゠-ヿ]/.test(text)) return 'ja'
  // 韓文諺文
  if (/[가-힣]/.test(text)) return 'ko'
  // CJK 漢字
  const hasHan = /[一-鿿]/.test(text)
  if (hasHan) {
    for (const ch of text) {
      if (SIMPLIFIED_MARKERS.includes(ch)) return 'zh-hans'
    }
    return 'zh-hant'
  }
  return 'other'
}

function isChinese(lang: DetectedLang): boolean {
  return lang === 'zh-hant' || lang === 'zh-hans'
}

// ---------------------------------------------------------------------------
// 黑名單 / 排除 比對
// ---------------------------------------------------------------------------

/** 一則新聞用於比對的全文（title + summary + tags + category + source），小寫 */
function searchableText(item: NewsItem): string {
  return [item.title, item.summary, ...(item.tags ?? []), item.category ?? '', item.source]
    .join(' ')
    .toLowerCase()
}

function matchesAny(haystack: string, needles: string[]): boolean {
  for (const n of needles) {
    const k = n.trim().toLowerCase()
    if (k && haystack.includes(k)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// 興趣正向比對
// ---------------------------------------------------------------------------

/**
 * 收集使用者興趣關鍵字（啟用的 keyword 來源 label）。
 * 依情境組取代式收斂（ctx.sceneGroupId），再疊加當前發話角色的關鍵字（ctx.characterKeywords）。
 */
export function collectInterestTerms(settings: NewsModuleSettings, ctx: NewsSelectionContext = {}): string[] {
  const sceneTerms = settings.sources
    .filter(s => {
      if (!s.enabled || s.type !== 'keyword') return false
      if (ctx.readerKeywordGroupIds && ctx.readerKeywordGroupIds.length > 0) {
        return keywordSourceInReaderGroups(s, ctx.readerKeywordGroupIds)
      }
      if (ctx.allKeywordGroups) return true
      return keywordSourceInGroup(s, ctx.sceneGroupId)
    })
    .map(s => s.label)
  const charTerms = (ctx.characterKeywords ?? []).map(k => k.trim()).filter(Boolean)
  return [...new Set([...sceneTerms, ...charTerms])]
}

/**
 * 是否需要對該則做「興趣正向比對」。
 * - keyword / rss：使用者已針對性訂閱，視為想要，跳過正向過濾。
 * - 地方新聞：縣市本身即查詢條件，跳過。
 * - 破圈：刻意走出同溫層，跳過正向比對（但仍受黑名單）。
 * - json：聚合站含大量分類，須以興趣關鍵字收斂。
 */
function needsPositiveFilter(item: NewsItem): boolean {
  return item.sourceType === 'json' && !item.breakout
}

// ---------------------------------------------------------------------------
// 加權隨機
// ---------------------------------------------------------------------------

/** 「降低顯示來源」的固定倍率：不是封鎖，只是少抽到（design 延伸：一鍵降權） */
const REDUCED_SOURCE_MULTIPLIER = 0.3

function weightedPick(items: NewsItem[], settings: NewsModuleSettings, rng: () => number): NewsItem | null {
  if (items.length === 0) return null
  const reducedSourcesLower = settings.reducedSources.map(s => s.toLowerCase())
  const weights = items.map(item => {
    let w = weightToValue(item.sourceWeight)
    // 學習微調（design §9）：以手設權重為基準微調，夾在合理範圍
    const adj = settings.feedback.adjustments[item.sourceId]
    if (typeof adj === 'number') w = Math.max(0.25, w + adj)
    // 有補充脈絡（摘要 / 相關標題）的較好懂，略為提高被抽中的機率，少抽到孤伶伶只有標題、難以聊清楚的
    if (item.summary && item.summary.trim()) w *= 1.6
    // 使用者手動降低顯示的來源：不過濾掉，只是少抽到
    if (reducedSourcesLower.length > 0 && matchesAny(item.source.toLowerCase(), reducedSourcesLower)) {
      w *= REDUCED_SOURCE_MULTIPLIER
    }
    return w
  })
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return items[Math.floor(rng() * items.length)] ?? null
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r < 0) return items[i]
  }
  return items[items.length - 1]
}

// ---------------------------------------------------------------------------
// 主流程：六層篩選 + 加權隨機抽一則
// ---------------------------------------------------------------------------

export interface FilterResult {
  /** 抽中的一則（沒有候選時為 null） */
  picked: NewsItem | null
  /** 通過全部篩選的候選池大小 */
  candidateCount: number
  /** 各層淘汰統計，方便 log / debug */
  stats: {
    total: number
    afterAge: number
    afterSourceExclude: number
    afterBlacklist: number
    afterCategoryExclude: number
    afterLang: number
    afterPositive: number
    afterSeen: number
  }
}

export interface FilterOptions {
  /** 可注入的亂數產生器（測試用），預設 Math.random */
  rng?: () => number
  /** 情境組 / 角色關鍵字脈絡（決定 json 正向比對用的興趣詞） */
  ctx?: NewsSelectionContext
}

export function filterAndPick(
  items: NewsItem[],
  settings: NewsModuleSettings,
  options: FilterOptions = {}
): FilterResult {
  const rng = options.rng ?? Math.random
  const interestTerms = collectInterestTerms(settings, options.ctx)
  const seen = new Set(settings.seenIds)
  const excludedSourcesLower = settings.excludedSources.map(s => s.toLowerCase())
  const excludedCategoriesLower = settings.excludedCategories.map(s => s.toLowerCase())

  const stats: FilterResult['stats'] = {
    total: items.length,
    afterAge: 0,
    afterSourceExclude: 0,
    afterBlacklist: 0,
    afterCategoryExclude: 0,
    afterLang: 0,
    afterPositive: 0,
    afterSeen: 0
  }

  // 先去重：同 id 只留一則（多來源可能混入同一篇）
  const uniqueById = new Map<string, NewsItem>()
  for (const item of items) {
    if (!uniqueById.has(item.id)) uniqueById.set(item.id, item)
  }
  let pool = [...uniqueById.values()]

  // 0. 日期截止（maxAgeDays > 0 時生效；publishedAt 空字串或解析失敗的放行）
  if (settings.maxAgeDays > 0) {
    const cutoff = Date.now() - settings.maxAgeDays * 24 * 60 * 60 * 1000
    pool = pool.filter(item => {
      if (!item.publishedAt) return true
      const t = new Date(item.publishedAt).getTime()
      return isNaN(t) || t >= cutoff
    })
  }
  stats.afterAge = pool.length

  // 1. 來源排除（source 子字串比對）
  pool = pool.filter(item => !matchesAny(item.source.toLowerCase(), excludedSourcesLower))
  stats.afterSourceExclude = pool.length

  // 2. 黑名單關鍵字（比對 title/summary/tags/category/source，黑名單優先）
  pool = pool.filter(item => !matchesAny(searchableText(item), settings.blacklist))
  stats.afterBlacklist = pool.length

  // 3. 整類排除
  pool = pool.filter(item => {
    if (!item.category) return true
    return !excludedCategoriesLower.includes(item.category.toLowerCase())
  })
  stats.afterCategoryExclude = pool.length

  // 4. 語言處理（三選一），同時把偵測語言寫回 item 供注入階段用
  //    熱門話題另受 breakout.zhOnly（預設開）約束，與全域 translate 可並存
  const breakoutZhOnly = settings.breakout.zhOnly !== false
  pool = pool.filter(item => {
    const lang = detectLang(`${item.title} ${item.summary}`)
    item.lang = lang
    if (item.breakout && breakoutZhOnly) {
      return lang === 'zh-hant' || lang === 'zh-hans'
    }
    if (settings.langMode === 'zh-only') return lang === 'zh-hant'
    return true // translate / raw 都保留
  })
  stats.afterLang = pool.length

  // 5. 興趣正向比對（僅對需要的來源）
  pool = pool.filter(item => {
    if (!needsPositiveFilter(item)) return true
    if (interestTerms.length === 0) return true // 沒設興趣關鍵字時不過濾
    return matchesAny(searchableText(item), interestTerms)
  })
  stats.afterPositive = pool.length

  // 6. seenIds 去重
  pool = pool.filter(item => !seen.has(item.id))
  stats.afterSeen = pool.length

  const picked = weightedPick(pool, settings, rng)
  return { picked, candidateCount: pool.length, stats }
}

/** 工具：把語言判斷暴露給注入階段（translate 模式加註用） */
export function isForeignLanguage(item: NewsItem): boolean {
  const lang = item.lang ?? detectLang(`${item.title} ${item.summary}`)
  return !(lang === 'zh-hant') && (lang === 'ja' || lang === 'ko' || lang === 'zh-hans' || lang === 'other')
}

// ---------------------------------------------------------------------------
// 新聞報專用：六層篩選（略過 seenIds），取前 N 則
// REQ-02, REQ-08
// ---------------------------------------------------------------------------

const READER_BREAKOUT_BUCKET = '__breakout__'
const READER_OTHER_BUCKET = '__other__'

function readerBucketKey(
  item: NewsItem,
  sourceById: Map<string, NewsModuleSettings['sources'][number]>
): string {
  if (item.breakout) return READER_BREAKOUT_BUCKET

  const src = sourceById.get(item.sourceId)
  // 每個關鍵字各自一桶，避免同組內第一個標籤獨佔名額
  if (src?.type === 'keyword') return `kw:${src.id}`
  if (item.sourceType === 'keyword') return `kw:${item.sourceId}`
  if (src) return `feed:${src.id}`
  return READER_OTHER_BUCKET
}

/**
 * 每一欄「配額 vs 實際拿到幾則」的診斷 log（與 `enrich.ts` 的 `[news-diag]` 同一族）。
 * 真機用 `adb logcat -s Capacitor/Console | grep news-diag` 看。
 */
function diagPick(key: string, d: Record<string, unknown>): void {
  const parts = Object.entries(d).map(([k, v]) => `${k}=${String(v)}`)
  console.info(`[news-diag] pick ${key} ${parts.join(' ')}`)
}

/**
 * 依序執行層 0–5 篩選（日期截止、來源排除、黑名單、整類排除、語言、興趣正向比對），
 * **不執行層 6（seenIds）**，不寫 seenIds。
 *
 * 新聞報會依 `readerKeywordGroupIds`（或全部組）抓取；
 * 每關鍵字名額用 `readerQuota`／`readerPerKeyword`，總量受 `maxItems` 限制。
 * `excludeIds`：換一批時排除目前畫面上的 id。
 * `strictExclude`：為 true 時絕不回填已排除的 id（釘選換一批用，寧願少幾則也不重複）。
 */
export function filterForReader(
  items: NewsItem[],
  settings: NewsModuleSettings,
  maxItems: number,
  selectionCtx: NewsSelectionContext = { allKeywordGroups: true },
  excludeIds: ReadonlySet<string> | string[] = [],
  options: {
    strictExclude?: boolean
    /** 只從這些桶取稿（單欄重新整理用，例如 `kw:xxx`） */
    onlyBucketKeys?: string[]
  } = {}
): NewsItem[] {
  const interestTerms = collectInterestTerms(settings, selectionCtx)
  const excludedSourcesLower = settings.excludedSources.map(s => s.toLowerCase())
  const excludedCategoriesLower = settings.excludedCategories.map(s => s.toLowerCase())
  const sourceById = new Map(settings.sources.map(s => [s.id, s]))
  const readerGroupIds = selectionCtx.readerKeywordGroupIds && selectionCtx.readerKeywordGroupIds.length > 0
    ? selectionCtx.readerKeywordGroupIds
    : null
  const exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds)
  const strictExclude = options.strictExclude === true
  const defaultPerKw = typeof settings.readerPerKeyword === 'number'
    && settings.readerPerKeyword >= 1 && settings.readerPerKeyword <= 20
    ? Math.floor(settings.readerPerKeyword)
    : 3
  const breakoutQuota = typeof settings.readerBreakoutQuota === 'number'
    && settings.readerBreakoutQuota >= 0 && settings.readerBreakoutQuota <= 20
    ? Math.floor(settings.readerBreakoutQuota)
    : defaultPerKw

  // 先去重：同 id 只留一則（多來源可能混入同一篇）
  const uniqueById = new Map<string, NewsItem>()
  for (const item of items) {
    if (!uniqueById.has(item.id)) uniqueById.set(item.id, item)
  }
  let pool = [...uniqueById.values()]

  // 0. 日期截止（maxAgeDays > 0 時生效；publishedAt 空字串或解析失敗的放行）
  if (settings.maxAgeDays > 0) {
    const cutoff = Date.now() - settings.maxAgeDays * 24 * 60 * 60 * 1000
    pool = pool.filter(item => {
      if (!item.publishedAt) return true
      const t = new Date(item.publishedAt).getTime()
      return isNaN(t) || t >= cutoff
    })
  }

  // 1. 來源排除（source 子字串比對）
  pool = pool.filter(item => !matchesAny(item.source.toLowerCase(), excludedSourcesLower))

  // 2. 黑名單關鍵字（比對 title/summary/tags/category/source，黑名單優先）
  pool = pool.filter(item => !matchesAny(searchableText(item), settings.blacklist))

  // 3. 整類排除
  pool = pool.filter(item => {
    if (!item.category) return true
    return !excludedCategoriesLower.includes(item.category.toLowerCase())
  })

  // 4. 語言處理，同時把偵測語言寫回 item 供注入階段用
  const breakoutZhOnly = settings.breakout.zhOnly !== false
  pool = pool.filter(item => {
    const lang = detectLang(`${item.title} ${item.summary}`)
    item.lang = lang
    if (item.breakout && breakoutZhOnly) {
      return lang === 'zh-hant' || lang === 'zh-hans'
    }
    if (settings.langMode === 'zh-only') return lang === 'zh-hant'
    return true // translate / raw 都保留
  })

  // 5. 興趣正向比對（僅對需要的來源）
  pool = pool.filter(item => {
    if (!needsPositiveFilter(item)) return true
    if (interestTerms.length === 0) return true
    return matchesAny(searchableText(item), interestTerms)
  })

  // 層 6（seenIds）刻意略過 — 不排除、不寫入（REQ-08）

  const buckets = new Map<string, NewsItem[]>()
  for (const item of pool) {
    const key = readerBucketKey(item, sourceById)
    const list = buckets.get(key)
    if (list) list.push(item)
    else buckets.set(key, [item])
  }

  const keywordKeys = settings.sources
    .filter(s => {
      if (!s.enabled || s.type !== 'keyword') return false
      return keywordSourceInReaderGroups(s, readerGroupIds)
    })
    .map(s => `kw:${s.id}`)
  const extraKeywordKeys = [...buckets.keys()].filter(
    k => k.startsWith('kw:') && !keywordKeys.includes(k)
  )
  const feedKeys = [...buckets.keys()]
    .filter(k => k.startsWith('feed:'))
    .sort()

  const onlyKeys = Array.isArray(options.onlyBucketKeys)
    ? options.onlyBucketKeys.filter((k): k is string => typeof k === 'string' && k.length > 0)
    : []
  const onlySet = onlyKeys.length > 0 ? new Set(onlyKeys) : null

  const orderedKeys = [
    READER_BREAKOUT_BUCKET,
    ...keywordKeys,
    ...extraKeywordKeys,
    ...feedKeys,
    READER_OTHER_BUCKET
  ].filter((k, i, arr) => {
    if (arr.indexOf(k) !== i) return false
    if (onlySet && !onlySet.has(k)) return false
    // 單欄重抓時即使目前池子為空也要保留 key（讓配額邏輯跑完回傳 []）
    if (onlySet) return true
    return (buckets.get(k)?.length ?? 0) > 0
  })

  if (orderedKeys.length === 0) return []

  function quotaForKey(key: string): number {
    if (key === READER_BREAKOUT_BUCKET) return breakoutQuota
    if (key.startsWith('kw:')) {
      const sourceId = key.slice(3)
      const src = sourceById.get(sourceId)
      if (typeof src?.readerQuota === 'number' && src.readerQuota >= 1) {
        return Math.min(20, Math.floor(src.readerQuota))
      }
      return defaultPerKw
    }
    return defaultPerKw
  }

  const result: NewsItem[] = []
  const used = new Set<string>()

  const takeFrom = (key: string, limit: number) => {
    if (limit <= 0) {
      diagPick(key, { limit, pool: buckets.get(key)?.length ?? 0, taken: 0 })
      return
    }
    const list = buckets.get(key) ?? []
    // 換一批：優先還沒出現在畫面上的；strict 時不回填已排除的
    const preferred = list.filter(i => !used.has(i.id) && !exclude.has(i.id))
    const fallback = strictExclude
      ? []
      : list.filter(i => !used.has(i.id) && exclude.has(i.id))
    const ordered = [...preferred, ...fallback]
    let taken = 0
    for (const item of ordered) {
      if (result.length >= maxItems || taken >= limit) break
      if (used.has(item.id)) continue
      used.add(item.id)
      result.push(item)
      taken++
    }
    // 「配額設 5 卻只拿到 3」要分得出是**池子本來就只有 3 則**，
    // 還是被 exclude／maxItems 卡住（owner 2026-08-12 回報）。
    diagPick(key, {
      limit,
      pool: list.length,
      excluded: list.length - preferred.length,
      taken,
      hitMaxItems: result.length >= maxItems
    })
  }

  for (const key of orderedKeys) takeFrom(key, quotaForKey(key))

  // 刻意不再用「總上限」去各桶加碼補滿——否則會把「每關鍵字 3 則」灌成几十則。
  // 總上限只當天花板：takeFrom 內已有 result.length >= maxItems 檢查。

  return result
}
