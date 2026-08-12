/**
 * RSS／Atom 解析 adapter（B1 抽 core，news-standalone-kickoff §3.1）。
 *
 * `rss-parser` 底層是 `xml2js`，直接 `require('events')`／`require('timers')`，
 * 在瀏覽器（Capacitor WebView）build 下這兩個模組會被 Vite externalize 成空殼，
 * **build 不會報錯，但一執行就炸**（`sax` 內部真的用得到 `events.EventEmitter`）。
 * 實測見 2026-08 的 scratch build：警告訊息是
 * `Module "events" has been externalized for browser compatibility`。
 *
 * 因此 core 不能直接 import `rss-parser`，改成吃「已解析好的 feed 物件」，
 * 由平台各自注入解析器：桌面繼續用 `rss-parser`，手機用瀏覽器原生 `DOMParser`。
 */

export interface ParsedFeedItem {
  link?: string
  guid?: string
  title?: string
  /** <source> 元素或 dc:creator，media 出處名 */
  creator?: string
  source?: string
  content?: string
  contentSnippet?: string
  isoDate?: string
  pubDate?: string
  categories?: string[]
  /**
   * Google Trends RSS 的 `ht:news_item` 命名空間子元素（只有破圈來源才有）。
   * 對應 `fetchBreakoutItems` 需要的相關新聞清單。
   */
  newsItems?: Array<{ title?: string; url?: string; source?: string }>
}

export interface ParsedFeed {
  title?: string
  items: ParsedFeedItem[]
}

export interface RssParseAdapter {
  /** 解析一般 RSS／Atom feed（新聞來源、關鍵字來源共用）。 */
  parseFeed(xml: string): Promise<ParsedFeed>
  /** 解析 Google Trends RSS（含 `ht:news_item` 相關新聞子元素，破圈專用）。 */
  parseTrendsFeed(xml: string): Promise<ParsedFeed>
}
