/**
 * YouTube 連結：抓得到的那一部分（2026-09-13）。
 *
 * ## 範圍：只拿「影片說明」，不是影片內容
 *
 * 字幕那條路**已實測不通**——`docs/link-reader-plan.md` §9 有完整的實測結果。
 * 一句話版本：PO Token 是播放器在瀏覽器裡現算的簽章，從外面打 `timedtext`
 * 會拿到 `HTTP 200` 但長度 0。**那不是「沒登入」，帶 cookie 一樣空的**，
 * 所以也不要跑去接 OAuth。
 *
 * 拿得到的是靜態 meta：標題、頻道、影片說明。這些不需要 token、不需要 JS。
 * 很多頻道會把重點寫在說明欄，所以雖然不是內容本身，也比「完全讀不到」有用。
 *
 * ⚠️ **注入時一定要講明這是說明欄不是影片內容**（`reader.ts` 的
 * `buildLinkInjection` 負責），否則角色會照著說明裝作看過影片，
 * 跟「不要憑網址猜內容」是同一類問題。
 *
 * ## 為什麼要 Range
 *
 * YouTube 的 watch 頁是 **1.2 MB 以上**（一般文章頁的十幾倍），而我們要的
 * 東西都在前面。手機用行動網路貼一支影片就吃掉 1.2 MB、送訊息前多等好幾秒。
 * 所以只要開頭 256 KB；YouTube 不理 Range 時會回整份，那就照原樣處理，
 * 不會壞掉。
 */
import type { LLMDeps } from '../llm'
import { extractHtmlTitle, fetchHtmlDoc, stripTags } from '../util/htmlFetch'
import type { LinkFetchOutcome } from './types'

const FETCH_TIMEOUT_MS = 8000

/**
 * 只抓開頭這麼多位元組。
 *
 * 256 KB 是權衡：`og:*` 在 `<head>` 裡（前 10 KB 就有），但完整的
 * `shortDescription` 藏在後面的 `ytInitialPlayerResponse`，太小會只拿到
 * 被截斷的 og:description。
 */
const RANGE_BYTES = 256 * 1024

/** 說明欄進 prompt 的上限（比一般網頁短——說明欄後半通常是連結與 hashtag） */
const DESCRIPTION_MAX = 900

/** 影片 id 一律是 11 碼 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

function isYouTubeHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be'
}

/**
 * 從網址挖影片 id。認得 `watch?v=`／`youtu.be/`／`shorts/`／`live/`／`embed/`。
 * 不是影片網址（頻道頁、播放清單首頁…）回 null，由呼叫端照一般規則處理。
 */
export function parseYouTubeVideoId(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (!isYouTubeHost(u.hostname)) return null

  if (u.hostname.toLowerCase().replace(/^www\./, '') === 'youtu.be') {
    const id = u.pathname.split('/').filter(Boolean)[0] ?? ''
    return VIDEO_ID.test(id) ? id : null
  }

  const v = u.searchParams.get('v')
  if (v && VIDEO_ID.test(v)) return v

  const parts = u.pathname.split('/').filter(Boolean)
  if (parts.length >= 2 && ['shorts', 'live', 'embed', 'v'].includes(parts[0])) {
    return VIDEO_ID.test(parts[1]) ? parts[1] : null
  }
  return null
}

/**
 * 挖 `ytInitialPlayerResponse` 裡的 `videoDetails.shortDescription`（**完整**說明）。
 *
 * ⚠️ 不要整包 `JSON.parse` 那個 player response——它有好幾百 KB，而且 Range
 * 之後多半是被切斷的殘缺 JSON。這裡只從欄位開頭掃到「沒有被跳脫的引號」為止，
 * 再用 `JSON.parse` 還原跳脫字元（`\n`、`\"`、`\uXXXX`）。
 */
export function extractShortDescription(html: string): string {
  const marker = '"shortDescription":"'
  const start = html.indexOf(marker)
  if (start < 0) return ''
  let i = start + marker.length
  let out = ''
  for (; i < html.length; i++) {
    const c = html[i]
    if (c === '\\') {
      out += c + (html[i + 1] ?? '')
      i++
      continue
    }
    if (c === '"') break
    out += c
  }
  if (i >= html.length) return '' // 被 Range 切斷，沒掃到結尾就不要用半截的
  try {
    return JSON.parse(`"${out}"`) as string
  } catch {
    return ''
  }
}

/** og:description（會被 YouTube 截斷到 ~150 字，只在完整說明挖不到時才用） */
export function extractOgDescription(html: string): string {
  const m = html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:description["']/i)
  return m?.[1] ? stripTags(m[1]) : ''
}

/** 頻道名（`og:video:tag` 不可靠，用 `author` 欄位） */
export function extractAuthor(html: string): string {
  const m = html.match(/"author":"((?:[^"\\]|\\.)*)"/)
  if (!m?.[1]) return ''
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    return ''
  }
}

/**
 * 說明欄是不是垃圾（整段都是連結、hashtag、贊助資訊）。
 *
 * 塞這種東西進 prompt 比什麼都不講更糟——角色會冒出「我看到你有 Patreon」
 * 這種完全不相干的話。判斷刻意**寬鬆**：只擋明顯的，寧可放進一段普通的說明，
 * 也不要把有用的內容誤判掉。
 */
export function looksLikeJunkDescription(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return true
  // 去掉網址與 hashtag 之後還剩多少「真的在講話」的字
  const prose = t
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#＃][^\s#＃]+/g, ' ')
    .replace(/\s+/g, '')
  return prose.length < 60
}

/** 說明欄裁切：先砍掉整段的連結列，再截長度 */
export function tidyDescription(text: string): string {
  const lines = text.split('\n')
    // 整行就是一個網址（或「社群：網址」）的列砍掉，那是頻道的固定尾巴
    .filter(l => {
      const s = l.trim()
      if (!s) return false
      if (/^https?:\/\/\S+$/.test(s)) return false
      if (s.length < 40 && /https?:\/\//.test(s)) return false
      return true
    })
  const joined = lines.join('\n').trim()
  return joined.length <= DESCRIPTION_MAX
    ? joined
    : `${joined.slice(0, DESCRIPTION_MAX).trimEnd()}…`
}

/**
 * 讀一支 YouTube 影片的公開資訊。抓不到或內容是垃圾時回 `empty`，
 * 由 `buildLinkInjection` 誠實說讀不到。
 */
export async function readYouTubeVideo(
  deps: LLMDeps,
  url: string
): Promise<LinkFetchOutcome> {
  let html: string
  try {
    html = await fetchHtmlDoc(deps.http, url, FETCH_TIMEOUT_MS, { rangeBytes: RANGE_BYTES })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = /HTTP (401|403|429)\b/.test(msg) ? 'blocked' as const : 'fetch-failed' as const
    return { url, title: '', status, usedUtility: false }
  }

  const title = extractHtmlTitle(html).replace(/\s*-\s*YouTube\s*$/i, '').trim()
  const author = extractAuthor(html)
  const description = extractShortDescription(html) || extractOgDescription(html)

  if (!title && !description) return { url, title: '', status: 'empty', usedUtility: false }
  if (looksLikeJunkDescription(description)) {
    // 標題還是有用（至少知道你貼的是哪一支），但別假裝有內容。
    return title
      ? {
        url,
        title,
        status: 'ok',
        text: author ? `頻道：${author}\n（這支影片沒有可用的說明文字）` : '（這支影片沒有可用的說明文字）',
        usedUtility: false,
        sourceKind: 'video-description'
      }
      : { url, title: '', status: 'empty', usedUtility: false }
  }

  const body = [author ? `頻道：${author}` : '', tidyDescription(description)]
    .filter(Boolean)
    .join('\n')

  return { url, title, status: 'ok', text: body, usedUtility: false, sourceKind: 'video-description' }
}

export { isYouTubeHost }
