/**
 * 對話新聞搜尋：使用者訊息含時事意圖時，回應前即時查 Google News RSS 補充事實
 * （B1 抽 core，桌面搬到手機獨立版，2026-08-22）。
 *
 * 與新聞陪聊（`sources.ts`／`injection.ts`）不同——那是主動定時／「說點什麼」
 * 抓取，這支是被動、對話觸發、不落地快取。原本是 `main/modules/news/
 * conversationSearch.ts` 桌面專屬邏輯，搬進 core 只改了兩處平台耦合：
 * `rss-parser` 換成注入的 `RssParseAdapter`（理由見 `rssAdapter.ts` 檔頭），
 * LLM 呼叫改吃 core 的 `chatWithLLM`／`applyUtilitySettings`。其餘邏輯逐字保留。
 */
import type { HttpAdapter } from '../adapters/http'
import { chatWithLLM, applyUtilitySettings, type LLMDeps } from '../llm'
import type { AppSettings } from '../types'
import type { NewsModuleSettings } from './types'
import type { RssParseAdapter } from './rssAdapter'
import { buildKeywordRssUrl } from './sources'

const FETCH_TIMEOUT_MS = 8000
const USER_AGENT = 'DesktopST-News/1.0 (+https://nori.tw/DeST)'

export interface ConversationSearchDeps extends LLMDeps {
  rss: RssParseAdapter
}

/** 前置過濾：訊息是否含任一觸發詞。triggerWords 為空時視為無過濾（全送）。 */
export function shouldTriggerSearch(message: string, triggerWords: string[]): boolean {
  if (triggerWords.length === 0) return true
  return triggerWords.some(w => message.includes(w))
}

const EXTRACTION_INSTRUCTIONS =
  'Determine whether the user message is asking about a real-world current event or news story.\n' +
  'If yes, output a Traditional Chinese (Taiwan) Google search query: at most 3 keywords separated by spaces, 2–5 characters each, core concepts only.\n' +
  'If the message is not about a searchable current event, output "null". Output the query or null only, no other explanation.'

export interface ConversationSearchResult {
  context: string | null
  debugPrompt: string | null
  inputTokens?: number
  outputTokens?: number
}

/** 用輔助（或主要）模型萃取搜尋詞。回傳 null query 表示不需要搜尋。 */
async function extractSearchQuery(
  deps: LLMDeps,
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
  }, deps)

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

function relativeTime(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (isNaN(diff)) return ''
  const hours = diff / 3600000
  if (hours < 1) return 'just now'
  if (hours < 24) return `${Math.floor(hours)}h ago`
  if (hours < 48) return 'yesterday'
  return `${Math.floor(hours / 24)}d ago`
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

async function fetchXml(http: HttpAdapter, url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await http.fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/** Google News RSS 即時搜尋，回傳最多 3 則結果。失敗回空陣列。 */
export async function searchGoogleNewsRss(
  deps: ConversationSearchDeps,
  query: string,
  maxAgeHours: number
): Promise<SearchResultItem[]> {
  const url = buildKeywordRssUrl(query)
  try {
    const xml = await fetchXml(deps.http, url)
    const feed = await deps.rss.parseFeed(xml)
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
      let outlet = stripHtml(entry.source) || stripHtml(entry.creator)
      // Google News 標題格式「真正標題 - 媒體」
      const dashIdx = title.lastIndexOf(' - ')
      if (dashIdx > 0) {
        const tail = title.slice(dashIdx + 3).trim()
        if (tail) { if (!outlet) outlet = tail; title = title.slice(0, dashIdx).trim() }
      }
      // 摘要：從 content HTML 抽相關標題（排除主標題），避免 contentSnippet 直接複製標題內容
      const contentHtml = entry.content ?? entry.contentSnippet ?? ''
      const related = extractRelatedHeadlines(contentHtml).filter(h => h !== title).slice(0, 2)
      const summary = related.join('／')
      if (!title) continue
      items.push({ title, summary, source: outlet || 'Unknown outlet', publishedAt })
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
  const lines: string[] = [`[Conversation search: ${query}]`]
  items.forEach((item, i) => {
    const timeTag = relativeTime(item.publishedAt)
    const meta = [item.source, timeTag].filter(Boolean).join(', ')
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
  deps: ConversationSearchDeps,
  userMessage: string,
  settings: AppSettings,
  newsSettings: NewsModuleSettings
): Promise<ConversationSearchResult> {
  const cs = newsSettings.conversationSearch
  if (!cs?.enabled) return { context: null, debugPrompt: null }

  if (!shouldTriggerSearch(userMessage, cs.triggerWords)) return { context: null, debugPrompt: null }

  const { query, debugPrompt, inputTokens, outputTokens } = await extractSearchQuery(deps, userMessage, settings)
  if (!query) return { context: null, debugPrompt, inputTokens, outputTokens }

  const items = await searchGoogleNewsRss(deps, query, cs.maxAgeHours)
  const context = buildConversationSearchInjection(query, items)
  return { context, debugPrompt, inputTokens, outputTokens }
}
