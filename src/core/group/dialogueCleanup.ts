import type { Character } from '../types'
import { characterAliases } from '../character'
import { escapeRegExp } from '../util/text'

/**
 * 剝掉回覆中「其他角色：…」的整行（LLM 有時會替別人代言）。
 *
 * @param characters 全部角色（原本直接讀模組層變數，抽 core 後改為參數傳入）
 */
export function stripOtherCharacterSpeakerLines(
  text: string,
  selfCharId: string,
  characters: Character[]
): string {
  const otherAliases = characters
    .filter(c => c.id !== selfCharId)
    .flatMap(c => characterAliases(c))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (otherAliases.length === 0) return String(text ?? '').trim()

  const isOtherSpeakerPrefixed = (line: string): boolean => {
    const t = String(line ?? '').trim()
    if (!t) return false
    for (const alias of otherAliases) {
      const escaped = escapeRegExp(alias)
      const pattern = new RegExp(`^(?:[【\\[]\\s*)?${escaped}(?:\\s*[】\\]]\\s*)?\\s*[：:]\\s*`)
      if (pattern.test(t)) return true
    }
    return false
  }

  return String(text ?? '')
    .split(/\r?\n/)
    .filter(line => !isOtherSpeakerPrefixed(line))
    .join('\n')
    .trim()
}
