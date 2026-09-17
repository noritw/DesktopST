/**
 * 社群貼文連結：噗浪／Facebook／Threads（2026-09-18）。
 *
 * ## 為什麼這些站原本讀不到、現在又讀得到了
 *
 * `detect.ts` 的 `JS_RENDERED_HOSTS` 原本把這三家整個擋掉，理由是「內文由 JS
 * 產生，抓了只會拿到空殼」。那個判斷**在當時是對的**——但只對了一半：
 * 空殼是因為我們送的是**瀏覽器 UA**。這三家都另外準備了一套給第三方做連結
 * 預覽／嵌入用的靜態輸出，只要 UA 不像瀏覽器就會吐出來（見
 * `SOCIAL_BOT_USER_AGENT` 的註解）。所以這裡是「換一個門進去」，
 * 不是破解什麼。
 *
 * ⚠️ 走的都是**免登入、不帶 cookie、與使用者帳號完全無關**的公開端點。
 * 沒有任何一條路會碰到使用者的社群帳號，所以不存在「機器人被 Ban」的問題。
 *
 * ## 四種來源拿得到的東西差很多，不要一視同仁
 *
 * | 來源 | 主文 | 回應串 | 靠什麼 |
 * |---|---|---|---|
 * | 噗浪 | 全文 | **整串** | 頁面本身是 SSR ＋ `/Responses/get` |
 * | FB 粉專／個人公開貼文 | 全文 | ✗ | `plugins/post.php` 官方嵌入 |
 * | FB 社團貼文 | **只有 ~190 字摘要** | ✗ | `og:description`（嵌入明確不支援社團） |
 * | Threads | 全文 | ✗ | `/embed` ＋ `og:description` 後備 |
 *
 * **「只拿到摘要」一定要標記出來**（`sourceKind: 'social-excerpt'`）。FB 給的
 * 預覽摘要結尾是 `...`，原樣丟進 prompt 的話角色會把殘文當全文認真討論，
 * 跟 YouTube 那邊「不要裝作看過影片」是同一類問題。
 *
 * ## 脆弱度分級（改壞時先看這裡）
 *
 * FB／Threads 走的是 Meta **對外公開的**預覽與嵌入端點，相對穩定。
 * 噗浪的 `/Responses/get` 是**它網站自己的 AJAX 端點、不是官方 API**，
 * 沒有相容性承諾，改版壞掉的機率最高——所以它失敗時只是少了回應串，
 * 主文照樣要回得出來，不可以讓整條路斷掉。
 */
import type { HttpAdapter } from '../adapters/http'
import { decodeHtmlEntities, fetchHtmlDoc, SOCIAL_BOT_USER_AGENT, stripTags } from '../util/htmlFetch'
import type { LinkFetchOutcome, LinkFetchStatus } from './types'

const FETCH_TIMEOUT_MS = 8000
/** 噗浪回應是第二趟請求，短一點——拿不到就算了，不能拖累主文 */
const RESPONSES_TIMEOUT_MS = 6000

/** 主文進 prompt 的上限 */
const BODY_MAX = 1500
/** 回應串整段的上限 */
const REPLIES_MAX = 1200
/** 最多帶幾則回應（噗浪熱門噗可以有好幾百則） */
const MAX_REPLIES = 15
/** 單則回應的上限 */
const REPLY_MAX = 200

export type SocialSourceKind = 'plurk' | 'facebook-post' | 'facebook-group' | 'threads'

export interface SocialTarget {
  kind: SocialSourceKind
  /** 正規化後的網址（去掉追蹤參數，FB 的 `__cft__` 那串長尾巴） */
  url: string
  /** 噗浪限定：`/p/<base36>` 解出來的十進位 plurk id */
  plurkId?: string
  /**
   * 這是「複製連結」給的**短網址**，還不是真正的貼文網址。
   *
   * ⚠️ 這條路一定要支援：使用者實際會貼的就是它——在 App 裡點「複製連結」，
   * Threads 給 `threads.com/share/<code>`、FB 給 `facebook.com/share/p/<code>`，
   * **兩家都不是** `/@user/post/<code>` 那種正規形式。只認正規形式的話，
   * 最常見的使用方式剛好全部讀不到（2026-09-18 owner 實測當場中）。
   * 短網址要先跟著 302 解析出正規網址，`/embed` 與 `plugins/post.php`
   * 都**不吃**短網址（前者 404、後者回「貼文已無法取得」）。
   */
  shareLink?: boolean
}

/* ------------------------------------------------------------------ */
/* 網址判定                                                            */
/* ------------------------------------------------------------------ */

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^(www|m|web|mbasic|touch)\./, '')
}

/**
 * 噗浪的 `/p/<code>` 是 base36。
 *
 * ⚠️ 用 `parseInt(code, 36)` 直接算——噗浪的 id 目前是 15 位十進位數
 * （約 3.6e14），還在 `Number.MAX_SAFE_INTEGER`（9e15）底下，所以精度沒問題。
 * 真的哪天超過了，這裡會安靜地算錯，到時候改從頁面的 `data-pid` 讀
 * （`extractPlurkBody` 已經在讀了，只是目前沒拿來當真相）。
 */
export function plurkCodeToId(code: string): string | null {
  if (!/^[0-9a-z]{4,12}$/i.test(code)) return null
  const n = parseInt(code.toLowerCase(), 36)
  if (!Number.isFinite(n) || n <= 0 || !Number.isSafeInteger(n)) return null
  return String(n)
}

/**
 * 認出這是不是我們處理得了的社群貼文網址。
 *
 * 認不出來（社群首頁、個人頁、相簿、影片…）回 `null`，由 `reader.ts` 照原本的
 * `js-rendered` 處理——**不要為了多認幾種而放寬**，猜錯的結果是白抓一趟然後
 * 回一個看不懂的失敗。
 */
export function parseSocialLink(rawUrl: string): SocialTarget | null {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return null
  }
  const host = bareHost(u.hostname)
  const parts = u.pathname.split('/').filter(Boolean)

  // ---- 噗浪：/p/<base36>，手機版是 /m/p/<base36> ----
  if (host === 'plurk.com') {
    const idx = parts[0] === 'm' ? 1 : 0
    if (parts[idx] === 'p' && parts[idx + 1]) {
      const plurkId = plurkCodeToId(parts[idx + 1])
      if (plurkId) {
        return { kind: 'plurk', url: `https://www.plurk.com/p/${parts[idx + 1].toLowerCase()}`, plurkId }
      }
    }
    return null
  }

  // ---- Threads：/@user/post/<code>，以及「複製連結」給的 /share/<code> ----
  if (host === 'threads.com' || host === 'threads.net') {
    if (parts.length >= 3 && parts[0].startsWith('@') && parts[1] === 'post' && parts[2]) {
      return { kind: 'threads', url: `https://www.threads.com/${parts[0]}/post/${parts[2]}` }
    }
    if (parts[0] === 'share' && parts[1]) {
      return { kind: 'threads', url: `https://www.threads.com/share/${parts[1]}/`, shareLink: true }
    }
    return null
  }

  // ---- Facebook ----
  if (host === 'facebook.com' || host === 'fb.com') {
    // 社團貼文：/groups/<slug>/posts/<id> 或 /groups/<slug>/permalink/<id>
    if (parts[0] === 'groups' && parts[1] && (parts[2] === 'posts' || parts[2] === 'permalink') && parts[3]) {
      return {
        kind: 'facebook-group',
        url: `https://www.facebook.com/groups/${parts[1]}/posts/${parts[3]}/`
      }
    }
    // 粉專／個人公開貼文：/<name>/posts/<id>
    if (parts.length >= 3 && parts[1] === 'posts' && parts[2]) {
      return { kind: 'facebook-post', url: `https://www.facebook.com/${parts[0]}/posts/${parts[2]}` }
    }
    // 「複製連結」給的短網址：/share/p/<code>（影片是 /share/v/）
    if (parts[0] === 'share' && (parts[1] === 'p' || parts[1] === 'v') && parts[2]) {
      return {
        kind: 'facebook-post',
        url: `https://www.facebook.com/share/${parts[1]}/${parts[2]}/`,
        shareLink: true
      }
    }
    // story.php 跟 permalink.php 是同一組參數的兩種寫法，直接正規化成後者
    // （`plugins/post.php` 實測只吃 permalink.php 這個形式）
    if (parts[0] === 'story.php' || parts[0] === 'permalink.php') {
      const story = u.searchParams.get('story_fbid')
      const owner = u.searchParams.get('id')
      if (story && owner) {
        return {
          kind: 'facebook-post',
          url: `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(story)}&id=${encodeURIComponent(owner)}`
        }
      }
    }
    return null
  }

  return null
}

/* ------------------------------------------------------------------ */
/* HTML 小工具                                                         */
/* ------------------------------------------------------------------ */

/**
 * 從 `startIdx`（某個 `<div` 的位置）取出**配對到正確結尾**的那一段內部 HTML。
 *
 * 為什麼不用 `<div[^>]*>([\s\S]*?)<\/div>`：社群貼文的正文容器裡面**一定有巢狀
 * div**（FB 是 `text_exposed_root`，噗浪是圖片區塊），非貪婪比對會停在第一個
 * `</div>`，正文被腰斬一半——而且斬得很漂亮，長度檢查照樣會過，
 * 所以是那種「看起來成功了但內容少一截」的安靜錯誤。
 */
export function sliceBalancedDiv(html: string, startIdx: number): string {
  const open = html.indexOf('>', startIdx)
  if (open < 0) return ''
  // 自我閉合的 <div ... /> 不存在於實務，但真遇到就當空的
  if (html[open - 1] === '/') return ''
  let depth = 1
  let i = open + 1
  const tag = /<(\/?)div\b[^>]*>/gi
  tag.lastIndex = i
  let m: RegExpExecArray | null
  while ((m = tag.exec(html)) !== null) {
    depth += m[1] ? -1 : 1
    if (depth === 0) return html.slice(open + 1, m.index)
    i = tag.lastIndex
  }
  return '' // 沒配對到結尾：寧可回空也不要回半截
}

/** 找 `attr="…value…"` 的元素起點（class 可能有很多個值，所以用包含比對） */
export function findElementByAttr(html: string, attr: string, value: string): number {
  const re = new RegExp(`<div\\b[^>]*${attr}=["'][^"']*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"']*["']`, 'i')
  const m = html.match(re)
  return m?.index ?? -1
}

/**
 * 區塊 HTML → 純文字，**保留換行**。
 *
 * 社群貼文的排版全靠 `<br>` 與 `<p>`；沿用 `stripTags()` 會把整篇壓成一行，
 * 條列式的貼文（「1、… 2、…」）會黏成一坨，模型讀起來吃力。
 *
 * ⚠️ 行內標籤要**整個拿掉、不留空白**。`stripTags()` 把每個標籤換成一個空格，
 * 對段落標籤是對的，對行內標籤卻會在句子中間戳出空格：FB 把每個 hashtag
 * 包在自己的 `<span>` 裡，於是「#以色列的模式無疑是最具啟發性的。」會變成
 * 「 #以色列的模式無疑是最具啟發性的 。」——標點跟字分家，讀起來像壞掉的
 * OCR。噗浪的連結 `<a>` 也一樣。
 *
 * 空白壓縮**逐行**做，不要整篇 `\s+ → ' '`，否則剛換好的換行又被吃掉。
 */
export function htmlBlockToText(inner: string): string {
  const withBreaks = inner
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n・')
    .replace(/<\/?(?:a|span|b|i|em|strong|u|mark|small|sub|sup|font)\b[^>]*>/gi, '')
  const plain = decodeHtmlEntities(
    withBreaks
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
  return plain
    .split('\n')
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 砍掉「查看更多」那類展開鈕留下的殘渣。
 *
 * 嵌入頁是把全文放進 DOM、再用 CSS 折起來，所以抽出來的純文字裡會夾著
 * 摺疊點的 `⋯⋯` 和結尾的「查看更多」。這些是 UI 不是內容，留著會讓角色
 * 以為貼文被截斷了——正好跟 `social-excerpt` 的語意相反，更該清掉。
 */
export function stripExpandAffordances(text: string): string {
  return text
    // 連同那一行自己的換行一起吃掉，否則會留下一個空行
    .replace(/(^|\n)[ \t]*(?:⋯⋯|……)[ \t]*\n?/g, '$1')
    .replace(/\s*(?:查看更多|See more|續讀全文)\s*$/i, '')
    .trim()
}

function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`
}

function ogContent(html: string, prop: string): string {
  const re = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i')
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*property=["']${prop}["']`, 'i')
  const m = html.match(re) ?? html.match(alt)
  return m?.[1] ? decodeHtmlEntities(m[1]).trim() : ''
}

function classifyFetchError(message: string): LinkFetchStatus {
  if (/HTTP (401|403|429|451)\b/.test(message)) return 'blocked'
  if (/HTTP 404\b/.test(message)) return 'fetch-failed'
  return 'fetch-failed'
}

function diag(step: string, detail: Record<string, unknown> = {}): void {
  const parts = Object.entries(detail).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
  console.info(`[social-diag] ${step}${parts.length ? ' ' + parts.join(' ') : ''}`)
}

async function fetchSocialDoc(http: HttpAdapter, url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  return fetchHtmlDoc(http, url, timeoutMs, { userAgent: SOCIAL_BOT_USER_AGENT })
}

/* ------------------------------------------------------------------ */
/* 短網址解析                                                          */
/* ------------------------------------------------------------------ */

/**
 * 「複製連結」給的短網址 → 真正的貼文網址。
 *
 * 兩家都是 302 轉到正規網址，但**我們拿不到 `Location`**：`fetchHtmlDoc` 只回
 * 內文字串，而手機那條路（CapacitorHttp）也不見得會把最終網址交出來。
 * 所以改從**跟隨重導後那一頁的 `og:url`** 反推——那一頁本來就要抓
 * （失敗時的摘要後備就靠它），等於沒有多花一趟請求。
 */
export function canonicalFromSharePage(html: string, kind: SocialSourceKind): string | null {
  const ogUrl = ogContent(html, 'og:url')

  if (kind === 'threads') {
    // og:url 已經是 `https://www.threads.com/@user/post/CODE`，去掉查詢字串即可
    const m = ogUrl.match(/threads\.(?:com|net)\/(@[^/?#]+)\/post\/([A-Za-z0-9_-]+)/)
    return m ? `https://www.threads.com/${m[1]}/post/${m[2]}` : null
  }

  /*
   * FB 要的是 `permalink.php?story_fbid=…&id=…`。
   *
   * ⚠️ **不能直接拿 og:url**（實測 2026-09-18）：它給的是
   * `/<ownerId>/posts/<一長串中文 slug>/<storyId>/`，那個形式丟進
   * `plugins/post.php` 會被回「貼文已無法取得」，只有 permalink.php 吃。
   * 所以從 og:url 把兩個數字 id 挖出來自己組。
   */
  const fromOg = ogUrl.match(/facebook\.com\/(\d+)\/posts\/(?:[^/]*\/)?(\d+)/)
  if (fromOg) return facebookPermalink(fromOg[2], fromOg[1])

  // 後備：頁面裡的 story.php 參數（og:url 缺席或格式又變了時）
  const fromParams = html.match(/story_fbid=(\d+)[^"']*?[&;](?:amp;)?id=(\d+)/)
  if (fromParams) return facebookPermalink(fromParams[1], fromParams[2])

  return null
}

function facebookPermalink(storyId: string, ownerId: string): string {
  return `https://www.facebook.com/permalink.php?story_fbid=${storyId}&id=${ownerId}`
}

/**
 * 抓短網址那一頁，順便解析出正規網址。
 *
 * 回傳的 `html` 一定要留著：解析失敗時就拿它的 `og:description` 當摘要，
 * 不要再抓一次。
 */
async function resolveShareLink(
  http: HttpAdapter,
  target: SocialTarget
): Promise<{ canonical: string | null; html: string } | null> {
  try {
    const html = await fetchSocialDoc(http, target.url)
    const canonical = canonicalFromSharePage(html, target.kind)
    diag('share-resolved', { kind: target.kind, ok: canonical !== null })
    return { canonical, html }
  } catch (e) {
    diag('share-resolve-failed', { err: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/* ------------------------------------------------------------------ */
/* 噗浪                                                                */
/* ------------------------------------------------------------------ */

/**
 * 噗浪的「限定詞」（說／覺得／偷偷說…）是語意的一部分，不是裝飾。
 * 同一句話掛 `想要` 跟掛 `討厭` 意思差很多，所以要一起帶進 prompt。
 */
export function extractPlurkBody(html: string): { author: string; qualifier: string; text: string } {
  const article = html.slice(html.indexOf('<article id="permanent-plurk"'))
  const scope = article || html
  const author = stripTags(scope.match(/<a[^>]+class=["'][^"']*\bname\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '')
  const qualifier = stripTags(scope.match(/<span[^>]+class=["'][^"']*\bqualifier\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '')
  const holderIdx = findElementByAttr(scope, 'class', 'text_holder')
  const text = holderIdx >= 0
    ? stripExpandAffordances(htmlBlockToText(sliceBalancedDiv(scope, holderIdx)))
    : ''
  return { author, qualifier, text }
}

interface PlurkResponse { author: string; qualifier: string; text: string }

/**
 * 拉回應串。
 *
 * ⚠️ 這是噗浪網站自己的 AJAX 端點，**不是官方 API**，沒有相容性承諾。
 * 所以任何失敗都只是回空陣列——主文已經拿到了，少了回應串仍然有用。
 *
 * 逾時一樣掛在 `signal` 上：CapacitorHttp 忽略 `init.signal`，但手機端的
 * `httpAdapter` 用 `Promise.race` 把它翻成 reject，所以只有這種寫法在手機上
 * 才真的會逾時（CLAUDE.md §5）。
 */
export async function fetchPlurkResponses(http: HttpAdapter, plurkId: string): Promise<PlurkResponse[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), RESPONSES_TIMEOUT_MS)
  try {
    const res = await http.fetch('https://www.plurk.com/Responses/get', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': SOCIAL_BOT_USER_AGENT
      },
      body: `plurk_id=${encodeURIComponent(plurkId)}&from_response_id=0`
    })
    if (!res.ok) return []
    const raw = await res.text()
    return parsePlurkResponses(raw)
  } catch (e) {
    diag('plurk-responses-failed', { err: e instanceof Error ? e.message : String(e) })
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 解析回應 JSON。
 *
 * 用 `res.text()` ＋ 自己 parse 而不是 `res.json()`：手機端的 CapacitorHttp
 * 對「宣稱 JSON 但內容不合法」的回應會多編碼一次（CLAUDE.md §5），
 * 自己 parse 至少能在壞掉時安靜回空陣列，而不是拋出一個看不懂的錯。
 */
export function parsePlurkResponses(raw: string): PlurkResponse[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const obj = data as { responses?: unknown[]; users?: Record<string, { display_name?: string; nick_name?: string }> }
  if (!Array.isArray(obj?.responses)) return []
  const users = obj.users ?? {}
  return obj.responses
    .map(r => {
      const item = r as { user_id?: number | string; content_raw?: string; qualifier?: string }
      const text = typeof item?.content_raw === 'string' ? item.content_raw.trim() : ''
      if (!text) return null
      const u = users[String(item.user_id)] ?? {}
      return {
        author: (u.display_name || u.nick_name || '').trim(),
        // 噗浪用 `:` 表示「沒有限定詞」，那是內部值不是給人看的
        qualifier: item.qualifier && item.qualifier !== ':' ? item.qualifier : '',
        text
      }
    })
    .filter((r): r is PlurkResponse => r !== null)
}

function formatReplies(replies: PlurkResponse[]): string {
  if (replies.length === 0) return ''
  const shown = replies.slice(0, MAX_REPLIES)
  const lines = shown.map(r => {
    const who = r.author || '匿名'
    const q = r.qualifier ? ` ${r.qualifier}` : ''
    return `- ${who}${q}：${clip(r.text.replace(/\s+/g, ' '), REPLY_MAX)}`
  })
  const omitted = replies.length - shown.length
  if (omitted > 0) lines.push(`（另外還有 ${omitted} 則回應沒有帶進來）`)
  return clip(lines.join('\n'), REPLIES_MAX)
}

async function readPlurk(http: HttpAdapter, target: SocialTarget): Promise<LinkFetchOutcome> {
  let html: string
  try {
    // 噗浪是 SSR，一般瀏覽器 UA 就給全文，不需要換 UA
    html = await fetchHtmlDoc(http, target.url, FETCH_TIMEOUT_MS)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    diag('plurk-fetch-failed', { err: msg })
    return { url: target.url, title: '', status: classifyFetchError(msg), usedUtility: false }
  }

  const { author, qualifier, text } = extractPlurkBody(html)
  if (!text) return { url: target.url, title: '', status: 'empty', usedUtility: false }

  const replies = target.plurkId ? await fetchPlurkResponses(http, target.plurkId) : []
  diag('plurk-ok', { chars: text.length, replies: replies.length })

  const head = `${author || '某位使用者'}${qualifier ? ` ${qualifier}` : ''}：`
  const body = [`${head}\n${clip(text, BODY_MAX)}`]
  const repliesBlock = formatReplies(replies)
  if (repliesBlock) body.push(`\n回應（共 ${replies.length} 則）：\n${repliesBlock}`)

  return {
    url: target.url,
    title: clip(`${author || '噗浪'}的噗`, 120),
    status: 'ok',
    text: body.join('\n'),
    usedUtility: false,
    sourceKind: 'social-post'
  }
}

/* ------------------------------------------------------------------ */
/* Facebook                                                            */
/* ------------------------------------------------------------------ */

function embedUrl(postUrl: string): string {
  return `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(postUrl)}&show_text=true&width=500`
}

/**
 * 從官方嵌入頁抽全文。
 *
 * 正文在 `data-testid="post_message"` 容器裡，而且**「查看更多」摺疊起來的部分
 * 也在 DOM 裡**（只是用 CSS 藏著），所以這條路拿到的是真的全文，
 * 不是 og:description 那個 ~190 字的預覽摘要。
 */
export function extractFacebookEmbedText(html: string): string {
  const idx = findElementByAttr(html, 'data-testid', 'post_message')
  if (idx < 0) return ''
  return stripExpandAffordances(htmlBlockToText(sliceBalancedDiv(html, idx)))
}

/** 嵌入頁在貼文不可嵌入時會回一段說明文字，而不是 HTTP 錯誤 */
function embedRefused(html: string): boolean {
  return /貼文已無法取得|This post is no longer available|isn't available|無法顯示這則貼文/i.test(html)
}

/**
 * FB 粉專／個人公開貼文：先試官方嵌入拿全文，不行才退回 og 摘要。
 */
async function readFacebookPost(http: HttpAdapter, target: SocialTarget): Promise<LinkFetchOutcome> {
  // 短網址要先換成 permalink.php 形式，`plugins/post.php` 不吃 /share/p/
  let postUrl = target.url
  let sharePage: string | undefined
  if (target.shareLink) {
    const resolved = await resolveShareLink(http, target)
    if (!resolved) return { url: target.url, title: '', status: 'fetch-failed', usedUtility: false }
    sharePage = resolved.html
    if (resolved.canonical) postUrl = resolved.canonical
    else return readOgExcerpt(http, target, 'Facebook 貼文', sharePage)
  }

  let embedHtml = ''
  try {
    embedHtml = await fetchSocialDoc(http, embedUrl(postUrl))
  } catch (e) {
    diag('fb-embed-failed', { err: e instanceof Error ? e.message : String(e) })
  }

  if (embedHtml && !embedRefused(embedHtml)) {
    const text = extractFacebookEmbedText(embedHtml)
    if (text.length >= 40) {
      diag('fb-embed-ok', { chars: text.length })
      return {
        url: target.url,
        title: clip(text.split('\n')[0] || 'Facebook 貼文', 120),
        status: 'ok',
        text: clip(text, BODY_MAX),
        usedUtility: false,
        sourceKind: 'social-post'
      }
    }
  }
  diag('fb-embed-fallback-og')
  return readOgExcerpt(http, target, 'Facebook 貼文', sharePage)
}

/**
 * 只拿得到 og 預覽摘要的情況（FB 社團，以及嵌入失敗的貼文）。
 *
 * ⚠️ 回傳的 `sourceKind` 一定是 `social-excerpt`——摘要結尾是 `...`，
 * 不標記的話角色會把殘文當全文討論。
 */
async function readOgExcerpt(
  http: HttpAdapter,
  target: SocialTarget,
  fallbackTitle: string,
  /** 短網址那一趟已經抓過的頁面；有的話就不要再抓一次 */
  preFetched?: string
): Promise<LinkFetchOutcome> {
  let html: string
  if (preFetched) {
    html = preFetched
  } else {
    try {
      html = await fetchSocialDoc(http, target.url)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      diag('og-fetch-failed', { err: msg })
      return { url: target.url, title: '', status: classifyFetchError(msg), usedUtility: false }
    }
  }

  // FB 的貼文頁把內文放 og:title、og:description 只寫「Plurk by …」那類元資訊；
  // Threads 剛好相反。兩個都看，取比較長的那個當正文。
  const ogTitle = ogContent(html, 'og:title')
  const ogDesc = ogContent(html, 'og:description')
  const text = (ogDesc.length >= ogTitle.length ? ogDesc : ogTitle).trim()
  if (text.length < 20) return { url: target.url, title: '', status: 'empty', usedUtility: false }

  return {
    url: target.url,
    title: clip(fallbackTitle, 120),
    status: 'ok',
    text: clip(text, BODY_MAX),
    usedUtility: false,
    sourceKind: 'social-excerpt'
  }
}

/* ------------------------------------------------------------------ */
/* Threads                                                             */
/* ------------------------------------------------------------------ */

/**
 * 從 Threads 的嵌入頁抽正文。
 *
 * ⚠️ **不可以直接拿第一個 `TextContentContainer`**（2026-09-18 實測踩到）。
 *
 * 貼文是回覆時，嵌入頁會**先畫被回覆的母貼文**再畫目標貼文，兩個的 class 都
 * 含 `TextContentContainer`。拿第一個的結果是「讀一則貼文卻拿回另一個人的
 * 貼文」——`status` 是 ok、長度也正常、看起來完全成功，只是內容整個不對，
 * 是這次實作裡最難發現的一個 bug。目標貼文的 class 多一個 `Full`
 * （`TextContentContainerFull`），用它認。
 *
 * 母貼文照樣抽出來回傳：回覆脫離上文常常等於沒有資訊
 * （「Are we really doing this again?」單獨看什麼都不是），呼叫端會標清楚
 * 哪一則才是使用者貼的那個。
 */
export function extractThreadsEmbedText(html: string): { text: string; parent: string } {
  const all = [...html.matchAll(
    /<span[^>]+class=["']([^"']*TextContentContainer[^"']*)["'][^>]*>([\s\S]*?)<\/span>\s*<\/span>/gi
  )]
  if (all.length === 0) return { text: '', parent: '' }
  const targetIdx = all.findIndex(m => /TextContentContainerFull/i.test(m[1]))
  const idx = targetIdx >= 0 ? targetIdx : all.length - 1
  const parent = idx > 0 ? stripExpandAffordances(htmlBlockToText(all[idx - 1][2])) : ''
  return { text: stripExpandAffordances(htmlBlockToText(all[idx][2])), parent }
}

async function readThreads(http: HttpAdapter, target: SocialTarget): Promise<LinkFetchOutcome> {
  // `/share/<code>/embed` 實測是 404，短網址一定要先換成 /@user/post/<code>
  let postUrl = target.url
  let sharePage: string | undefined
  if (target.shareLink) {
    const resolved = await resolveShareLink(http, target)
    if (!resolved) return { url: target.url, title: '', status: 'fetch-failed', usedUtility: false }
    sharePage = resolved.html
    if (resolved.canonical) postUrl = resolved.canonical
    else return readOgExcerpt(http, target, 'Threads 貼文', sharePage)
  }

  let embedHtml = ''
  try {
    embedHtml = await fetchSocialDoc(http, `${postUrl}/embed`)
  } catch (e) {
    diag('threads-embed-failed', { err: e instanceof Error ? e.message : String(e) })
  }

  const author = postUrl.match(/\/(@[^/]+)\//)?.[1] ?? ''
  if (embedHtml) {
    const { text, parent } = extractThreadsEmbedText(embedHtml)
    if (text.length >= 20) {
      diag('threads-embed-ok', { chars: text.length, parent: parent.length })
      const body = parent
        ? `（這則是回覆。被回覆的原貼文寫著：${clip(parent, 300)}）

${clip(text, BODY_MAX)}`
        : clip(text, BODY_MAX)
      return {
        url: target.url,
        title: clip(author ? `${author} 的 Threads 貼文` : 'Threads 貼文', 120),
        status: 'ok',
        text: body,
        usedUtility: false,
        sourceKind: 'social-post'
      }
    }
  }
  diag('threads-embed-fallback-og')
  return readOgExcerpt(http, target, author ? `${author} 的 Threads 貼文` : 'Threads 貼文', sharePage)
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

/**
 * 讀一則社群貼文。任何失敗都回傳帶 `status` 的 outcome，不拋
 * ——`reader.ts` 的其他路徑也是這個約定。
 */
export async function readSocialPost(http: HttpAdapter, target: SocialTarget): Promise<LinkFetchOutcome> {
  switch (target.kind) {
    case 'plurk':
      return readPlurk(http, target)
    case 'facebook-post':
      return readFacebookPost(http, target)
    case 'facebook-group':
      // 社團貼文**沒有**嵌入可用（`plugins/post.php` 會明講「貼文已無法取得」），
      // 所以連試都不試，直接拿 og 摘要，省一趟必定失敗的請求。
      return readOgExcerpt(http, target, 'Facebook 社團貼文')
    case 'threads':
      return readThreads(http, target)
  }
}
