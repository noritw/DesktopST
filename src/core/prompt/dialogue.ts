import type { Character } from '../types'
import { characterAliases } from '../character'
import { escapeRegExp } from '../util/text'
import { parseEmotion, buildEmotionIdList } from './promptUtils'

export function maybeUnwrapSingleDialogueQuote(text: string): string {
  const s = String(text ?? '').trim()
  const pairs: Array<[string, string]> = [['「', '」'], ['『', '』'], ['"', '"']]
  for (const [left, right] of pairs) {
    if (!s.startsWith(left) || !s.endsWith(right)) continue
    const inner = s.slice(left.length, s.length - right.length).trim()
    if (!inner) return ''
    // Keep quotes when text is intentionally quoting something inside.
    if (inner.includes(left) || inner.includes(right)) return s
    return inner
  }
  return s
}

export function stripSpeakerPrefixFromLine(line: string, aliases: string[]): string {
  let text = String(line ?? '').trim()
  if (!text) return ''
  const sorted = aliases.filter(Boolean).sort((a, b) => b.length - a.length)
  for (const alias of sorted) {
    const escaped = escapeRegExp(alias)
    const pattern = new RegExp(`^(?:[【\\[]\\s*)?${escaped}(?:\\s*[】\\]]\\s*)?\\s*[：:]\\s*`)
    if (pattern.test(text)) {
      text = text.replace(pattern, '').trim()
      break
    }
  }
  return maybeUnwrapSingleDialogueQuote(text)
}

export function normalizeCharacterDialogue(raw: string, char: Character): string {
  const text = parseEmotion(String(raw ?? ''), buildEmotionIdList(char)).content.trim()
  if (!text) return ''
  const aliases = characterAliases(char)
  const normalizedLines = text
    .split(/\r?\n/)
    .map(line => stripSpeakerPrefixFromLine(line, aliases))
  return maybeUnwrapSingleDialogueQuote(normalizedLines.join('\n').trim())
}
