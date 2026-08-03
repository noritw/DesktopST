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
