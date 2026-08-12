import type { HttpAdapter } from '../adapters/http'
import type { NewsFeedJson, NewsItem, NewsModuleSettings, NewsSelectionContext, NewsSource } from './types'
import type { ParsedFeedItem, RssParseAdapter } from './rssAdapter'
import { keywordSourceInGroup, keywordSourceInReaderGroups } from './keywordGroups'
import { detectLang } from './filter'
/** @see stableId —— 純 JS SHA-1，桌面與手機算出同一個 id。 */
import { stableId } from './stableId'

/** 抓 RSS／JSON 來源需要的平台能力。 */
export interface NewsSourceDeps {
  http: HttpAdapter
  rss: RssParseAdapter
}

const FETCH_TIMEOUT_MS = 8000
const USER_AGENT = 'DesktopST-News/1.0 (+https://nori.tw/DeST)'

/** 固定來源快取（design §11：6–24h），key = 抓取 URL */
interface CacheEntry {
  items: NewsItem[]
  fetchedAt: number
}
const fetchCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 小時

export function clearNewsCache(): void {
  fetchCache.clear()
}

/** keyword → Google News RSS（design §4） */
export function buildKeywordRssUrl(keyword: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`
}

/** Google Trends 台灣每日熱搜 RSS（破圈用，design §7） */
export function buildTrendsRssUrl(): string {
  return 'https://trends.google.com/trending/rss?geo=TW'
}

function stripHtml(text: string | undefined): string {
  if (!text) return ''
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function attachSource(item: Omit<NewsItem, 'sourceId' | 'sourceType' | 'sourceWeight'>, source: NewsSource): NewsItem {
  return {
    ...item,
    sourceId: source.id,
    sourceType: source.type,
    sourceWeight: source.weight,
    keyword: source.type === 'keyword' ? source.label : undefined
  }
}

/**
 * Google 新聞 description 是「同一事件、不同媒體的相關標題清單」(<ol><li><a>…</a>)，
 * 抽出這些標題當作補充脈絡（比單一標題更能看懂發生什麼事）。全為真標題、不腦補。
 */
function extractRelatedHeadlines(html: string): string[] {
  if (!html) return []
  const out: string[] = []
  const re = /<a[^>]*>([^]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    // 去掉 Google 標題尾端「| 作者 | 版面」之類雜訊，只留主標
    const text = stripHtml(m[1]).split(/\s*[|｜]\s*/)[0].trim()
    if (text) out.push(text)
  }
  return out
}

async function fetchXml(http: HttpAdapter, url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await http.fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

function fromRssItem(entry: ParsedFeedItem, source: NewsSource, feedTitle: string): NewsItem {
  const link = entry.link ?? entry.guid ?? ''
  let title = stripHtml(entry.title)
  let outlet = stripHtml(entry.source) || stripHtml(entry.creator)

  // Google News（keyword 來源）標題格式為「真正標題 - 媒體」：拆出媒體名、並從標題移除避免重複
  if (source.type === 'keyword') {
    const dashIdx = title.lastIndexOf(' - ')
    if (dashIdx > 0) {
      const tail = title.slice(dashIdx + 3).trim()
      if (tail) {
        if (!outlet) outlet = tail
        title = title.slice(0, dashIdx).trim()
      }
    }
  }

  // 摘要：
  // - keyword（Google 新聞）：description 是相關標題清單，抽幾則當補充脈絡（比單標題好懂）。
  // - 其他 RSS：採用 description，但與標題重複時捨棄。
  let summary = ''
  if (source.type === 'keyword') {
    const related = extractRelatedHeadlines(entry.content ?? entry.contentSnippet ?? '')
    const others = related.filter(h => h && h !== title).slice(0, 3)
    if (others.length) summary = others.join('／')
  } else {
    let descRaw = stripHtml(entry.contentSnippet ?? entry.content ?? '')
    // Yahoo News 等聚合站 description 常以 [媒體名] 開頭標示原始來源；
    // 在去重邏輯清空 summary 前先把媒體名補進 outlet，確保 source 欄位正確
    if (!outlet && descRaw) {
      const m = descRaw.match(/^\[([^\]]{1,30})\]/)
      if (m) {
        outlet = m[1]
        descRaw = descRaw.slice(m[0].length).trim()
      }
    }
    summary = descRaw
    if (summary && (summary === title || summary.includes(title) || title.includes(summary))) summary = ''
  }

  const id = stableId(source.type, entry.guid || link || title)
  const categories = (entry.categories ?? []).map(c => stripHtml(c)).filter(Boolean)
  return attachSource({
    id,
    title,
    summary,
    source: outlet || feedTitle,
    category: categories[0],
    tags: categories,
    url: link,
    publishedAt: entry.isoDate ?? entry.pubDate ?? ''
  }, source)
}

async function fetchRssItems(deps: NewsSourceDeps, url: string, source: NewsSource): Promise<NewsItem[]> {
  const xml = await fetchXml(deps.http, url)
  const feed = await deps.rss.parseFeed(xml)
  const feedTitle = stripHtml(feed.title) || source.label
  return feed.items
    .map(entry => fromRssItem(entry, source, feedTitle))
    .filter(item => item.title && item.url)
}

function validateFeedJson(data: unknown): data is NewsFeedJson {
  if (!data || typeof data !== 'object') return false
  const feed = data as Partial<NewsFeedJson>
  return Array.isArray(feed.items)
}

async function fetchJsonItems(http: HttpAdapter, url: string, source: NewsSource): Promise<NewsItem[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await http.fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as unknown
    if (!validateFeedJson(data)) throw new Error('invalid news.json (missing items[])')
    return data.items
      .filter(raw => raw && typeof raw.id === 'string' && typeof raw.title === 'string' && typeof raw.url === 'string')
      .map(raw => attachSource({
        id: raw.id,
        title: stripHtml(raw.title),
        summary: stripHtml(raw.summary),
        source: stripHtml(raw.source) || source.label,
        category: raw.category ? stripHtml(raw.category) : undefined,
        tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
        url: raw.url,
        publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : '',
        image: typeof raw.image === 'string' && raw.image ? raw.image : undefined
      }, source))
  } finally {
    clearTimeout(timeoutId)
  }
}

/** 抓單一來源（含快取）。失敗回空陣列、不丟例外，避免一個壞來源拖垮全部。 */
export async function fetchSource(
  deps: NewsSourceDeps,
  source: NewsSource,
  options: { useCache?: boolean } = {}
): Promise<NewsItem[]> {
  const useCache = options.useCache !== false
  const url = source.type === 'keyword' ? buildKeywordRssUrl(source.label) : source.url
  if (!url) return []

  if (useCache) {
    const cached = fetchCache.get(url)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.items
  }

  try {
    const items = source.type === 'json'
      ? await fetchJsonItems(deps.http, url, source)
      : await fetchRssItems(deps, url, source)
    fetchCache.set(url, { items, fetchedAt: Date.now() })
    return items
  } catch (e) {
    console.warn(`[news] fetch failed for ${source.type} "${source.label}":`, (e as Error).message)
    // 抓取失敗時退回舊快取（若有）
    const cached = fetchCache.get(url)
    return cached ? cached.items : []
  }
}

/**
 * 抓取破圈來源（Google Trends 台灣熱搜）。
 * 每個熱搜詞用它底下的相關新聞當實際標題/來源（純熱搜詞無法聊），
 * 並用熱搜詞當穩定 id（每次更新同詞 id 一致，供 seenIds 去重）。
 * zhOnly：優先挑中文相關新聞；若該熱搜底下沒有中文標題則整則略過。
 */
export async function fetchBreakoutItems(
  deps: NewsSourceDeps,
  weight: NewsSource['weight'],
  options: { zhOnly?: boolean } = {}
): Promise<NewsItem[]> {
  const zhOnly = options.zhOnly !== false
  try {
    const xml = await fetchXml(deps.http, buildTrendsRssUrl())
    const feed = await deps.rss.parseTrendsFeed(xml)
    const items: NewsItem[] = []
    for (const entry of feed.items) {
      const trend = stripHtml(entry.title)
      if (!trend) continue
      const newsList = entry.newsItems ?? []

      type Related = { headline: string; newsUrl: string; src: string; score: number }
      const related: Related[] = []
      for (const n of newsList) {
        const headline = stripHtml(n.title)
        if (!headline) continue
        const lang = detectLang(headline)
        const score = lang === 'zh-hant' ? 3 : lang === 'zh-hans' ? 2 : 0
        related.push({
          headline,
          newsUrl: n.url ?? '',
          src: stripHtml(n.source),
          score
        })
      }
      related.sort((a, b) => b.score - a.score)

      if (zhOnly) {
        // 只要中文：沒有中文相關新聞就跳過這個熱搜詞
        if (related.length === 0 || related[0].score === 0) continue
      }

      const top = related[0]
      const headline = top?.headline || trend
      const newsUrl = top?.newsUrl || ''
      const src = top?.src || ''
      const others = related
        .slice(1, 4)
        .filter(r => !zhOnly || r.score > 0)
        .map(r => r.headline)
        .filter(Boolean)

      items.push({
        id: stableId('trend', trend),
        title: headline,
        summary: others.join('／'),
        source: src || 'Google 熱搜',
        tags: [trend],
        url: newsUrl || `https://www.google.com/search?q=${encodeURIComponent(trend)}`,
        publishedAt: entry.pubDate ?? '',
        sourceId: '__breakout__',
        sourceType: 'rss',
        sourceWeight: weight,
        breakout: true
      })
    }
    return items
  } catch (e) {
    console.warn('[news] fetch breakout (trends) failed:', (e as Error).message)
    return []
  }
}

/**
 * 抓取所有啟用來源（含地方新聞、破圈）。並行抓取，個別失敗不影響其他。
 * ctx 決定興趣關鍵字的取捨：
 * - keyword 來源依當前情境組取代式收斂（rss/json 維持全域 always-on）。
 * - 當前發話角色的 newsKeywords 以普通權重疊加抓取（去重既有啟用關鍵字）。
 */
export async function fetchAllSources(
  deps: NewsSourceDeps,
  settings: NewsModuleSettings,
  options: { useCache?: boolean } = {},
  ctx: NewsSelectionContext = {}
): Promise<NewsItem[]> {
  const tasks: Promise<NewsItem[]>[] = []
  const activeKeywordLabels = new Set<string>()

  for (const source of settings.sources) {
    if (!source.enabled) continue
    // keyword：情境組取代式；新聞報可用多選組或全部組
    if (source.type === 'keyword') {
      if (ctx.readerKeywordGroupIds && ctx.readerKeywordGroupIds.length > 0) {
        if (!keywordSourceInReaderGroups(source, ctx.readerKeywordGroupIds)) continue
      } else if (ctx.allKeywordGroups) {
        // 全部組
      } else if (!keywordSourceInGroup(source, ctx.sceneGroupId)) {
        continue
      }
      activeKeywordLabels.add(source.label)
    }
    tasks.push(fetchSource(deps, source, options))
  }

  // 角色卡關鍵字（疊加，普通權重）；與現有啟用關鍵字重複者略過避免重抓
  for (const kwRaw of ctx.characterKeywords ?? []) {
    const kw = kwRaw.trim()
    if (!kw || activeKeywordLabels.has(kw)) continue
    activeKeywordLabels.add(kw)
    const charSource: NewsSource = {
      id: `char-${kw}`,
      type: 'keyword',
      label: kw,
      weight: 'normal',
      enabled: true,
      origin: 'character'
    }
    tasks.push(fetchSource(deps, charSource, options))
  }

  // 破圈
  if (settings.breakout.enabled) {
    tasks.push(fetchBreakoutItems(deps, settings.breakout.weight, { zhOnly: settings.breakout.zhOnly !== false }))
  }

  const results = await Promise.all(tasks)
  return results.flat()
}
