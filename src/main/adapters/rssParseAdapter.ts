import Parser from 'rss-parser'
import type { ParsedFeed, RssParseAdapter } from '../../core/news/rssAdapter'

/**
 * 桌面端的 RSS 解析 adapter：包 `rss-parser`，只用 `parseString`
 * （抓 XML 一律走 core 的 `HttpAdapter`，不讓 `rss-parser` 自己用 Node http 發請求
 * ——手機端沒有這個 escape hatch，桌面也不該有兩條路）。
 */

const parser = new Parser()

/** Google Trends RSS 含 ht: 命名空間的相關新聞，需自訂欄位才抓得到 */
const trendsParser = new Parser({
  customFields: { item: [['ht:news_item', 'newsItems', { keepArray: true }]] }
})

/** 從 rss-parser 的 entry 取出來源媒體名（<source> 元素 / creator） */
function extractOutlet(entry: Record<string, unknown>): string | undefined {
  const src = entry.source
  if (typeof src === 'string') return src
  if (src && typeof src === 'object') {
    const o = src as { _?: string; '#'?: string; title?: string }
    return o._ ?? o['#'] ?? o.title ?? undefined
  }
  return entry.creator as string | undefined
}

function toCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(c => (typeof c === 'string' ? c : ((c as { _?: string })._ ?? ''))).filter(Boolean)
}

/** 從 ht:news_item 子元素取欄位（xml2js 給的多半是 [字串] 陣列，也可能是字串/物件） */
function htField(obj: Record<string, unknown> | undefined, key: string): string {
  let v = obj?.[key]
  if (Array.isArray(v)) v = v[0]
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') return (v as { _?: string })._ ?? ''
  return ''
}

export const electronRssParser: RssParseAdapter = {
  async parseFeed(xml: string): Promise<ParsedFeed> {
    const feed = await parser.parseString(xml)
    return {
      title: feed.title,
      items: (feed.items ?? []).map(entry => {
        const e = entry as Record<string, unknown>
        return {
          link: entry.link ?? (entry.guid as string | undefined),
          guid: entry.guid,
          title: entry.title,
          creator: entry.creator,
          source: extractOutlet(e),
          content: entry.content,
          contentSnippet: entry.contentSnippet,
          isoDate: entry.isoDate,
          pubDate: entry.pubDate,
          categories: toCategories(entry.categories)
        }
      })
    }
  },

  async parseTrendsFeed(xml: string): Promise<ParsedFeed> {
    const feed = await trendsParser.parseString(xml)
    return {
      title: feed.title,
      items: (feed.items ?? []).map(entry => {
        const raw = (entry as { newsItems?: unknown }).newsItems
        const newsList = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[]
        return {
          title: entry.title,
          pubDate: entry.pubDate,
          newsItems: newsList.map(n => ({
            title: htField(n, 'ht:news_item_title'),
            url: htField(n, 'ht:news_item_url'),
            source: htField(n, 'ht:news_item_source')
          }))
        }
      })
    }
  }
}
