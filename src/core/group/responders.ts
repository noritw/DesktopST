import type { Character } from '../types'
import { characterAliases } from '../character'
import { normalizeText } from '../util/text'

/** 訊息內容是否點名到該角色（@暱稱 或直接提及）。 */
export function isAddressed(content: string, char: Character): boolean {
  const text = normalizeText(content)
  for (const a of characterAliases(char)) {
    const aa = normalizeText(a)
    if (!aa) continue
    if (text.includes(`@${aa}`) || text.includes(aa)) return true
  }
  return false
}

/**
 * 將回應者排序：有 newsKeywords 且與訊息內容有交叉的角色排在前面（內部再 shuffle），
 * 其餘角色 shuffle 後接在後面。無交叉或角色無關鍵字時等同純 shuffleIds。
 *
 * @param getCharacter 角色查詢函式（原本直接呼叫模組層的 getCharacter，抽 core 後改為參數傳入）
 */
export function sortRespondersByKeywordMatch(
  ids: string[],
  message: string,
  getCharacter: (id: string) => Character | undefined
): string[] {
  if (ids.length <= 1) return [...ids]
  const msgLower = message.toLowerCase()
  const matched: string[] = []
  const rest: string[] = []
  for (const id of shuffleIds(ids)) {
    const char = getCharacter(id)
    const kws = (char?.newsKeywords ?? []).map(k => k.trim().toLowerCase()).filter(Boolean)
    if (kws.length > 0 && kws.some(k => msgLower.includes(k))) {
      matched.push(id)
    } else {
      rest.push(id)
    }
  }
  return [...matched, ...rest]
}

export function shuffleIds(ids: string[]): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function pickPrimaryResponderId(respondingIds: string[], mentionedIds: string[]): string | null {
  if (respondingIds.length === 0) return null
  if (mentionedIds.length > 0) return respondingIds[0]
  return respondingIds[0]
}
