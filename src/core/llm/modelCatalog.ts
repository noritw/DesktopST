import type { LlmProvider } from '../data/types'

/**
 * 四家供應商的模型目錄與參考價 —— **桌面版與手機版共用的唯一一份**。
 *
 * 原本只存在桌面 `SettingsWindow.tsx` 裡，手機 `providerInfo.ts` 另外自己列了
 * 四五個常用型號。結果就是 owner 2026-08-06 回報的「模型清單應該跟桌面版同步」：
 * 桌面加了新型號、手機不知道，正是 roadmap §4.1 要防的 drift。
 *
 * ## 為什麼可以放 `core/`
 *
 * 這裡**只有資料**：型號字串與數字價格，沒有任何中文 UI 文案
 * （roadmap §3.3 禁止進 core 的是文案）。「⚠ 高單價」這類標籤仍留在各自的 UI 層，
 * 本檔只提供 `isHighPriceModel()` 這種純判斷讓兩邊套用同一套規則。
 *
 * ## ⚠️ 不要從 `core/llm/index.ts` re-export 這個檔案
 *
 * `index.ts` 會 import Anthropic／OpenAI／Google 的 SDK。手機 UI 只需要這份清單，
 * 若透過 `index.ts` 取用會把整包 SDK 拖進手機的 bundle。
 * **呼叫端一律直接 `import ... from '@core/llm/modelCatalog'`。**
 *
 * ## 維護方式
 *
 * 人工同步，依各家官方定價頁。改動時**只改這裡**，兩個 UI 自動跟上。
 */

/** 模型清單與價格的人工同步日期（依各家官方定價頁） */
export const MODEL_DATA_UPDATED = '2026-08-01'

/** 建議值：與官方目錄同步手動維護，或以帳戶可用的 `GET https://api.openai.com/v1/models` 為準 */
export const OPENAI_MODELS = [
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
  'gpt-5.5', 'gpt-5.5-pro',
  'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
  'gpt-5.2', 'gpt-5.2-pro', 'gpt-5.1',
  'gpt-5', 'gpt-5-pro', 'gpt-5-mini', 'gpt-5-nano',
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  'gpt-4o', 'gpt-4o-mini',
  'o3', 'o3-pro', 'o4-mini', 'o1'
]

export const CLAUDE_MODELS = [
  'claude-fable-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5'
]

/*
 * 2.5 系列已從清單移除：Google 對新帳戶關閉了這批模型，實測回
 * `404 This model models/gemini-2.5-flash-lite is no longer available to new users`。
 * 價格表仍保留它們，讓舊訊息與手打的自訂 ID 還能顯示價格。
 */
export const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview'
]

export const GROK_MODELS = [
  'grok-4.5',
  'grok-4.3',
  'grok-4.20-0309-reasoning',
  'grok-4.20-0309-non-reasoning'
]

/**
 * 本機／自訂端點沒有固定型號 —— 使用者自己 pull 什麼就有什麼。
 * 清單刻意留空，由「測試連線」打 `GET /v1/models` 動態填入（見 `testLLMConnection`）。
 */
export const LOCAL_MODELS: string[] = []

/** 供應商 → 該家的模型清單。手機的下拉選單直接吃這個。 */
export const MODELS_BY_PROVIDER: Record<LlmProvider, string[]> = {
  openai: OPENAI_MODELS,
  claude: CLAUDE_MODELS,
  gemini: GEMINI_MODELS,
  grok: GROK_MODELS,
  local: LOCAL_MODELS
}

/**
 * 每家的預設模型（切換供應商時自動選這個）。
 *
 * **一律挑該家最便宜、且非高單價區的**。不要拿清單第一個當預設——
 * 清單是照新舊排的，Claude 的第一個是 `claude-fable-5`（$10/$50），
 * 使用者切過去隨手聊兩句就會很痛。
 */
export const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, string> = {
  openai: 'gpt-5.6-luna',
  claude: 'claude-haiku-4-5',
  gemini: 'gemini-3.1-flash-lite',
  grok: 'grok-4.3',
  // 本機沒有「大家都有」的型號，猜一個只會讓連線測試失敗得莫名其妙。
  // 留空 → UI 逼使用者先測連線再從實際清單挑。
  local: ''
}

/** 本機端點常見預設值，UI 拿去當 placeholder／快速填入。 */
export const LOCAL_ENDPOINT_PRESETS: Array<{ label: string; url: string }> = [
  { label: 'Ollama', url: 'http://localhost:11434/v1' },
  { label: 'LM Studio', url: 'http://localhost:1234/v1' }
]

/** 每百萬 tokens 美金價（輸入, 輸出）；未列出的模型（如官方快照 ID、自訂 ID）不顯示價格 */
export const MODEL_PRICES: Record<string, [number, number]> = {
  // OpenAI
  'gpt-5.6-sol': [5, 30],
  'gpt-5.6-terra': [2, 12],
  'gpt-5.6-luna': [0.2, 1.2],
  'gpt-5.5': [5, 30],
  'gpt-5.5-pro': [30, 180],
  'gpt-5.4': [2.5, 15],
  'gpt-5.4-pro': [30, 180],
  'gpt-5.4-mini': [0.75, 4.5],
  'gpt-5.4-nano': [0.2, 1.25],
  'gpt-5.2': [1.75, 14],
  'gpt-5.2-pro': [21, 168],
  'gpt-5.1': [1.25, 10],
  'gpt-5': [1.25, 10],
  'gpt-5-pro': [15, 120],
  'gpt-5-mini': [0.25, 2],
  'gpt-5-nano': [0.05, 0.4],
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  'o3': [2, 8],
  'o3-pro': [20, 80],
  'o4-mini': [1.1, 4.4],
  'o1': [15, 60],
  // Anthropic Claude
  'claude-fable-5': [10, 50],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-sonnet-5': [3, 15],
  'claude-opus-4-7': [5, 25],
  'claude-sonnet-4-6': [3, 15],
  'claude-opus-4-6': [5, 25],
  'claude-haiku-4-5': [1, 5],
  // Google Gemini（長 prompt 分級價以 ≤200K tokens 計）
  'gemini-3.6-flash': [1.5, 7.5],
  'gemini-3.5-flash': [1.5, 9],
  'gemini-3.5-flash-lite': [0.3, 2.5],
  'gemini-3.1-flash-lite': [0.25, 1.5],
  'gemini-3.1-pro-preview': [2, 12],
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.5-flash-lite': [0.1, 0.4],
  'gemini-2.5-pro': [1.25, 10],
  // xAI Grok
  'grok-4.5': [2, 6],
  'grok-4.3': [1.25, 2.5],
  'grok-4.20-0309-reasoning': [1.25, 2.5],
  'grok-4.20-0309-non-reasoning': [1.25, 2.5]
}

/** `$3 / $15`（輸入 / 輸出，每百萬 tokens）。查無價格回 `null`。 */
export function modelPriceText(m: string): string | null {
  const p = MODEL_PRICES[m]
  return p ? `$${p[0]} / $${p[1]}` : null
}

/** 高單價門檻（每百萬 tokens 美金）：輸入或輸出任一超過就歸到高單價區並加警告 */
export const HIGH_PRICE_INPUT = 10
export const HIGH_PRICE_OUTPUT = 50

export function isHighPriceModel(m: string): boolean {
  const p = MODEL_PRICES[m]
  if (!p) return false
  return p[0] >= HIGH_PRICE_INPUT || p[1] >= HIGH_PRICE_OUTPUT
}

/** 把模型清單依單價拆成一般／高單價兩組，供 optgroup 使用 */
export function splitModelsByPrice(list: string[]): { normal: string[]; high: string[] } {
  const normal: string[] = []
  const high: string[] = []
  for (const m of list) (isHighPriceModel(m) ? high : normal).push(m)
  return { normal, high }
}
