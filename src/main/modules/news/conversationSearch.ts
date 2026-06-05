import Parser from 'rss-parser'
import { chatWithLLM, applyUtilitySettings } from '../../llm/index'
import type { AppSettings } from '../../types'
import type { NewsModuleSettings } from './types'

const rssParser = new Parser({
  timeout: 5000,
  headers: { 'User-Agent': 'DesktopST-News/1.0 (+https://nori.tw/DeST)' }
})

/** 前置過濾：訊息是否含任一觸發詞。triggerWords 為空時視為無過濾（全送）。 */
export function shouldTriggerSearch(message: string, triggerWords: string[]): boolean {
  if (triggerWords.length === 0) return true
  return triggerWords.some(w => message.includes(w))
}

const EXTRACTION_INSTRUCTIONS =
  '你是一個助手，判斷使用者訊息是否在問一件現實世界的時事或新聞。\n' +
  '若是，給出適合 Google 搜尋的繁體中文查詢詞：最多 3 個關鍵詞、以空格分隔、每詞 2–5 字，只取核心概念。\n' +
  '若訊息不涉及可搜尋的時事，回覆「null」。只輸出查詢詞或 null，不要其他說明。'

export interface ConversationSearchResult {
  context: string | null
  debugPrompt: string | null
  inputTokens?: number
  outputTokens?: number
}

/** 用輔助（或主要）模型萃取搜尋詞。回傳 null query 表示不需要搜尋。 */
async function extractSearchQuery(
  message: string,
  settings: AppSettings
): Promise<{ query: string | null; debugPrompt: string | null; inputTokens?: number; outputTokens?: number }> {
  const utilitySettings = applyUtilitySettings(settings)

  const extractionPromise = chatWithLLM({
    settings: utilitySettings,
    character: { id: '__conv-search__', name: 'search', personality: EXTRACTION_INSTRUCTIONS, emotions: {} },
    messages: [{ id: '__cs', role: 'user', content: message, timestamp: Date.now() }],
    persona: null,
    world: null,
    desktopCharacterNames: [],
    isReminder: true,
    minimal: true
  })

  const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 5000))

  try {
    const result = await Promise.race([extractionPromise, timeoutPromise])
    if (!result) return { query: null, debugPrompt: null }
    const raw = result.content.trim()
    if (!raw || raw.toLowerCase() === 'null') {
      return { query: null, debugPrompt: result.debugPrompt, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
    }
    const words = raw.split(/\s+/).filter(Boolean).slice(0, 3)
    const query = words.length > 0 ? words.join(' ') : null
    return { query, debugPrompt: result.debugPrompt, inputTokens: result.inputTokens, outputTokens: result.outputTokens }
  } catch {
    return { query: null, debugPrompt: null }
  }
}

interface SearchResultItem {
  title: string
  summary: string
  source: string
  publishedAt: string
}

function stripHtml(text: string | undefined): string {
  if (!text) return ''
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

function extractOutlet(entry: Record<string, unknown>): string {
  const src = entry.source
  if (typeof src === 'string') return stripHtml(src)
  if (src && typeof src === 'object') {
    const o = src as { _?: string; '#'?: string; title?: string }
    return stripHtml(o._ ?? o['#'] ?? o.title ?? '')
  }
  return stripHtml(entry.creator as string | undefined)
}

function relativeTime(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (isNaN(diff)) return ''
  const hours = diff / 3600000
  if (hours < 1) return '剛剛'
  if (hours < 24) return `${Math.floor(hours)} 小時前`
  if (hours < 48) return '昨天'
  return `${Math.floor(hours / 24)} 天前`
}

/**
 * Google News description 是「同事件多媒體標題清單」的 HTML，
 * 抽出 <a> 文字、去掉主標題後當作補充脈絡（與 sources.ts 相同邏輯）。
 */
function extractRelatedHeadlines(html: string): string[] {
  if (!html) return []
  const out: string[] = []
  const re = /<a[^>]*>([^]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const text = stripHtml(m[1]).split(/\s*[|｜]\s*/)[0].trim()
    if (text) out.push(text)
  }
  return out
}

/** Google News RSS 即時搜尋，回傳最多 3 則結果。失敗回空陣列。 */
export async function searchGoogleNewsRss(
  query: string,
  maxAgeHours: number
): Promise<SearchResultItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`
  try {
    const feed = await rssParser.parseURL(url)
    const cutoff = maxAgeHours > 0 ? Date.now() - maxAgeHours * 3600000 : 0
    const items: SearchResultItem[] = []
    for (const entry of feed.items ?? []) {
      if (items.length >= 3) break
      const publishedAt = entry.isoDate ?? entry.pubDate ?? ''
      if (maxAgeHours > 0 && publishedAt) {
        const t = new Date(publishedAt).getTime()
        if (!isNaN(t) && t < cutoff) continue
      }
      let title = stripHtml(entry.title)
      let outlet = extractOutlet(entry as Record<string, unknown>)
      // Google News 標題格式「真正標題 - 媒體」
      const dashIdx = title.lastIndexOf(' - ')
      if (dashIdx > 0) {
        const tail = title.slice(dashIdx + 3).trim()
        if (tail) { if (!outlet) outlet = tail; title = title.slice(0, dashIdx).trim() }
      }
      // 摘要：從 content HTML 抽相關標題（排除主標題），避免 contentSnippet 直接複製標題內容
      const contentHtml = (entry.content as string | undefined) ?? (entry.contentSnippet as string | undefined) ?? ''
      const related = extractRelatedHeadlines(contentHtml).filter(h => h !== title).slice(0, 2)
      const summary = related.join('／')
      if (!title) continue
      items.push({ title, summary, source: outlet || '未知媒體', publishedAt })
    }
    return items
  } catch (e) {
    console.warn('[conv-search] Google News RSS failed:', (e as Error).message)
    return []
  }
}

/** 將搜尋結果組成注入字串。items 為空時回傳 null（不注入）。 */
export function buildConversationSearchInjection(
  query: string,
  items: SearchResultItem[]
): string | null {
  if (items.length === 0) return null
  const lines: string[] = [`[對話搜尋：${query}]`]
  items.forEach((item, i) => {
    const timeTag = relativeTime(item.publishedAt)
    const meta = [item.source, timeTag].filter(Boolean).join('，')
    lines.push(`${i + 1}. ${item.title}（${meta}）`)
    if (item.summary) {
      const snip = item.summary.slice(0, 60) + (item.summary.length > 60 ? '…' : '')
      lines.push(`   ${snip}`)
    }
  })
  return lines.join('\n')
}

/**
 * 完整流程：前置過濾 → LLM 萃取 → RSS 搜尋 → 組注入字串。
 * 任一關卡跳過或失敗時靜默回傳 context: null。
 * 即使最終沒搜到新聞，只要有發出 LLM call 就會帶回 debugPrompt / token 計數。
 */
export async function getConversationSearchContext(
  userMessage: string,
  settings: AppSettings,
  newsSettings: NewsModuleSettings
): Promise<ConversationSearchResult> {
  const cs = newsSettings.conversationSearch
  if (!cs?.enabled) return { context: null, debugPrompt: null }

  if (!shouldTriggerSearch(userMessage, cs.triggerWords)) return { context: null, debugPrompt: null }

  const { query, debugPrompt, inputTokens, outputTokens } = await extractSearchQuery(userMessage, settings)
  if (!query) return { context: null, debugPrompt, inputTokens, outputTokens }

  const items = await searchGoogleNewsRss(query, cs.maxAgeHours)
  const context = buildConversationSearchInjection(query, items)
  return { context, debugPrompt, inputTokens, outputTokens }
}
