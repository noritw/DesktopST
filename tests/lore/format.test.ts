import { describe, it, expect } from 'vitest'
import { formatLoreBlock, LORE_BLOCK_LABEL } from '@core/lore/format'
import type { LoreEntry } from '@core/lore/types'

/** 注入區塊字串（規格 §5.4／§6.1）。標籤變動會直接改變模型行為，所以釘死。 */

const e = (content: string): LoreEntry => ({
  id: content, keys: [], content, enabled: true, constant: true, insertion_order: 0
})

describe('formatLoreBlock', () => {
  it('標籤是 [Glossary]，不是 [Lore]', () => {
    expect(LORE_BLOCK_LABEL).toBe('[Glossary]')
  })

  it('條目逐行接在標籤下', () => {
    expect(formatLoreBlock([e('甲是 A'), e('乙是 B')])).toBe('[Glossary]\n甲是 A\n乙是 B')
  })

  it('沒有條目 → 空字串，連空標籤都不出現（§6.1 新手不受影響）', () => {
    expect(formatLoreBlock([])).toBe('')
  })

  it('條目內容全是空白 → 同樣不出現標籤', () => {
    expect(formatLoreBlock([e('   '), e('')])).toBe('')
  })

  it('個別空白條目略過，其餘照出', () => {
    expect(formatLoreBlock([e(''), e(' 有內容 ')])).toBe('[Glossary]\n有內容')
  })
})

/**
 * 詞頭。UI 把「關鍵字」與「內容」分兩欄，使用者的內容常是不含主詞的補語，
 * 只丟 content 進 prompt 模型無從得知這句在解釋哪個詞。
 */
describe('formatLoreBlock —— 詞頭', () => {
  const withKeys = (keys: string[], content: string): LoreEntry => ({
    id: content, keys, content, enabled: true, constant: true, insertion_order: 0
  })

  it('單一關鍵字 → 「詞：解說」', () => {
    expect(formatLoreBlock([withKeys(['DeST'], '就是你們身處的那個程式。')]))
      .toBe('[Glossary]\nDeST：就是你們身處的那個程式。')
  })

  it('多個關鍵字 → 第一個當詞頭，其餘列為別名', () => {
    expect(formatLoreBlock([withKeys(['DeST', 'DesktopST', '桌友'], '一個桌面程式。')]))
      .toBe('[Glossary]\nDeST（DesktopST、桌友）：一個桌面程式。')
  })

  it('內容已以該詞開頭時不重複加詞頭（ST 匯入的條目多屬此類）', () => {
    expect(formatLoreBlock([withKeys(['DeST', '桌友'], 'DeST 是一個桌面程式。')]))
      .toBe('[Glossary]\nDeST 是一個桌面程式。')
  })

  it('沒有關鍵字（純常駐條目）→ 原樣輸出，不硬加詞頭', () => {
    expect(formatLoreBlock([withKeys([], '這個世界沒有魔法。')]))
      .toBe('[Glossary]\n這個世界沒有魔法。')
  })

  it('關鍵字全是空白 → 視同沒有關鍵字', () => {
    expect(formatLoreBlock([withKeys(['  ', ''], '內容。')]))
      .toBe('[Glossary]\n內容。')
  })
})
