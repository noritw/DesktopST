import type { RandomResult, PendingRandomTool } from '../types'
import { computeRandomResult, modifierString, keptRolls } from '../random/dice'

/**
 * 輸入框內嵌 token 系統：`[🎲2d6+3]` 這種寫法的產生、辨識與展開。
 *
 * ⚠️ 本檔含刻意寫死的中文字串，但那**不是 UI 文案** —— token 與展開後的
 * `｛🎲骰子2d6+3結果：12｝` 都會成為**訊息內容本身**，隨對話存檔並送進 LLM。
 * 依 roadmap §3.3 的例外條款，這類字串留在 `core/prompt/` 底下。
 * 兩端若各寫一份，同一句話在桌面與手機會長得不一樣 —— 正是抽 core 要防的事。
 */

/**
 * Token format in textarea (with emoji prefix for visual distinction):
 *   [🏮抽籤] [🙏擲茭] [🪙硬幣] [🎲1d6] [🎲2d6+3] [🎲4d6kh3] [🎲2d20kl1]
 *
 * Also supports legacy tokens without emoji for backward compat:
 *   [抽籤] [擲茭] [硬幣] [1d6] [2d6+3] etc.
 *
 * We use the 'u' flag to correctly handle multi-byte emoji characters.
 * Returns a fresh RegExp instance each time to avoid lastIndex issues with the 'g' flag.
 */
function tokenRegex(): RegExp {
  return /\[(?:\u{1F3EE}抽籤|\u{1F64F}擲茭|\u{1FA99}硬幣|\u{1F3B2}\d+d\d+(?:kh\d+|kl\d+)?(?:[+-]\d+)?|抽籤|擲茭|硬幣|\d+d\d+(?:kh\d+|kl\d+)?(?:[+-]\d+)?)\]/gu
}

/**
 * Generate the token string to insert at cursor for the given tool selection.
 * Includes emoji prefix for visual distinction: [🏮抽籤] [🙏擲茭] [🪙硬幣] [🎲1d6+2]
 */
export function makeTokenString(pending: PendingRandomTool): string {
  switch (pending.tool) {
    case 'omikuji': return '[🏮抽籤]'
    case 'jiao': return '[🙏擲茭]'
    case 'coin': return '[🪙硬幣]'
    case 'dice': {
      const count = pending.count ?? 1
      const faces = pending.faces ?? 6
      const mod = pending.modifier ?? 0
      const modS = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : ''
      const khStr = pending.keepHighest != null ? `kh${pending.keepHighest}` : ''
      const klStr = pending.keepLowest != null ? `kl${pending.keepLowest}` : ''
      return `[🎲${count}d${faces}${khStr}${klStr}${modS}]`
    }
  }
}

/**
 * Parse a token string into a PendingRandomTool.
 */
function parseToken(token: string): PendingRandomTool | null {
  const inner = token.slice(1, -1) // remove [ ]
  // Strip emoji prefix if present (🏮 🙏 🪙 🎲)
  const stripped = inner.replace(/^[\u{1F3EE}\u{1F64F}\u{1FA99}\u{1F3B2}]/u, '')
  if (stripped === '抽籤') return { tool: 'omikuji' }
  if (stripped === '擲茭') return { tool: 'jiao' }
  if (stripped === '硬幣') return { tool: 'coin' }
  // Dice: e.g. 2d6+3, 4d6kh3, 2d20kl1-2
  const m = stripped.match(/^(\d+)d(\d+)(?:(kh|kl)(\d+))?([+-]\d+)?$/)
  if (!m) return null
  const count = parseInt(m[1], 10)
  const faces = parseInt(m[2], 10)
  const keepType = m[3] as 'kh' | 'kl' | undefined
  const keepN = m[4] ? parseInt(m[4], 10) : undefined
  const modifier = m[5] ? parseInt(m[5], 10) : 0
  const result: PendingRandomTool = { tool: 'dice', faces, count, modifier: modifier || undefined }
  if (keepType === 'kh' && keepN != null) result.keepHighest = keepN
  if (keepType === 'kl' && keepN != null) result.keepLowest = keepN
  return result
}

/**
 * Check if the text contains any random tokens.
 */
export function hasRandomTokens(text: string): boolean {
  return tokenRegex().test(text)
}

/**
 * Format a single result for inline display (replacing the token in the final text).
 * Includes emoji for visual distinction.
 */
function formatResultInline(result: RandomResult): string {
  switch (result.tool) {
    case 'omikuji': return `｛🏮抽籤結果：${result.result}｝`
    case 'jiao': return `｛🙏擲茭結果：${result.result}｝`
    case 'coin': return `｛🪙硬幣結果：${result.result}｝`
    case 'dice': {
      const kept = keptRolls(result)
      const hasKeep = kept.length < result.count
      const mod = modifierString(result.modifier)
      const khkl = result.keepHighest != null ? `kh${result.keepHighest}`
        : result.keepLowest != null ? `kl${result.keepLowest}`
        : ''
      const notation = `${result.count}d${result.faces}${khkl}${mod}`
      if (hasKeep) {
        return `｛🎲骰子${notation}結果：${result.total}（骰出：${result.rolls.join(', ')}，採計：${kept.join('+')}${mod}）｝`
      }
      if (result.count === 1 && result.modifier === 0) {
        return `｛🎲骰子${notation}結果：${result.total}｝`
      }
      const detail = `（${kept.join('+')}${mod}=${result.total}）`
      return `｛🎲骰子${notation}結果：${result.total}${detail}｝`
    }
  }
}

export interface ExpandedRandomResult {
  /** The text with all tokens replaced by their results */
  expandedText: string
  /** All random results in order */
  results: RandomResult[]
}

/**
 * Parse all random tokens in the text, compute results, and replace tokens with formatted results.
 * Returns the expanded text and all results.
 */
export function expandRandomTokens(text: string): ExpandedRandomResult {
  const results: RandomResult[] = []
  const expandedText = text.replace(tokenRegex(), (match) => {
    const pending = parseToken(match)
    if (!pending) return match // shouldn't happen, but just in case
    const result = computeRandomResult(pending)
    results.push(result)
    return formatResultInline(result)
  })
  return { expandedText, results }
}
