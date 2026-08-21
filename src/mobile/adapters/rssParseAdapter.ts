import type { ParsedFeed, ParsedFeedItem, RssParseAdapter } from '../../core/news/rssAdapter'

/**
 * 手機端的 RSS 解析 adapter：用瀏覽器原生 `DOMParser`，不是 `rss-parser`
 * ——後者的 `xml2js` 直接 `require('events')`／`require('timers')`，
 * 在 WebView 下 build 得過但一執行就炸（見 `core/news/rssAdapter.ts` 檔頭）。
 *
 * 只實作 `core/news/sources.ts` 實際會用到的欄位，不求完整支援所有 RSS/Atom 擴充。
 */

function text(el: Element | null | undefined): string | undefined {
  const t = el?.textContent?.trim()
  return t || undefined
}

/** 同名標籤可能有多個 namespace 變體（RSS 用 `<link>`，Atom 用 `<link href>`）。 */
function firstChild(parent: Element, ...tagNames: string[]): Element | null {
  for (const tag of tagNames) {
    const found = parent.getElementsByTagName(tag)
    if (found.length > 0) return found[0]
  }
  return null
}

function children(parent: Element, ...tagNames: string[]): Element[] {
  const out: Element[] = []
  for (const tag of tagNames) {
    out.push(...Array.from(parent.getElementsByTagName(tag)))
  }
  return out
}

/** Atom `<link>` 是屬性帶 href，不是文字節點；RSS 是純文字。 */
function extractLink(item: Element): string | undefined {
  const rssLink = firstChild(item, 'link')
  if (rssLink) {
    const t = text(rssLink)
    if (t) return t
    const href = rssLink.getAttribute('href')
    if (href) return href
  }
  return undefined
}

function extractIsoDate(pubDate: string | undefined): string | undefined {
  if (!pubDate) return undefined
  const d = new Date(pubDate)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const err = doc.getElementsByTagName('parsererror')[0]
  if (err) throw new Error(`RSS parse failed: ${err.textContent?.slice(0, 200) ?? 'invalid xml'}`)
  return doc
}

function toItem(item: Element): ParsedFeedItem {
  const source = firstChild(item, 'source')
  const categories = children(item, 'category').map(c => text(c)).filter((c): c is string => !!c)
  const content = text(firstChild(item, 'content:encoded', 'content'))
  const description = text(firstChild(item, 'description', 'summary'))
  const pubDate = text(firstChild(item, 'pubDate', 'published', 'updated'))
  return {
    link: extractLink(item),
    guid: text(firstChild(item, 'guid', 'id')),
    title: text(firstChild(item, 'title')),
    creator: text(firstChild(item, 'dc:creator', 'creator', 'author')),
    source: text(source),
    content: content ?? description,
    contentSnippet: description ?? content,
    isoDate: extractIsoDate(pubDate),
    pubDate,
    categories: categories.length > 0 ? categories : undefined
  }
}

/** Google Trends 的 `ht:news_item` 子元素：每個都是獨立小節點，各帶一個欄位。 */
function toTrendsNewsItems(entry: Element): Array<{ title?: string; url?: string; source?: string }> {
  const nodes = children(entry, 'ht:news_item')
  return nodes.map(n => ({
    title: text(firstChild(n, 'ht:news_item_title')),
    url: text(firstChild(n, 'ht:news_item_url')),
    source: text(firstChild(n, 'ht:news_item_source'))
  }))
}

export const domRssParser: RssParseAdapter = {
  async parseFeed(xml: string): Promise<ParsedFeed> {
    const doc = parseXml(xml)
    const channel = doc.getElementsByTagName('channel')[0] ?? doc.getElementsByTagName('feed')[0] ?? doc.documentElement
    const title = text(firstChild(channel, 'title'))
    const items = children(doc.documentElement, 'item', 'entry').map(toItem)
    return { title, items }
  },

  async parseTrendsFeed(xml: string): Promise<ParsedFeed> {
    const doc = parseXml(xml)
    const channel = doc.getElementsByTagName('channel')[0] ?? doc.documentElement
    const title = text(firstChild(channel, 'title'))
    const items = children(doc.documentElement, 'item').map(entry => ({
      title: text(firstChild(entry, 'title')),
      pubDate: text(firstChild(entry, 'pubDate')),
      newsItems: toTrendsNewsItems(entry)
    }))
    return { title, items }
  }
}
