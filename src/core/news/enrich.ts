/**
 * 新聞進 Prompt 的上下文補強：夠用判定、長度門檻、退回字串（純規則）
 * ＋ 抓原文／輔助模型摘要（B1 抽 core，news-standalone-kickoff §4 步驟⑥）。
 *
 * I/O 一律走注入的 `HttpAdapter`／`LLMDeps`，不用全域 `fetch`
 * ——手機端要 CapacitorHttp patch 過才繞得過 CORS（CLAUDE.md 硬規則）。
 */
import type { HttpAdapter } from '../adapters/http'
import type { StorageAdapter } from '../adapters/storage'
import { chatWithLLM, applyUtilitySettings, type LLMDeps } from '../llm'
import type { AppSettings } from '../types'
import { loadNewsModuleSettings } from './settings'
import type { NewsItem, NewsModuleSettings } from './types'

/** summary 夠用的最低字數（可調） */
export const SUMMARY_ADEQUATE_MIN_LEN = 80

/** 正文短於此字元數（去空白後）可直接當 prompt 上下文 */
export const ARTICLE_DIRECT_MAX_LEN = 1200

/** prompt 上下文硬性上限（短文直塞時也裁切） */
export const PROMPT_CONTEXT_HARD_MAX = 1200

/** 輔助模型摘要目標長度（約） */
export const UTILITY_SUMMARY_TARGET_MIN = 120
export const UTILITY_SUMMARY_TARGET_MAX = 280

export type PromptContextSource =
  | 'rss-adequate'
  | 'rss-fallback'
  | 'article-excerpt'
  | 'utility-summary'
  | 'manual'

/**
 * summary 是否「夠用」可直接當 prompt 上下文。
 * 同時滿足才算夠用（設計稿 §3.2）。
 */
export function isSummaryAdequate(title: string, summary: string): boolean {
  const t = (title ?? '').trim()
  const s = (summary ?? '').trim()
  if (!s) return false
  // 與標題實質相同（Google News 常見：摘要就是標題，或標題包含整段摘要）
  if (s === t || t.includes(s)) return false
  if (s.length < SUMMARY_ADEQUATE_MIN_LEN) return false
  // 像「相關標題串」：／ 分隔的多段短句
  if (looksLikeRelatedHeadlineChain(s)) return false
  return true
}

/** Google 新聞常見：用／串起多則相關標題 */
export function looksLikeRelatedHeadlineChain(summary: string): boolean {
  const s = summary.trim()
  if (!s.includes('／') && !s.includes('/')) return false
  // 以全形／為主；半形 / 若出現多次且各段都偏短也視為標題串
  const parts = s.includes('／')
    ? s.split('／').map(p => p.trim()).filter(Boolean)
    : s.split('/').map(p => p.trim()).filter(Boolean)
  if (parts.length <= 1) return false
  // 多段且多數偏短 → 標題串；若只有兩段且都很長則可能是正常摘要裡的斜線
  const shortCount = parts.filter(p => p.length <= 40).length
  return parts.length >= 2 && shortCount >= Math.ceil(parts.length * 0.6)
}

/** 退回現況：有可用 summary 就用，否則空（組字串時只留標題） */
export function fallbackPromptContext(title: string, summary: string): string {
  const t = (title ?? '').trim()
  const s = (summary ?? '').trim()
  if (!s || s === t || t.includes(s)) return ''
  return s.slice(0, PROMPT_CONTEXT_HARD_MAX)
}

/** 有 promptContext 用之；否則退回 RSS summary（或空） */
export function resolvePromptContext(item: {
  title: string
  summary: string
  promptContext?: string
}): string {
  const pc = item.promptContext?.trim()
  if (pc) return pc.slice(0, PROMPT_CONTEXT_HARD_MAX)
  return fallbackPromptContext(item.title, item.summary)
}

/** 去空白後字元數（長度門檻用） */
export function compactLength(text: string): number {
  return text.replace(/\s+/g, '').length
}

/**
 * 依正文長度決定處理方式（設計稿 §3.4）。
 * - short → 直接節錄（硬性上限）
 * - long → 呼叫輔助模型
 */
export function decideArticleHandling(articleText: string): 'direct' | 'utility' {
  return compactLength(articleText) <= ARTICLE_DIRECT_MAX_LEN ? 'direct' : 'utility'
}

export function clipPromptContext(text: string): string {
  const t = text.trim()
  if (t.length <= PROMPT_CONTEXT_HARD_MAX) return t
  return t.slice(0, PROMPT_CONTEXT_HARD_MAX).trimEnd()
}

// ── I/O：抓原文 → 抽正文 → 短文直塞／長文輔助模型摘要；失敗退回 RSS ──
//
// ⚠️ Google 新聞 RSS 的 link 是 `news.google.com/rss/articles/CBMi…`，
// **不會 HTTP 轉址到原文**（回的是 Google 中間頁）。必須先解碼才抓得到正文。

export interface EnrichDeps extends LLMDeps {
  storage: StorageAdapter
}

const FETCH_TIMEOUT_MS = 8000
const CACHE_TTL_MS = 4 * 60 * 60 * 1000

/**
 * 「聊這個」整段管線的診斷 log。
 *
 * 為什麼要有：抓原文失敗時使用者只看得到「先用 RSS 摘要」一句話，
 * 但斷點可能在四個地方（解跳板／抓正文／抽內文／輔助模型），
 * 光看結果分不出來。真機上 `adb logcat | grep news-diag` 就能定位。
 *
 * 一律走 `console.info`：桌面 DevTools 與 Android WebView 都收得到，
 * 而 Capacitor 會把 WebView 的 console 轉進 logcat。
 */
function diag(step: string, detail: Record<string, unknown> = {}): void {
  const parts = Object.entries(detail).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
  console.info(`[news-diag] ${step}${parts.length ? ' ' + parts.join(' ') : ''}`)
}

/** log 用：只留前 120 字，免得 logcat 被整條網址洗版 */
function brief(s: string | undefined, max = 120): string {
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max)}…` : s
}
/** 用一般瀏覽器 UA；自訂爬蟲 UA 容易被擋或只拿到中間頁 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const SUMMARY_INSTRUCTIONS =
  'You summarize a news article for a role-play chat bot\'s background knowledge.\n' +
  'Rules:\n' +
  '- Write ONLY facts that appear in the article text below. Do not comment, speculate, or add outside knowledge.\n' +
  '- Traditional Chinese (Taiwan).\n' +
  '- Avoid clickbait wording. If something is unclear, write「細節不明」.\n' +
  '- Output 2–4 short sentences of plain text only (about 120–280 characters). No title, no bullet list, no markdown.'

export interface EnrichNewsResult {
  promptContext: string
  source: PromptContextSource
  /** 是否打了輔助模型 */
  usedUtility: boolean
  /** 失敗時的簡短原因（仍有 fallback context） */
  warning?: string
}

interface CacheEntry {
  result: EnrichNewsResult
  at: number
  manual?: boolean
}

const cache = new Map<string, CacheEntry>()

export function clearNewsEnrichCache(): void {
  cache.clear()
}

function getCached(id: string): EnrichNewsResult | null {
  const hit = cache.get(id)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(id)
    return null
  }
  return hit.result
}

function putCache(id: string, result: EnrichNewsResult, manual = false): void {
  if (!id) return
  cache.set(id, { result, at: Date.now(), manual })
}

export function cacheManualPromptContext(newsId: string, promptContext: string): void {
  // 清空＝「這則不要摘要了」，不是「摘要是空字串」。存進去的話同一則之後
  // 再按「聊這個」會拿到空的 manual 快取，看起來像整理壞掉。
  if (!promptContext.trim()) {
    cache.delete(newsId)
    return
  }
  putCache(newsId, {
    promptContext: clipPromptContext(promptContext),
    source: 'manual',
    usedUtility: false
  }, true)
}

export function isGoogleNewsArticleUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return /(^|\.)news\.google\.com$/i.test(u.hostname) && /\/articles\//i.test(u.pathname)
  } catch {
    return false
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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

async function fetchHtml(http: HttpAdapter, url: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await http.fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
      }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
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
 * 從 `batchexecute` 的回應裡挖出原文 URL。
 *
 * ⚠️ **回應是分段格式，不是一包 JSON。** 去掉 `)]}'` 之後長這樣：
 *
 * ```
 * 199
 * [["wrb.fr","Fbv4je","[\"garturlres\",\"https://…\"]",null,null,null,"generic"]]
 * 26
 * [["di",25],["af.httprm",25,"…",5]]
 * ```
 *
 * 每個陣列前面有一行長度數字，而且**段數不固定**。原本的寫法只剝掉第一個
 * 長度數字就整包 `JSON.parse`，只要 Google 多回一段（實務上幾乎都會）
 * 就必定失敗——2026-08-12 真機診斷確認：RPC 回 200、URL 就在回應裡，
 * 但每一則 Google 新聞都被判成 `google-news-resolve-failed`。
 *
 * 所以改成**逐段掃**，而且最後留一層 regex 保底：Google 之後再改外層包裝，
 * 只要 `garturlres` 這個欄位還在就抓得到，不會又整條啞掉。
 */
export function extractGarturlres(raw: string): string | null {
  let body = normalizeRpcBody(raw)
  if (body.startsWith(")]}'")) {
    const nl = body.indexOf('\n')
    body = nl >= 0 ? body.slice(nl + 1) : body.slice(4)
  }

  // ① 逐段解析：跳過長度數字行，每一段各自 JSON.parse
  for (const chunk of body.split('\n')) {
    const line = chunk.trim()
    if (!line || /^\d+$/.test(line)) continue
    let envelopes: unknown
    try {
      envelopes = JSON.parse(line)
    } catch {
      continue
    }
    if (!Array.isArray(envelopes)) continue
    for (const env of envelopes) {
      if (!Array.isArray(env) || env[0] !== 'wrb.fr' || env[1] !== 'Fbv4je') continue
      if (typeof env[2] !== 'string') continue
      try {
        const payload = JSON.parse(env[2]) as unknown
        if (Array.isArray(payload) && payload[0] === 'garturlres' && typeof payload[1] === 'string') {
          return payload[1]
        }
      } catch {
        /* 這一段不是我們要的，往下找 */
      }
    }
  }

  // ② 保底：直接撈 `garturlres` 後面那個網址。
  // `\\*` 是**零到多個**反斜線——轉義層數不固定（見 `normalizeRpcBody`），
  // 寫死一層的話手機那邊永遠對不上。
  const m = body.match(/garturlres\\*",\\*"(https?:[^"\\]+)/)
  return m?.[1] ?? null
}

/**
 * 把被多包了一層的回應還原。
 *
 * ⚠️ **CapacitorHttp 會把回應多做一次 JSON 編碼。** batchexecute 宣稱
 * `content-type: application/json`，但內容有 `)]}'` 前綴、不是合法 JSON，
 * 原生層 parse 失敗後當字串留著，fetch patch 再 `JSON.stringify` 一次還給我們：
 * 換行變成字面上的 `\n` 兩個字元、引號變成 `\"`、原本的 `\"` 變成 `\\\"`。
 *
 * 於是「按換行切段」切不出東西、「容許一層反斜線」的 regex 也對不上，
 * 手機上每一則 Google 新聞都解不開；**桌面走 Node fetch 不會這樣，所以完全正常**
 * （2026-08-12 真機診斷）。
 *
 * 只在偵測到這個特徵時才還原，桌面那條路徑逐字不受影響。
 */
function normalizeRpcBody(raw: string): string {
  if (raw.includes('\n') || !raw.includes('\\n')) return raw
  try {
    const decoded = JSON.parse(`"${raw}"`)
    if (typeof decoded === 'string') return decoded
  } catch {
    /* 不是乾淨的 JSON 字串內容，往下用手動還原 */
  }
  return raw.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
}

/**
 * 把 Google 新聞 `rss/articles/CBMi…` 解成出版社原文 URL。
 * 2024 後不再把原文嵌在 base64 裡，要打 batchexecute。
 */
export async function resolveGoogleNewsArticleUrl(http: HttpAdapter, articleUrl: string): Promise<string | null> {
  if (!isGoogleNewsArticleUrl(articleUrl)) return null
  const articleId = articleUrl.replace(/\/$/, '').split('/').pop()?.split('?')[0]
  if (!articleId) return null

  const t0 = Date.now()
  let pageHtml: string
  try {
    pageHtml = await fetchHtml(http, articleUrl)
  } catch (e) {
    diag('resolve.page-fetch-failed', { ms: Date.now() - t0, err: e instanceof Error ? e.message : String(e) })
    throw e
  }
  const sg = pageHtml.match(/data-n-a-sg="([^"]+)"/)
  const ts = pageHtml.match(/data-n-a-ts="([^"]+)"/)
  diag('resolve.page-ok', {
    ms: Date.now() - t0,
    htmlLen: pageHtml.length,
    hasSig: !!sg?.[1],
    hasTs: !!ts?.[1],
    // 簽章挖不到時，這兩個線索能分辨「Google 改版」還是「回了同意頁／驗證頁」
    title: brief(pageHtml.match(/<title[^>]*>([\s\S]{0,80})/i)?.[1]?.trim(), 60),
    looksConsent: /consent\.google|CookieConsent|同意|sorry\/index/i.test(pageHtml.slice(0, 4000))
  })
  if (!sg?.[1] || !ts?.[1]) return null

  const rpcInner = JSON.stringify([
    'garturlreq',
    [
      ['X', 'X', ['X', 'X'], null, null, 1, 1, 'TW:zh-Hant', null, 1, null, null, null, null, null, 0, 1],
      'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0
    ],
    articleId,
    Number(ts[1]),
    sg[1]
  ])
  const fReq = JSON.stringify([[['Fbv4je', rpcInner, null, 'generic']]])

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const post = await http.fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': USER_AGENT,
        Referer: 'https://news.google.com/',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
      },
      body: new URLSearchParams({ 'f.req': fReq })
    })
    diag('resolve.rpc-status', { ms: Date.now() - t0, status: post.status, ok: post.ok })
    if (!post.ok) throw new Error(`batchexecute HTTP ${post.status}`)
    const raw = await post.text()
    diag('resolve.rpc-body', { len: raw.length, head: brief(raw, 80) })
    const url = extractGarturlres(raw)
    diag(url ? 'resolve.ok' : 'resolve.rpc-no-url', { ms: Date.now() - t0, url: brief(url || '') })
    return url
  } finally {
    clearTimeout(timer)
  }
}

/** 取得實際要抓正文的 URL（Google 新聞先解碼） */
export async function resolveFetchUrl(http: HttpAdapter, url: string): Promise<{ url: string; viaGoogleNews: boolean }> {
  if (!isGoogleNewsArticleUrl(url)) return { url, viaGoogleNews: false }
  try {
    const resolved = await resolveGoogleNewsArticleUrl(http, url)
    if (resolved) return { url: resolved, viaGoogleNews: true }
  } catch (e) {
    console.warn('[news enrich] google-news resolve failed', e instanceof Error ? e.message : e)
  }
  return { url, viaGoogleNews: true }
}

async function summarizeWithUtility(
  deps: LLMDeps,
  title: string,
  articleText: string,
  appSettings: AppSettings
): Promise<string | null> {
  const utilitySettings = applyUtilitySettings(appSettings)
  const clipped = articleText.slice(0, 12000)
  const userContent = `Title: ${title}\n\nArticle text:\n${clipped}`

  const work = chatWithLLM({
    settings: utilitySettings,
    character: {
      id: '__news-enrich__',
      name: 'news-enrich',
      personality: SUMMARY_INSTRUCTIONS,
      emotions: {}
    },
    messages: [{ id: '__ne', role: 'user', content: userContent, timestamp: Date.now() }],
    persona: null,
    world: null,
    desktopCharacterNames: [],
    isReminder: true,
    minimal: true
  }, deps)

  const timed = await Promise.race([
    work,
    new Promise<null>(resolve => setTimeout(() => resolve(null), 12000))
  ])
  if (!timed) return null
  const out = timed.content?.trim()
  if (!out) return null
  return clipPromptContext(out)
}

function rssFallback(item: NewsItem, warning?: string): EnrichNewsResult {
  const promptContext = fallbackPromptContext(item.title, item.summary)
  return {
    promptContext,
    source: isSummaryAdequate(item.title, item.summary) ? 'rss-adequate' : 'rss-fallback',
    usedUtility: false,
    warning
  }
}

export interface EnrichNewsOptions {
  forceRefresh?: boolean
  settings?: NewsModuleSettings
  appSettings?: AppSettings
}

/**
 * 診斷外殼：只負責在頭尾各印一行，實際邏輯全在 `enrichNewsForChatInner`。
 * 包一層而不是在八個 return 各加一行，是為了不可能漏掉任何一條退出路徑。
 */
export async function enrichNewsForChat(
  deps: EnrichDeps,
  item: NewsItem,
  options: EnrichNewsOptions = {}
): Promise<EnrichNewsResult> {
  const tStart = Date.now()
  diag('start', {
    title: brief(item.title, 40),
    force: !!options.forceRefresh,
    isGoogle: isGoogleNewsArticleUrl(item.url || ''),
    hasUtility: !!options.appSettings
  })
  try {
    const r = await enrichNewsForChatInner(deps, item, options)
    diag('end', {
      ms: Date.now() - tStart,
      source: r.source,
      usedUtility: r.usedUtility,
      warning: r.warning || '-',
      ctxLen: r.promptContext.length
    })
    return r
  } catch (e) {
    diag('end', { ms: Date.now() - tStart, threw: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

async function enrichNewsForChatInner(
  deps: EnrichDeps,
  item: NewsItem,
  options: EnrichNewsOptions = {}
): Promise<EnrichNewsResult> {
  const settings = options.settings ?? await loadNewsModuleSettings(deps.storage)
  if (settings.enrichForChat === false) {
    return rssFallback(item)
  }

  if (!options.forceRefresh && item.id) {
    const hit = getCached(item.id)
    if (hit) return hit
  }

  if (isSummaryAdequate(item.title, item.summary)) {
    const result: EnrichNewsResult = {
      promptContext: clipPromptContext(item.summary.trim()),
      source: 'rss-adequate',
      usedUtility: false
    }
    putCache(item.id, result)
    return result
  }

  if (!item.url?.trim()) {
    const result = rssFallback(item, 'no-url')
    putCache(item.id, result)
    return result
  }

  let fetchUrl = item.url
  let lastErr = ''
  try {
    const resolved = await resolveFetchUrl(deps.http, item.url)
    fetchUrl = resolved.url
    // 解碼失敗仍停在 Google 中間頁 → 幾乎抽不到正文，直接退回
    if (resolved.viaGoogleNews && isGoogleNewsArticleUrl(fetchUrl)) {
      const result = rssFallback(item, 'google-news-resolve-failed')
      putCache(item.id, result)
      return result
    }
  } catch (e) {
    lastErr = e instanceof Error ? e.message : String(e)
    if (isGoogleNewsArticleUrl(item.url)) {
      const result = rssFallback(item, `google-news-resolve-failed: ${lastErr}`)
      putCache(item.id, result)
      return result
    }
  }

  diag('article.fetch-start', { url: brief(fetchUrl) })
  let html: string | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const t = Date.now()
    try {
      html = await fetchHtml(deps.http, fetchUrl)
      diag('article.fetch-ok', { attempt, ms: Date.now() - t, htmlLen: html.length })
      break
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      diag('article.fetch-fail', { attempt, ms: Date.now() - t, err: lastErr })
      html = null
    }
  }
  if (!html) {
    const result = rssFallback(item, `fetch-failed: ${lastErr}`)
    putCache(item.id, result)
    return result
  }

  // Google 中間頁誤抓時通常 title 還是「Google 新聞」
  if (/<title[^>]*>\s*Google\s*新聞/i.test(html) || /<title[^>]*>\s*Google\s*News/i.test(html)) {
    const result = rssFallback(item, 'fetched-google-interstitial')
    putCache(item.id, result)
    return result
  }

  const article = extractArticleText(html)
  diag('article.extracted', { chars: article.replace(/\s+/g, '').length })
  if (!article || article.replace(/\s+/g, '').length < 40) {
    const result = rssFallback(item, 'empty-article')
    putCache(item.id, result)
    return result
  }

  const mode = decideArticleHandling(article)
  if (mode === 'direct') {
    const result: EnrichNewsResult = {
      promptContext: clipPromptContext(article.slice(0, ARTICLE_DIRECT_MAX_LEN)),
      source: 'article-excerpt',
      usedUtility: false
    }
    putCache(item.id, result)
    return result
  }

  if (!options.appSettings) {
    const result: EnrichNewsResult = {
      promptContext: clipPromptContext(article.slice(0, ARTICLE_DIRECT_MAX_LEN)),
      source: 'article-excerpt',
      usedUtility: false,
      warning: 'no-app-settings-for-utility'
    }
    putCache(item.id, result)
    return result
  }

  const tUtil = Date.now()
  try {
    const summary = await summarizeWithUtility(deps, item.title, article, options.appSettings)
    diag('utility.done', { ms: Date.now() - tUtil, got: !!summary })
    if (summary) {
      const result: EnrichNewsResult = {
        promptContext: summary,
        source: 'utility-summary',
        usedUtility: true
      }
      putCache(item.id, result)
      return result
    }
  } catch (e) {
    lastErr = e instanceof Error ? e.message : String(e)
    diag('utility.failed', { ms: Date.now() - tUtil, err: lastErr })
  }

  const result: EnrichNewsResult = {
    promptContext: clipPromptContext(article.slice(0, ARTICLE_DIRECT_MAX_LEN)),
    source: 'article-excerpt',
    usedUtility: false,
    warning: `utility-failed: ${lastErr || 'empty'}`
  }
  putCache(item.id, result)
  return result
}

export function applyEnrichToItem(item: NewsItem, enrich: EnrichNewsResult): NewsItem {
  return { ...item, promptContext: enrich.promptContext }
}
