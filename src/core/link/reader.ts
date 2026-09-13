/**
 * 貼網址 → 角色讀內文（公開網頁版，2026-09-13）。
 *
 * 流程：偵測訊息裡的網址 → 抓 HTML → 抽正文 → 太長就丟輔助模型濃縮 →
 * 組成 `[Link]` 注入 system context。桌面與手機獨立版共用這一份
 * （CLAUDE.md：業務邏輯寫在 `core/`，兩邊只做薄轉呼叫）。
 *
 * ## 三條刻意的設計
 *
 * 1. **只在訊息真的有網址時才動作**。不像對話新聞搜尋要先花一次輔助模型
 *    判斷「這句是不是在問時事」——貼網址本身就是最明確的意圖，
 *    所以一般聊天完全不會有額外成本。
 * 2. **讀不到的連結也要進 prompt**。少了這句，模型會照著網址裡的關鍵字
 *    掰出一篇它沒看過的文章，而且講得很像真的。
 * 3. **不做登入牆**。抓取從主行程／原生層發出，那裡沒有使用者瀏覽器的
 *    cookie，也拿不到（Chrome 在 Windows 上還有 App-Bound Encryption）。
 *    社群連結因此一律讀不到，這是範圍，不是 bug。
 */
import { applyUtilitySettings, chatWithLLM, type LLMDeps } from '../llm'
import type { AppSettings } from '../types'
import { extractArticleText, extractHtmlTitle, fetchHtmlDoc } from '../util/htmlFetch'
import { extractLinkUrls, isJsRenderedHost, isPrivateHost, MAX_LINKS_PER_MESSAGE } from './detect'
import { parseYouTubeVideoId, readYouTubeVideo } from './youtube'
import { normalizeLinkReaderSettings, type LinkContextResult, type LinkFetchOutcome, type LinkFetchStatus } from './types'

const FETCH_TIMEOUT_MS = 8000
const SUMMARY_TIMEOUT_MS = 12000

/** 抽出的正文短於此（去空白後）視為沒抓到 */
const MIN_ARTICLE_LEN = 80
/** 正文不超過這個長度就直接進 prompt，不花輔助模型 */
const DIRECT_MAX_LEN = 1500
/** 單一連結進 prompt 的硬性上限 */
const PROMPT_HARD_MAX = 1500
/** 丟給輔助模型的正文上限（比照 news enrich） */
const SUMMARY_INPUT_MAX = 12000

const SUMMARY_INSTRUCTIONS =
  'You summarize a web page for a role-play chat bot\'s background knowledge.\n' +
  'Rules:\n' +
  '- Write ONLY facts that appear in the page text below. Do not comment, speculate, or add outside knowledge.\n' +
  '- Traditional Chinese (Taiwan).\n' +
  '- Keep concrete details the user is likely to ask about: names, numbers, dates, conclusions.\n' +
  '- If the page is clearly not an article (navigation, error page, cookie notice), write「這頁沒有實際內容」.\n' +
  '- Output 3–6 short sentences of plain text only (about 150–350 characters). No title, no bullet list, no markdown.'

/** log：抓網頁整條管線在手機上只看得到 logcat，斷點有四個，要分得出來 */
function diag(step: string, detail: Record<string, unknown> = {}): void {
  const parts = Object.entries(detail).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
  console.info(`[link-diag] ${step}${parts.length ? ' ' + parts.join(' ') : ''}`)
}

function compactLength(text: string): number {
  return text.replace(/\s+/g, '').length
}

function clip(text: string, max = PROMPT_HARD_MAX): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`
}

/**
 * 登入牆／付費牆判定。
 *
 * 只在「正文短到不像文章」時才問這個問題——正常文章頁面的頁尾常常也有
 * 「登入」「訂閱電子報」，先看長度再看關鍵字才不會整批誤判。
 */
const LOGIN_WALL_MARKERS = /(請先登入|請登入|登入後|需要登入|會員專屬|訂閱後即可|付費訂閱|sign in to|log ?in to continue|subscribe to (read|continue)|create an account|paywall)/i

function classifyThinPage(html: string, title: string): LinkFetchStatus {
  const head = `${title}\n${html.slice(0, 6000)}`
  return LOGIN_WALL_MARKERS.test(head) ? 'login-required' : 'empty'
}

/** 把 `fetchHtmlDoc` 拋的錯翻成使用者看得懂的狀態 */
function classifyFetchError(message: string): LinkFetchStatus {
  if (/HTTP (401|403|429|451)\b/.test(message)) return 'blocked'
  if (/non-html content-type/.test(message)) return 'unsupported-type'
  return 'fetch-failed'
}

async function summarizeWithUtility(
  deps: LLMDeps,
  title: string,
  pageText: string,
  settings: AppSettings
): Promise<string | null> {
  const utilitySettings = applyUtilitySettings(settings)
  const userContent = `Title: ${title}\n\nPage text:\n${pageText.slice(0, SUMMARY_INPUT_MAX)}`

  const work = chatWithLLM({
    settings: utilitySettings,
    character: {
      id: '__link-reader__',
      name: 'link-reader',
      personality: SUMMARY_INSTRUCTIONS,
      emotions: {}
    },
    messages: [{ id: '__lr', role: 'user', content: userContent, timestamp: Date.now() }],
    persona: null,
    world: null,
    desktopCharacterNames: [],
    isReminder: true,
    minimal: true
  }, deps)

  // 計時器記得清掉：race 先跑完之後留著的 12 秒 timer 會一直吊著事件迴圈
  // （手機上表現為「回完話之後 App 還有東西在跑」，測試裡則是整包跑不完）。
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timed = await Promise.race([
      work,
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), SUMMARY_TIMEOUT_MS) })
    ])
    const out = timed?.content?.trim()
    return out ? clip(out) : null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 讀單一連結。任何失敗都回傳帶 status 的 outcome，不拋。 */
export async function readOneLink(
  deps: LLMDeps,
  url: string,
  settings: AppSettings
): Promise<LinkFetchOutcome> {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return { url, title: '', status: 'fetch-failed', usedUtility: false }
  }

  if (isPrivateHost(host)) return { url, title: '', status: 'private-host', usedUtility: false }

  /*
   * YouTube 影片先攔下來：它在 `JS_RENDERED_HOSTS` 裡（整頁內容確實抓不到），
   * 但**標題與說明欄是靜態 meta**，拿得到而且常常有用。字幕為什麼不行見
   * `youtube.ts` 檔頭與 `docs/link-reader-plan.md` §9。
   * 非影片的 YouTube 網址（頻道頁、播放清單）`parseYouTubeVideoId` 回 null，
   * 照樣落到下面的 js-rendered。
   */
  if (parseYouTubeVideoId(url)) {
    diag('youtube', { url: url.slice(0, 60) })
    return readYouTubeVideo(deps, url)
  }

  if (isJsRenderedHost(host)) return { url, title: '', status: 'js-rendered', usedUtility: false }

  let html: string
  const t0 = Date.now()
  try {
    html = await fetchHtmlDoc(deps.http, url, FETCH_TIMEOUT_MS)
    diag('fetch-ok', { host, ms: Date.now() - t0, len: html.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const status = classifyFetchError(msg)
    diag('fetch-fail', { host, ms: Date.now() - t0, status, err: msg })
    return { url, title: '', status, usedUtility: false }
  }

  const title = extractHtmlTitle(html)
  const article = extractArticleText(html)
  const len = compactLength(article)
  diag('extracted', { host, chars: len, title: title.slice(0, 40) })

  if (len < MIN_ARTICLE_LEN) {
    return { url, title, status: classifyThinPage(html, title), usedUtility: false }
  }

  if (article.length <= DIRECT_MAX_LEN) {
    return { url, title, status: 'ok', text: clip(article), usedUtility: false }
  }

  // 輔助模型失敗／逾時／拋錯都不能讓整條路斷掉——正文已經抓到了，
  // 截斷原文照樣比什麼都沒有好。
  try {
    const summary = await summarizeWithUtility(deps, title || url, article, settings)
    if (summary) return { url, title, status: 'ok', text: summary, usedUtility: true }
    diag('summary-empty-fallback-clip', { host })
  } catch (e) {
    diag('summary-threw-fallback-clip', { host, err: e instanceof Error ? e.message : String(e) })
  }
  return { url, title, status: 'ok', text: clip(article), usedUtility: false }
}

const STATUS_REASON: Record<Exclude<LinkFetchStatus, 'ok'>, string> = {
  'js-rendered': '這是社群／影音網站，內容要登入或由瀏覽器動態產生，抓不到文字',
  'private-host': '這是內網或本機位址，不會去讀',
  'login-required': '這頁需要登入或訂閱才看得到',
  blocked: '對方網站擋住了自動抓取',
  'unsupported-type': '這個連結不是網頁（可能是 PDF 或檔案）',
  'fetch-failed': '連不上或讀取失敗',
  empty: '抓到頁面了，但抽不出實際內文'
}

/** 組 `[Link]` 注入字串。全部連結都失敗時仍要回傳——明講讀不到也是重要資訊。 */
export function buildLinkInjection(outcomes: LinkFetchOutcome[]): string | null {
  if (outcomes.length === 0) return null
  const lines: string[] = [
    '[Link] 使用者這則訊息裡貼了連結，以下是實際抓到的內容。' +
    '只能根據這裡的文字回應；標示「讀不到」的連結請直接說你打不開，不要憑網址猜內容。'
  ]
  outcomes.forEach((o, i) => {
    const n = outcomes.length > 1 ? `${i + 1}. ` : ''
    if (o.status === 'ok') {
      lines.push('')
      lines.push(`${n}${o.title || '(無標題)'} — ${o.url}`)
      if (o.sourceKind === 'video-description') {
        // 這句是防止角色裝作看過影片的唯一保險，不要拿掉。
        lines.push('（以下是這支影片的「說明欄」文字，不是影片內容。你沒有看過這支影片，不要談論畫面、對白或劇情細節，也不要假裝看過。）')
      }
      lines.push(o.text ?? '')
    } else {
      lines.push('')
      lines.push(`${n}${o.url} — 讀不到（${STATUS_REASON[o.status]}）`)
    }
  })
  return lines.join('\n')
}

/**
 * 完整流程：偵測網址 → 逐一讀 → 組注入字串。
 * 未啟用或訊息裡沒有網址時回傳 `context: null`，呼叫端不需要額外判斷。
 *
 * @param enabledOverride 情境模組覆蓋的結果（桌面 `isModuleEffectivelyEnabled`）；
 *                        不傳則只看 `settings.linkReader.enabled`。
 */
export async function getLinkContext(
  deps: LLMDeps,
  userMessage: string,
  settings: AppSettings,
  enabledOverride?: boolean
): Promise<LinkContextResult> {
  const enabled = enabledOverride ?? normalizeLinkReaderSettings(settings.linkReader).enabled
  if (!enabled) return { context: null, outcomes: [] }

  const urls = extractLinkUrls(userMessage, MAX_LINKS_PER_MESSAGE)
  if (urls.length === 0) return { context: null, outcomes: [] }

  const outcomes: LinkFetchOutcome[] = []
  for (const url of urls) {
    try {
      outcomes.push(await readOneLink(deps, url, settings))
    } catch (e) {
      // readOneLink 本來就不該拋；真的拋了也不能讓使用者收不到回覆。
      diag('unexpected-throw', { err: e instanceof Error ? e.message : String(e) })
      outcomes.push({ url, title: '', status: 'fetch-failed', usedUtility: false })
    }
  }

  return { context: buildLinkInjection(outcomes), outcomes }
}
