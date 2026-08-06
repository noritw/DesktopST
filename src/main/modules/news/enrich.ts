import { chatWithLLM, applyUtilitySettings } from '../../llm/index'
import type { AppSettings } from '../../types'
import {
  ARTICLE_DIRECT_MAX_LEN,
  clipPromptContext,
  decideArticleHandling,
  fallbackPromptContext,
  isSummaryAdequate,
  type PromptContextSource
} from '../../../core/news/enrich'
import type { NewsItem, NewsModuleSettings } from './types'
import { loadNewsModuleSettings } from './settings'

/**
 * 新聞進 Prompt 的 enrichment（平台層）：
 * 抓原文 → 抽正文 → 短文直塞／長文輔助模型摘要；失敗退回 RSS。
 *
 * ⚠️ Google 新聞 RSS 的 link 是 `news.google.com/rss/articles/CBMi…`，
 * **不會 HTTP 轉址到原文**（回的是 Google 中間頁）。必須先解碼才抓得到正文。
 */

const FETCH_TIMEOUT_MS = 8000
const CACHE_TTL_MS = 4 * 60 * 60 * 1000
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

async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
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
 * 把 Google 新聞 `rss/articles/CBMi…` 解成出版社原文 URL。
 * 2024 後不再把原文嵌在 base64 裡，要打 batchexecute。
 */
export async function resolveGoogleNewsArticleUrl(articleUrl: string): Promise<string | null> {
  if (!isGoogleNewsArticleUrl(articleUrl)) return null
  const articleId = articleUrl.replace(/\/$/, '').split('/').pop()?.split('?')[0]
  if (!articleId) return null

  const pageHtml = await fetchHtml(articleUrl)
  const sg = pageHtml.match(/data-n-a-sg="([^"]+)"/)
  const ts = pageHtml.match(/data-n-a-ts="([^"]+)"/)
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
    const post = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
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
    if (!post.ok) throw new Error(`batchexecute HTTP ${post.status}`)
    let body = await post.text()
    if (body.startsWith(")]}'")) {
      const nl = body.indexOf('\n')
      body = nl >= 0 ? body.slice(nl + 1) : body.slice(4)
    }
    body = body.trim()
    if (/^\d+\n/.test(body)) body = body.replace(/^\d+\n/, '')
    const envelopes = JSON.parse(body) as unknown
    if (!Array.isArray(envelopes)) return null
    for (const env of envelopes) {
      if (!Array.isArray(env) || env[0] !== 'wrb.fr' || env[1] !== 'Fbv4je') continue
      if (typeof env[2] !== 'string') continue
      const payload = JSON.parse(env[2]) as unknown
      if (Array.isArray(payload) && payload[0] === 'garturlres' && typeof payload[1] === 'string') {
        return payload[1]
      }
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 取得實際要抓正文的 URL（Google 新聞先解碼） */
export async function resolveFetchUrl(url: string): Promise<{ url: string; viaGoogleNews: boolean }> {
  if (!isGoogleNewsArticleUrl(url)) return { url, viaGoogleNews: false }
  try {
    const resolved = await resolveGoogleNewsArticleUrl(url)
    if (resolved) return { url: resolved, viaGoogleNews: true }
  } catch (e) {
    console.warn('[news enrich] google-news resolve failed', e instanceof Error ? e.message : e)
  }
  return { url, viaGoogleNews: true }
}

async function summarizeWithUtility(
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
  })

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

export async function enrichNewsForChat(
  item: NewsItem,
  options: EnrichNewsOptions = {}
): Promise<EnrichNewsResult> {
  const settings = options.settings ?? loadNewsModuleSettings()
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
    const resolved = await resolveFetchUrl(item.url)
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

  let html: string | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      html = await fetchHtml(fetchUrl)
      break
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
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

  try {
    const summary = await summarizeWithUtility(item.title, article, options.appSettings)
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
