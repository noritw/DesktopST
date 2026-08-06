/**
 * 新聞進 Prompt 的上下文補強——純規則（夠用判定、長度門檻、退回字串）。
 * I/O（抓原文／輔助模型）留平台層 `main/modules/news/enrich.ts`。
 */

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
