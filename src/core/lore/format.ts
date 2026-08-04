import type { LoreEntry } from './types'

/**
 * Lorebook 注入區塊的字串組裝。
 *
 * ⚠️ 本檔含刻意寫死的 prompt 字串（英文標籤），非 UI 文案 —— roadmap §3.3 例外條款。
 *
 * 標籤採 `[Glossary]` 而非 `[Lore]`（規格 §5.4，已定案）：
 * 「字典」讓模型**被動**查閱（使用者提到才用），「設定」會讓模型**主動**科普，
 * 而需求是「角色聽得懂」而非「角色主動介紹使用者自己的世界觀」。
 */

export const LORE_BLOCK_LABEL = '[Glossary]'

/**
 * 單一條目的注入行：`詞（別名、別名）：解說`。
 *
 * **詞頭是必要的**：本引擎的 UI 把「關鍵字」與「內容」分成兩欄，使用者很自然會把內容
 * 寫成不含主詞的補語（「就是你們身處的那個程式」），只丟 content 進去模型無從得知
 * 這句在解釋哪個詞。ST 是靠使用者自己把詞名寫進 content 才不需要這層。
 *
 * 內容本身已經以該詞開頭時不再加詞頭（ST 匯入的條目多屬此類），避免「DeST：DeST 是⋯⋯」。
 */
function formatLoreLine(entry: LoreEntry): string {
  const content = (entry?.content ?? '').trim()
  if (!content) return ''

  const keys = (entry?.keys ?? []).map(k => (k ?? '').trim()).filter(Boolean)
  if (keys.length === 0) return content

  const [head, ...aliases] = keys
  if (content.startsWith(head)) return content

  const headword = aliases.length > 0 ? `${head}（${aliases.join('、')}）` : head
  return `${headword}：${content}`
}

/**
 * 組出注入用的 `[Glossary]` 區塊。
 *
 * **沒有任何條目時回傳空字串** —— 連空標籤都不出現（規格 §6.1：
 * 沒建立任何一本時 prompt 完全不受影響）。呼叫端據此決定要不要 push 這一段。
 */
export function formatLoreBlock(entries: LoreEntry[]): string {
  const lines = (entries ?? [])
    .map(formatLoreLine)
    .filter(Boolean)
  if (lines.length === 0) return ''
  return `${LORE_BLOCK_LABEL}\n${lines.join('\n')}`
}
