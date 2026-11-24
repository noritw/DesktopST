import { MODEL_PRICES } from './modelCatalog'

/**
 * LLM 用量帳本的純邏輯：一筆紀錄長什麼樣、怎麼估價、怎麼加總。
 * **不記對話內容**，只記次數與 token 數。
 */

export const LLM_FEATURES = {
  chat: '聊天',
  'walk-talk': '同行說話',
  'walk-item': '旅途道具',
  'walk-foe': '旅途敵人',
  greeting: '主動問候',
  reminder: '提醒',
  summary: '記憶摘要',
  news: '新聞整理',
  link: '連結閱讀',
  weather: '天氣潤飾',
  lore: '用語解說'
} as const

export type LlmFeature = keyof typeof LLM_FEATURES

/** 供應商回報的數字。`input`／`output` 已含快取與思考的部分。 */
export interface LlmTokens {
  input: number
  output: number
  cached?: number
  reasoning?: number
}

export interface LlmUsageRecord extends Partial<LlmTokens> {
  at: number
  feature: LlmFeature
  provider: string
  model: string
  ok: boolean
  /** 記錄當下的估價（美元）。查無單價或沒有 token 數時省略。 */
  usd?: number
  /** 「測試中」開著時記的 */
  test?: boolean
}

/** 以牌價估算，不計快取折扣。查無單價回 `undefined`。 */
export function estimateUsd(provider: string, model: string, t: LlmTokens): number | undefined {
  if (provider === 'local') return 0
  const p = MODEL_PRICES[model]
  return p ? (t.input * p[0] + t.output * p[1]) / 1_000_000 : undefined
}

export interface UsageTotal {
  calls: number
  failed: number
  input: number
  output: number
  cached: number
  reasoning: number
  usd: number
  /** 估不出價的筆數（沒有 token 數，或模型不在價格表） */
  unpriced: number
}

export function sumUsage(records: LlmUsageRecord[]): UsageTotal {
  const t: UsageTotal = { calls: 0, failed: 0, input: 0, output: 0, cached: 0, reasoning: 0, usd: 0, unpriced: 0 }
  for (const r of records) {
    t.calls++
    if (!r.ok) t.failed++
    t.input += r.input ?? 0
    t.output += r.output ?? 0
    t.cached += r.cached ?? 0
    t.reasoning += r.reasoning ?? 0
    if (r.usd === undefined) t.unpriced++
    else t.usd += r.usd
  }
  return t
}

/** 分組加總，花費高的在前。 */
export function groupUsage(
  records: LlmUsageRecord[],
  keyOf: (r: LlmUsageRecord) => string
): Array<{ key: string; total: UsageTotal }> {
  const groups = new Map<string, LlmUsageRecord[]>()
  for (const r of records) {
    const k = keyOf(r)
    const list = groups.get(k)
    if (list) list.push(r)
    else groups.set(k, [r])
  }
  return [...groups]
    .map(([key, list]) => ({ key, total: sumUsage(list) }))
    .sort((a, b) => b.total.usd - a.total.usd || b.total.calls - a.total.calls)
}
