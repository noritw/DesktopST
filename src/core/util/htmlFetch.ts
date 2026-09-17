/**
 * 抓網頁 → 抽正文的共用零件。
 *
 * 原本整組住在 `core/news/enrich.ts`（只給新聞用），2026-09-13 做「貼網址讓角色
 * 讀內文」時搬到這裡：兩邊要的東西一模一樣（同一組瀏覽器 UA、同一套
 * `<article>`／`<main>` 抽取），沒有理由抄第二份——CLAUDE.md 對圖示也是同一條規矩。
 *
 * `news/enrich.ts` 仍 re-export `extractArticleText`，既有 import 不用改。
 *
 * ⚠️ I/O 一律走注入的 `HttpAdapter`，不用全域 `fetch`——手機端要 CapacitorHttp
 * patch 過才繞得過 CORS（CLAUDE.md 硬規則）。
 */
import type { HttpAdapter } from '../adapters/http'

/**
 * 用一般瀏覽器 UA；自訂爬蟲 UA 容易被擋或只拿到中間頁。
 * （這是原本 `enrich.ts` 就在用的那一組，搬過來時逐字保留。）
 */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

/**
 * 社群站專用 UA。
 *
 * ⚠️ **這不是龜毛，是必要條件**（2026-09-18 實測）：Facebook 的貼文頁與
 * `plugins/post.php` 對一般瀏覽器 UA 直接回 **HTTP 400**，Threads 則回一份
 * 完全沒有內容的 SPA 空殼；換成任何「不像瀏覽器」的 UA 才會吐 `og:*` 與嵌入
 * 內容。那些端點本來就是給第三方做連結預覽／嵌入用的，所以**不需要冒充
 * `facebookexternalhit`**——具名的自家 UA 一樣拿得到，實測連 `curl/8.4.0`
 * 都可以。用具名的比較誠實，對方要擋也擋得掉。
 */
export const SOCIAL_BOT_USER_AGENT = 'DesktopSTBot/1.0 (+https://nori.tw/DeST/)'

export const DEFAULT_HTML_FETCH_TIMEOUT_MS = 8000

/**
 * 抓一頁 HTML 回來。
 *
 * ⚠️ **逾時一定要走 `signal`，不要自己 `setTimeout` 了事**：CapacitorHttp 忽略
 * `init.signal`，`mobile/adapters/httpAdapter.ts` 已經用 `Promise.race` 把 signal
 * 翻成 reject，所以只有掛在 signal 上的逾時在手機上才真的有效（CLAUDE.md §5）。
 */
export async function fetchHtmlDoc(
  http: HttpAdapter,
  url: string,
  timeoutMs = DEFAULT_HTML_FETCH_TIMEOUT_MS,
  options: { rangeBytes?: number; userAgent?: string } = {}
): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = {
      'User-Agent': options.userAgent || BROWSER_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
    }
    // 只要開頭那一段就夠時（例如只想讀 <head> 的 og:meta）省流量用。
    // ⚠️ 對方**可以不理** Range 而回整份 200，呼叫端要能接受拿到完整內容。
    if (options.rangeBytes && options.rangeBytes > 0) {
      headers.Range = `bytes=0-${options.rangeBytes - 1}`
    }
    const res = await http.fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers
    })
    // 206 Partial Content 是 Range 成功，不是錯誤。
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`)
    const ctype = (res.headers.get('content-type') || '').toLowerCase()
    if (ctype && !ctype.includes('html') && !ctype.includes('text/plain') && !ctype.includes('xml')) {
      throw new Error(`non-html content-type: ${ctype}`)
    }
    const text = await res.text()
    if (!text.trim()) throw new Error('empty body')
    return text
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 還原 HTML 實體。
 *
 * ⚠️ **數值實體一定要處理**：Facebook／Threads／噗浪把中文與 emoji 整片寫成
 * `&#x4e2d;` 這種形式，只解 `&amp;` 那幾個具名實體的話，抽出來的「正文」會是
 * 一長串 `&#x...;`——看起來有內容、長度檢查也會過，然後原樣送進 prompt。
 * 還原時用 `fromCodePoint` 而非 `fromCharCode`，否則 emoji（>0xFFFF）會壞掉。
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => {
      const n = parseInt(c, 16)
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' '
    })
    .replace(/&#(\d+);/g, (_, c) => {
      const n = Number(c)
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' '
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    // `&amp;` 一定放最後：先解它的話 `&amp;lt;` 會被還原成 `<`
    .replace(/&amp;/g, '&')
}

export function stripTags(html: string): string {
  return decodeHtmlEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** 簡單可讀性抽取：優先 article／main，失敗則整頁純文字 */
export function extractArticleText(html: string): string {
  if (!html || !html.trim()) return ''
  const pick = (re: RegExp): string => {
    const m = html.match(re)
    return m?.[1] ? stripTags(m[1]) : ''
  }
  const fromArticle = pick(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
  if (fromArticle.length >= 80) return fromArticle
  const fromMain = pick(/<main\b[^>]*>([\s\S]*?)<\/main>/i)
  if (fromMain.length >= 80) return fromMain
  const fromEntry = pick(/<(?:div|section)\b[^>]*(?:class|id)=["'][^"']*(?:article-body|post-content|entry-content|story-body)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i)
  if (fromEntry.length >= 80) return fromEntry
  const body = html.replace(/<head[\s\S]*?<\/head>/i, ' ')
  return stripTags(body)
}

/**
 * 取頁面標題：優先 og:title（通常比 `<title>` 乾淨，沒有站名後綴），
 * 退回 `<title>`。兩者都沒有時回空字串，呼叫端自己決定要不要用網址墊。
 */
export function extractHtmlTitle(html: string): string {
  if (!html) return ''
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i)
  if (og?.[1]) return stripTags(og[1]).slice(0, 120)
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (t?.[1]) return stripTags(t[1]).slice(0, 120)
  return ''
}
