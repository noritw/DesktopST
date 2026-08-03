import type { RandomResult, PendingRandomTool } from '../types'
import { modifierString, keptRolls, diceNotation } from '@core/random/dice'

/**
 * 隨機工具的**桌面 UI 文案**。
 *
 * 擲出邏輯與內嵌 token 系統已搬進 core（2026-08-04）：
 *   · `@core/random/dice`         —— computeRandomResult / diceNotation
 *   · `@core/prompt/randomTokens` —— makeTokenString / hasRandomTokens / expandRandomTokens
 *
 * 本檔以下三支是**畫面上的措辭**（emoji、按鈕標籤、徽章），依 roadmap §3.3
 * 不得進 core，故留在 renderer。
 *
 * 為了不動既有 import 路徑，core 的項目在此原路轉出；
 * **新增程式碼請直接 import `@core/...`，不要再走這個轉出檔。**
 */

export { computeRandomResult } from '@core/random/dice'
export { diceNotation }
export { makeTokenString, hasRandomTokens, expandRandomTokens } from '@core/prompt/randomTokens'
export type { ExpandedRandomResult } from '@core/prompt/randomTokens'

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

export function formatResultBadgeText(result: RandomResult): string {
  switch (result.tool) {
    case 'omikuji': return result.result
    case 'jiao': return result.result
    case 'coin': return result.result
    case 'dice': {
      const kept = keptRolls(result)
      const hasKeep = kept.length < result.count
      const allRolls = result.rolls.join(', ')
      const keptRollsStr = kept.join('+')
      const mod = modifierString(result.modifier)
      if (hasKeep) {
        return `${result.total}（骰：${allRolls}，取：${keptRollsStr}${mod}）`
      }
      const parts = kept.length > 1 || result.modifier !== 0
        ? `（${kept.join('+')}${mod}）`
        : ''
      return `${result.total}${parts}`
    }
  }
}
