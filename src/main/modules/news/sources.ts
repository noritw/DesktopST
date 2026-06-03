import { createHash } from 'crypto'
import Parser from 'rss-parser'
import type { NewsFeedJson, NewsItem, NewsModuleSettings, NewsSource } from './types'

const rssParser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'DesktopST-News/1.0 (+https://nori.tw/DeST)' }
})

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

/** 同一篇 URL / guid 永遠算出同一個 id（news-feed-spec §4 規則） */
function stableId(prefix: string, key: string): string {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 12)
  return `${prefix}-${hash}`
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

/** 從 rss-parser 的 entry 取出來源媒體名（<source> 元素 / creator） */
function extractOutlet(entry: Record<string, unknown>): string {
  const src = entry.source
  if (typeof src === 'string') return stripHtml(src)
  if (src && typeof src === 'object') {
    const o = src as { _?: string; '#'?: string; title?: string }
    return stripHtml(o._ ?? o['#'] ?? o.title ?? '')
  }
  return stripHtml(entry.creator as string | undefined)
}

async function fetchRssItems(url: string, source: NewsSource): Promise<NewsItem[]> {
  const feed = await rssParser.parseURL(url)
  const feedTitle = stripHtml(feed.title) || source.label
  return (feed.items ?? []).map(entry => {
    const link = entry.link ?? entry.guid ?? ''
    let title = stripHtml(entry.title)
    let outlet = extractOutlet(entry as Record<string, unknown>)

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
      const related = extractRelatedHeadlines((entry.content as string) ?? (entry.contentSnippet as string) ?? '')
      const others = related.filter(h => h && h !== title).slice(0, 3)
      if (others.length) summary = others.join('／')
    } else {
      summary = stripHtml(entry.contentSnippet ?? entry.content ?? '')
      if (summary && (summary === title || summary.includes(title) || title.includes(summary))) summary = ''
    }

    const id = stableId(source.type, entry.guid || link || title)
    const categories = Array.isArray(entry.categories)
      ? entry.categories.map(c => stripHtml(typeof c === 'string' ? c : (c as { _?: string })._ ?? '')).filter(Boolean)
      : []
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
  }).filter(item => item.title && item.url)
}

function validateFeedJson(data: unknown): data is NewsFeedJson {
  if (!data || typeof data !== 'object') return false
  const feed = data as Partial<NewsFeedJson>
  return Array.isArray(feed.items)
}

async function fetchJsonItems(url: string, source: NewsSource): Promise<NewsItem[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url, { signal: controller.signal })
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
export async function fetchSource(source: NewsSource, options: { useCache?: boolean } = {}): Promise<NewsItem[]> {
  const useCache = options.useCache !== false
  const url = source.type === 'keyword' ? buildKeywordRssUrl(source.label) : source.url
  if (!url) return []

  if (useCache) {
    const cached = fetchCache.get(url)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.items
  }

  try {
    const items = source.type === 'json'
      ? await fetchJsonItems(url, source)
      : await fetchRssItems(url, source)
    fetchCache.set(url, { items, fetchedAt: Date.now() })
    return items
  } catch (e) {
    console.warn(`[news] fetch failed for ${source.type} "${source.label}":`, (e as Error).message)
    // 抓取失敗時退回舊快取（若有）
    const cached = fetchCache.get(url)
    return cached ? cached.items : []
  }
}

/** 抓取破圈來源（Google Trends 台灣熱搜），標記 breakout。 */
export async function fetchBreakoutItems(weight: NewsSource['weight'], options: { useCache?: boolean } = {}): Promise<NewsItem[]> {
  const pseudoSource: NewsSource = {
    id: '__breakout__',
    type: 'rss',
    label: '熱門話題',
    url: buildTrendsRssUrl(),
    weight,
    enabled: true,
    origin: 'builtin'
  }
  const items = await fetchSource(pseudoSource, options)
  return items.map(item => ({ ...item, breakout: true }))
}

/** 抓取所有啟用來源（含地方新聞、破圈）。並行抓取，個別失敗不影響其他。 */
export async function fetchAllSources(
  settings: NewsModuleSettings,
  options: { useCache?: boolean } = {}
): Promise<NewsItem[]> {
  const tasks: Promise<NewsItem[]>[] = []

  for (const source of settings.sources) {
    if (source.enabled) tasks.push(fetchSource(source, options))
  }

  // 地方新聞：每個縣市組 keyword RSS
  if (settings.localNews.enabled) {
    for (const loc of settings.localNews.locations) {
      const locSource: NewsSource = {
        id: `loc-${loc.name}`,
        type: 'keyword',
        label: loc.name,
        weight: loc.weight,
        enabled: true,
        origin: 'location'
      }
      tasks.push(fetchSource(locSource, options))
    }
  }

  // 破圈
  if (settings.breakout.enabled) {
    tasks.push(fetchBreakoutItems(settings.breakout.weight, options))
  }

  const results = await Promise.all(tasks)
  return results.flat()
}
