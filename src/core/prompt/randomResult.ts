import type { RandomResult } from '../types'

/**
 * 隨機工具（御神籤／擲筊／硬幣／骰子）結果轉成注入 prompt 的字串。
 *
 * ⚠️ 本檔含刻意寫死的中文字串，但那是**送進 LLM prompt 的內容**，不是 UI 文案
 * （roadmap §3.3 之例外，2026-08-02 owner 拍板）。日後若要多語系，只需改本檔。
 */
export function formatRandomResultForPrompt(result: RandomResult): string {
  switch (result.tool) {
    case 'omikuji': return `抽籤結果：${result.result}`
    case 'jiao': return `擲茭結果：${result.result}`
    case 'coin': return `硬幣結果：${result.result}`
    case 'dice': {
      const { faces, count, rolls, kept, keepHighest, keepLowest, modifier, total } = result
      const modStr = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : ''
      const khkl = keepHighest != null ? `kh${keepHighest}` : keepLowest != null ? `kl${keepLowest}` : ''
      const notation = `${count}d${faces}${khkl}${modStr}`

      const hasKeep = kept.length < count
      if (hasKeep) {
        // e.g. 4d6kh3＋2 = 15（骰出：5,4,6,3，採計：5+4+6+2，修正已計入）
        const keptStr = kept.join('+')
        const modPart = modifier !== 0 ? `${modStr}=${total}，修正已計入` : `=${total}`
        return `骰子結果：${notation} = ${total}（骰出：${rolls.join(', ')}，採計：${keptStr}${modPart}）`
      }

      if (count === 1) {
        if (modifier === 0) {
          // 最簡單情況：1d20 = 9
          return `骰子結果：${notation} = ${total}`
        }
        // 單顆骰有修正值：最容易被 LLM 重複加的情況，明確說明
        // e.g. 骰子結果：1d20+3 = 12（骰面 9，修正 +3 已計入）
        return `骰子結果：${notation} = ${total}（骰面 ${rolls[0]}，修正 ${modStr} 已計入，最終結果 ${total}）`
      }

      // 多顆骰，有或無修正值
      // e.g. 2d6+3 = 12（4+5+3，修正已計入）
      const parts: string[] = kept.map(String)
      if (modifier !== 0) parts.push(modStr)
      return `骰子結果：${notation} = ${total}（${parts.join('')}，修正已計入）`
    }
  }
}
