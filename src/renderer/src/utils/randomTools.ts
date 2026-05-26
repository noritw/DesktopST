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
