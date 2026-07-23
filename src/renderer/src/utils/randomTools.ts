import type { OmikujiTier, RandomResult, PendingRandomTool } from '../types'

const OMIKUJI_TIERS: [OmikujiTier, number][] = [
  ['大吉', 12], ['中吉', 18], ['小吉', 20], ['吉', 22], ['末吉', 15], ['凶', 10], ['大凶', 3]
]

function weightedPick<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0)
  let r = Math.random() * total
  for (const [item, w] of items) {
    r -= w
    if (r <= 0) return item
  }
  return items[items.length - 1][0]
}

export function computeRandomResult(pending: PendingRandomTool): RandomResult {
  switch (pending.tool) {
    case 'omikuji':
      return { tool: 'omikuji', result: weightedPick(OMIKUJI_TIERS) }
    case 'jiao': {
      const result = weightedPick<'聖筊' | '笑筊' | '陰筊'>([
        ['聖筊', 40], ['笑筊', 30], ['陰筊', 30]
      ])
      return { tool: 'jiao', result }
    }
    case 'coin': {
      const result: '正面' | '反面' = Math.random() < 0.5 ? '正面' : '反面'
      return { tool: 'coin', result }
    }
    case 'dice': {
      const faces = pending.faces ?? 6
      const count = pending.count ?? 1
      const modifier = pending.modifier ?? 0
      const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * faces) + 1)
      // Keep Highest / Keep Lowest
      let kept: number[]
      if (pending.keepHighest != null && pending.keepHighest < count) {
        kept = [...rolls].sort((a, b) => b - a).slice(0, pending.keepHighest)
      } else if (pending.keepLowest != null && pending.keepLowest < count) {
        kept = [...rolls].sort((a, b) => a - b).slice(0, pending.keepLowest)
      } else {
        kept = rolls
      }
      const rollSum = kept.reduce((s, r) => s + r, 0)
      return { tool: 'dice', faces, count, rolls, kept, keepHighest: pending.keepHighest, keepLowest: pending.keepLowest, modifier, total: rollSum + modifier }
    }
  }
}

export function getToolEmoji(tool: PendingRandomTool['tool']): string {
  switch (tool) {
    case 'omikuji': return '🏮'
    case 'jiao': return '🙏'
    case 'coin': return '🪙'
    case 'dice': return '🎲'
  }
}

export function formatPendingLabel(pending: PendingRandomTool): string {
  switch (pending.tool) {
    case 'omikuji': return '抽籤'
    case 'jiao': return '擲茭'
    case 'coin': return '硬幣'
    case 'dice': return diceNotation(pending)
  }
}

export function diceNotation(pending: PendingRandomTool): string {
  if (pending.tool !== 'dice') return ''
  const count = pending.count ?? 1
  const faces = pending.faces ?? 6
  const mod = pending.modifier ?? 0
  const modStr = mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : ''
  const khStr = pending.keepHighest != null ? `kh${pending.keepHighest}` : ''
  const klStr = pending.keepLowest != null ? `kl${pending.keepLowest}` : ''
  return `${count}d${faces}${khStr}${klStr}${modStr}`
}

function modStr(mod: number): string {
  return mod > 0 ? `+${mod}` : mod < 0 ? String(mod) : ''
}

export function formatResultBadgeText(result: RandomResult): string {
  switch (result.tool) {
    case 'omikuji': return result.result
    case 'jiao': return result.result
    case 'coin': return result.result
    case 'dice': {
      const kept = result.kept ?? result.rolls
      const hasKeep = kept.length < result.count
      const allRolls = result.rolls.join(', ')
      const keptRolls = kept.join('+')
      const mod = modStr(result.modifier)
      if (hasKeep) {
        return `${result.total}（骰：${allRolls}，取：${keptRolls}${mod}）`
      }
      const parts = kept.length > 1 || result.modifier !== 0
        ? `（${kept.join('+')}${mod}）`
        : ''
      return `${result.total}${parts}`
    }
  }
}

export function formatResultForPrompt(result: RandomResult): string {
  switch (result.tool) {
    case 'omikuji': return `抽籤結果：${result.result}`
    case 'jiao': return `擲茭結果：${result.result}`
    case 'coin': return `硬幣結果：${result.result}`
    case 'dice': {
      const kept = result.kept ?? result.rolls
      const hasKeep = kept.length < result.count
      const mod = modStr(result.modifier)
      const khkl = result.keepHighest != null ? `kh${result.keepHighest}`
        : result.keepLowest != null ? `kl${result.keepLowest}`
        : ''
      const notation = `${result.count}d${result.faces}${khkl}${mod}`
      if (hasKeep) {
        return `骰子結果：${notation} = ${result.total}（骰出：${result.rolls.join(', ')}，採計：${kept.join('+')}${mod}）`
      }
      const detail = kept.length > 1 || result.modifier !== 0
        ? `（${kept.join('+')}${mod}=${result.total}）`
        : ''
      return `骰子結果：${notation} = ${result.total}${detail}`
    }
  }
}

// ─── Inline Token System ────────────────────────────────────────────

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
      const kept = result.kept ?? result.rolls
      const hasKeep = kept.length < result.count
      const mod = modStr(result.modifier)
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
