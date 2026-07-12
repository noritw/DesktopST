/**
 * 災害新聞補充模組
 *
 * 當即時氣象查詢命中災害類關鍵詞時，自動從 Google News RSS 補搜相關新聞，
 * 讓角色除了氣象數據外也能掌握社會面資訊（停班停課、災情、交通影響等）。
 *
 * 設計原則：
 * - 強信號關鍵詞：直接補搜新聞（零額外延遲，只有 RSS fetch）
 * - 弱信號關鍵詞：交 LLM 判斷是否為即時狀況詢問（避免「好熱想吃冰」觸發新聞）
 * - 新聞時效硬編碼，不讀使用者 conversationSearch 設定
 * - 搜不到新聞 → 不注入，零副作用
 */

import { searchGoogleNewsRss, buildConversationSearchInjection } from './modules/news/conversationSearch'
import { chatWithLLM, applyUtilitySettings } from './llm/index'
import type { AppSettings } from './types'

// ─── 關鍵詞表載入 ─────────────────────────────────────────────

export type DisasterCategory = 'typhoon' | 'earthquake' | 'heavy-rain' | 'cold-wave' | 'heat-wave'

interface CategoryConfig {
  strong: string[]
  weak: string[]
  newsQuery: string
  newsMaxAgeHours: number
}

interface DisasterKeywordsData {
  categories: Record<DisasterCategory, CategoryConfig>
}

// Vite 會在打包時將 JSON 靜態內嵌；執行時若要 hot-reload 可用 reloadDisasterKeywords()
import defaultKeywords from './disasterKeywords.json'

let cachedKeywords: DisasterKeywordsData = defaultKeywords as unknown as DisasterKeywordsData

function loadKeywords(): DisasterKeywordsData {
  return cachedKeywords
}

/** 重新載入關鍵詞表（開發用：動態讀取檔案） */
export function reloadDisasterKeywords(): void {
  try {
    const { readFileSync } = require('fs')
    const { join } = require('path')
    const raw = readFileSync(join(__dirname, 'disasterKeywords.json'), 'utf-8')
    cachedKeywords = JSON.parse(raw) as DisasterKeywordsData
  } catch {
    // fallback to bundled version
    cachedKeywords = defaultKeywords as unknown as DisasterKeywordsData
  }
}

// ─── 偵測邏輯 ─────────────────────────────────────────────────

export interface DisasterDetection {
  category: DisasterCategory
  signal: 'strong' | 'weak'
  newsQuery: string
  newsMaxAgeHours: number
}

/**
 * 偵測訊息中的災害/極端天氣關鍵詞。
 * 回傳第一個命中的類別（優先順序：typhoon > earthquake > heavy-rain > cold-wave > heat-wave）。
 * 未命中回 null。
 */
export function detectDisasterCategory(message: string): DisasterDetection | null {
  const { categories } = loadKeywords()
  const order: DisasterCategory[] = ['typhoon', 'earthquake', 'heavy-rain', 'cold-wave', 'heat-wave']

  for (const cat of order) {
    const config = categories[cat]
    if (!config) continue

    // 強信號優先
    if (config.strong.some(kw => message.includes(kw))) {
      return {
        category: cat,
        signal: 'strong',
        newsQuery: config.newsQuery,
        newsMaxAgeHours: config.newsMaxAgeHours
      }
    }

    // 弱信號
    if (config.weak.some(kw => message.includes(kw))) {
      return {
        category: cat,
        signal: 'weak',
        newsQuery: config.newsQuery,
        newsMaxAgeHours: config.newsMaxAgeHours
      }
    }
  }

  return null
}

// ─── LLM 弱信號判斷 ──────────────────────────────────────────

const WEAK_SIGNAL_PROMPT =
  'The user said: "{message}"\n' +
  'Is the user asking about or concerned with a current real-world weather/disaster situation ' +
  '(typhoon, earthquake, heavy rain, cold wave, heat wave), or are they just casually complaining/chatting?\n' +
  'Answer "yes" if they seem to want real-time information, "no" if it is just casual talk.\n' +
  'Output only "yes" or "no".'

/**
 * 用輔助模型判斷弱信號是否需要補搜新聞。
 * 失敗/逾時時預設回 false（不搜）。
 */
async function shouldSupplementNews(message: string, settings: AppSettings): Promise<boolean> {
  if (!settings.llm.utilityEnabled) return false

  const utilitySettings = applyUtilitySettings(settings)
  const prompt = WEAK_SIGNAL_PROMPT.replace('{message}', message.slice(0, 200))

  try {
    const resultPromise = chatWithLLM({
      settings: utilitySettings,
      character: { id: '__disaster-check__', name: 'check', personality: prompt, emotions: {} },
      messages: [{ id: '__dc', role: 'user', content: message, timestamp: Date.now() }],
      persona: null,
      world: null,
      desktopCharacterNames: [],
      isReminder: true,
      minimal: true
    })

    const timeoutPromise = new Promise<null>(resolve => setTimeout(() => resolve(null), 3000))
    const result = await Promise.race([resultPromise, timeoutPromise])

    if (!result) return false
    return result.content.trim().toLowerCase().startsWith('yes')
  } catch {
    return false
  }
}

// ─── 主流程 ──────────────────────────────────────────────────

export interface DisasterNewsResult {
  /** 注入字串（null = 不注入） */
  context: string | null
  /** 偵測到的災害類別（null = 未命中） */
  category: DisasterCategory | null
  /** 動態 query（帶颱風名時會不同） */
  queryUsed: string | null
}

/**
 * 災害新聞補搜主流程。
 *
 * @param userMessage 使用者訊息
 * @param settings App 設定（用於 LLM 弱信號判斷）
 * @param typhoonName 若 CWA 查詢已取得颱風名，傳入以提高新聞搜尋精度
 */
export async function getDisasterNewsSupplement(
  userMessage: string,
  settings: AppSettings,
  typhoonName?: string
): Promise<DisasterNewsResult> {
  const detection = detectDisasterCategory(userMessage)
  if (!detection) return { context: null, category: null, queryUsed: null }

  // 弱信號 → LLM 判斷
  if (detection.signal === 'weak') {
    const shouldSearch = await shouldSupplementNews(userMessage, settings)
    if (!shouldSearch) return { context: null, category: detection.category, queryUsed: null }
  }

  // 組 query（颱風帶名字）
  let query = detection.newsQuery
  if (detection.category === 'typhoon' && typhoonName) {
    query = `颱風 ${typhoonName}`
  }

  // 搜尋 Google News RSS
  try {
    const items = await searchGoogleNewsRss(query, detection.newsMaxAgeHours)
    const context = buildConversationSearchInjection(query, items)
    return { context, category: detection.category, queryUsed: query }
  } catch {
    return { context: null, category: detection.category, queryUsed: query }
  }
}
