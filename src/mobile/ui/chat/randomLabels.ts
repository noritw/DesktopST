import type { PendingRandomTool, RandomResult } from '@core/types'
import { keptRolls, modifierString } from '@core/random/dice'

/**
 * 隨機工具的**手機 UI 文案**（清單 C5 的徽章）。
 *
 * 算式本身（`keptRolls` / `modifierString` / `diceNotation`）全部來自 core，
 * 這裡只負責措辭與 emoji —— 依 roadmap §3.3，介面語言不得進 core。
 *
 * ⚠️ **已知的小重複**：`src/renderer/src/utils/randomTools.ts` 有內容相同的三支。
 * 兩份都是「UI 文案」，依規則都不能進 core，而目前沒有一個
 * 「兩個 UI 共用」的層可以放。**重複的只有措辭（`骰：`／`取：`與四顆 emoji），
 * 算式沒有重複** —— 這是刻意把重複面積縮到最小的結果，不是漏看。
 * 若日後要根治，做法是開一個明確的共用 UI 文案層，
 * 而不是把中文搬進 core（那會直接違反 §3.3）。
 * 相關背景見 `docs/mobile-html-feature-inventory.md` §4。
 */

export function getToolEmoji(tool: PendingRandomTool['tool']): string {
  switch (tool) {
    case 'omikuji': return '🏮'
    case 'jiao': return '🙏'
    case 'coin': return '🪙'
    case 'dice': return '🎲'
  }
}

/** 結果徽章的內文，含 kh/kl 取捨的完整算式（清單 C5）。 */
export function formatResultBadgeText(result: RandomResult): string {
  switch (result.tool) {
    case 'omikuji':
    case 'jiao':
    case 'coin':
      return result.result
    case 'dice': {
      const kept = keptRolls(result)
      const mod = modifierString(result.modifier)
      // 有取捨時要把「骰出什麼」也秀出來 —— 4d6kh3 只看總分等於看不到過程。
      if (kept.length < result.count) {
        return `${result.total}（骰：${result.rolls.join(', ')}，取：${kept.join('+')}${mod}）`
      }
      // 單顆無修正值時不加括號，不然 `[🎲1d20]` 會變成「13（13）」。
      const detail = kept.length > 1 || result.modifier !== 0 ? `（${kept.join('+')}${mod}）` : ''
      return `${result.total}${detail}`
    }
  }
}

/** 一行完整的徽章：emoji ＋ 內文。 */
export function formatRandomBadge(result: RandomResult): string {
  return `${getToolEmoji(result.tool)} ${formatResultBadgeText(result)}`
}
