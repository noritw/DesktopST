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
 */

const FETCH_TIMEOUT_MS = 8000
const CACHE_TTL_MS = 4 * 60 * 60 * 1000
const USER_AGENT = 'DesktopST-News/1.0 (+https://nori.tw/DeST)'

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
  /** 使用者手動改過則重抓前需確認；這裡標記來源 */
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

/** 供面板「儲存」後寫入 cache，避免立刻重抓蓋掉手動版 */
export function cacheManualPromptContext(newsId: string, promptContext: string): void {
  putCache(newsId, {
    promptContext: clipPromptContext(promptContext),
    source: 'manual',
    usedUtility: false
  }, true)
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
  // 常見 CMS 內容區
  const fromEntry = pick(/<(?:div|section)\b[^>]*(?:class|id)=["'][^"']*(?:article-body|post-content|entry-content|story-body)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i)
  if (fromEntry.length >= 80) return fromEntry
  // 去掉 head 後整頁
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
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
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

async function summarizeWithUtility(
  title: string,
  articleText: string,
  appSettings: AppSettings
): Promise<string | null> {
  const utilitySettings = applyUtilitySettings(appSettings)
  const clipped = articleText.slice(0, 12000)
  const userContent =
    `Title: ${title}\n\nArticle text:\n${clipped}`

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
  /** 忽略 cache 強制重抓（面板「重新整理」） */
  forceRefresh?: boolean
  /** 覆寫設定（測試／呼叫端已 load） */
  settings?: NewsModuleSettings
  /** 輔助模型需要 AppSettings；未傳則長文只節錄不打模型 */
  appSettings?: AppSettings
}

/**
 * 對一則 NewsItem 產出可編輯的 promptContext。
 * enrichForChat === false 時行為＝今日現況（不抓原文、不打模型）。
 */
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

  // 夠用 → 不抓
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

  let html: string | null = null
  let lastErr = ''
  // 失敗不重試超過 1 次 → 最多 2 次嘗試
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      html = await fetchHtml(item.url)
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

  // 長文摘要失敗：退回節錄前段，仍比 RSS 標題串好
  const result: EnrichNewsResult = {
    promptContext: clipPromptContext(article.slice(0, ARTICLE_DIRECT_MAX_LEN)),
    source: 'article-excerpt',
    usedUtility: false,
    warning: `utility-failed: ${lastErr || 'empty'}`
  }
  putCache(item.id, result)
  return result
}

/** 把 enrich 結果寫回 item（不改 RSS summary） */
export function applyEnrichToItem(item: NewsItem, enrich: EnrichNewsResult): NewsItem {
  return { ...item, promptContext: enrich.promptContext }
}
