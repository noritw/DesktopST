import { describe, it, expect } from 'vitest'
import {
  buildScanText, matchesEntry, selectLoreEntries, resolveScanDepth, entryCost
} from '@core/lore/scan'
import type { Lorebook, LoreEntry } from '@core/lore/types'
import { DEFAULT_SCAN_DEPTH, DEFAULT_TOKEN_BUDGET } from '@core/lore/types'

/**
 * Lorebook 掃描與裁切（B2.5）。
 *
 * 這裡的錯不會有錯誤訊息，只會變成「角色突然聽不懂術語」或「prompt 悄悄變胖」，
 * 所以觸發判定、排序、裁切三件事都要釘死。
 *
 * ⚠️ 全部是純函式，不依賴當下時間與亂數。
 */

function entry(over: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id: over.id ?? 'e1',
    keys: over.keys ?? ['DeST'],
    content: over.content ?? 'DeST 是使用者的桌面程式。',
    enabled: over.enabled ?? true,
    constant: over.constant ?? false,
    insertion_order: over.insertion_order ?? 0,
    ...over
  }
}

function book(entries: LoreEntry[], over: Partial<Lorebook> = {}): Lorebook {
  return {
    id: over.id ?? 'b1',
    name: over.name ?? 'book',
    entries,
    scan_depth: over.scan_depth ?? DEFAULT_SCAN_DEPTH,
    token_budget: over.token_budget ?? DEFAULT_TOKEN_BUDGET,
    createdAt: 0,
    updatedAt: 0,
    ...over
  }
}

describe('buildScanText', () => {
  it('摘要 + 近期訊息後 N 則 + 當前輸入', () => {
    const text = buildScanText({
      summary: '摘要',
      recentContents: ['a', 'b', 'c', 'd'],
      currentInput: '現在這句'
    }, 2)
    expect(text).toBe('摘要\nc\nd\n現在這句')
  })

  it('scan_depth 大於訊息數 → 全取，不補空行', () => {
    expect(buildScanText({ recentContents: ['a', 'b'] }, 10)).toBe('a\nb')
  })

  it('空白片段一律略過', () => {
    expect(buildScanText({ summary: '   ', recentContents: ['', ' x '], currentInput: '' }, 5)).toBe('x')
  })

  it('scanDepth 非法（0／負數／NaN）→ 退回預設值', () => {
    const parts = { recentContents: ['1', '2', '3', '4', '5', '6', '7'] }
    expect(buildScanText(parts, 0)).toBe('3\n4\n5\n6\n7')
    expect(buildScanText(parts, -1)).toBe('3\n4\n5\n6\n7')
    expect(buildScanText(parts, Number.NaN)).toBe('3\n4\n5\n6\n7')
  })
})

describe('matchesEntry', () => {
  it('關鍵字命中即觸發（子字串比對）', () => {
    expect(matchesEntry(entry({ keys: ['DeST'] }), '昨天 DeST 又壞了')).toBe(true)
    expect(matchesEntry(entry({ keys: ['DeST'] }), '今天天氣很好')).toBe(false)
  })

  it('多個叫法任一命中即可（§1.1 的核心用法）', () => {
    const e = entry({ keys: ['DeST', 'DesktopST', '桌友'] })
    expect(matchesEntry(e, '我的桌友怎麼不見了')).toBe(true)
  })

  it('預設不分大小寫；case_sensitive 開了才分', () => {
    expect(matchesEntry(entry({ keys: ['dest'] }), 'DeST 很好')).toBe(true)
    expect(matchesEntry(entry({ keys: ['dest'], case_sensitive: true }), 'DeST 很好')).toBe(false)
    expect(matchesEntry(entry({ keys: ['DeST'], case_sensitive: true }), 'DeST 很好')).toBe(true)
  })

  it('constant 一律觸發，不看關鍵字', () => {
    expect(matchesEntry(entry({ constant: true, keys: ['完全沒提到'] }), '無關的話')).toBe(true)
  })

  it('enabled: false 一律不觸發，constant 也救不回來', () => {
    expect(matchesEntry(entry({ enabled: false, constant: true }), '任何字')).toBe(false)
  })

  it('selective + secondary_keys 是 AND 條件', () => {
    const e = entry({ keys: ['蘋果'], selective: true, secondary_keys: ['水果', '吃'] })
    expect(matchesEntry(e, '我想吃蘋果')).toBe(true)
    expect(matchesEntry(e, '蘋果發表新手機')).toBe(false)
  })

  it('secondary_keys 有值但沒開 selective → 忽略，只看 keys', () => {
    const e = entry({ keys: ['蘋果'], secondary_keys: ['水果'] })
    expect(matchesEntry(e, '蘋果發表新手機')).toBe(true)
  })

  it('空字串關鍵字不會命中所有東西', () => {
    expect(matchesEntry(entry({ keys: ['', '   '] }), '隨便什麼')).toBe(false)
  })
})

describe('selectLoreEntries —— 順序', () => {
  it('依 insertion_order 由小到大', () => {
    const b = book([
      entry({ id: 'c', constant: true, insertion_order: 30 }),
      entry({ id: 'a', constant: true, insertion_order: 10 }),
      entry({ id: 'b', constant: true, insertion_order: 20 })
    ])
    expect(selectLoreEntries([b], '').map(e => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('insertion_order 相同 → 維持原始順序（穩定）', () => {
    const b = book([
      entry({ id: 'x', constant: true, insertion_order: 5 }),
      entry({ id: 'y', constant: true, insertion_order: 5 })
    ])
    expect(selectLoreEntries([b], '').map(e => e.id)).toEqual(['x', 'y'])
  })

  it('書的傳入順序優先於 insertion_order（角色卡排在世界觀之前）', () => {
    const charBook = book([entry({ id: 'char', constant: true, insertion_order: 999 })], { id: 'char-book' })
    const worldBook = book([entry({ id: 'world', constant: true, insertion_order: 1 })], { id: 'world-book' })
    expect(selectLoreEntries([charBook, worldBook], '').map(e => e.id)).toEqual(['char', 'world'])
  })

  it('沒有任何命中 → 空陣列', () => {
    expect(selectLoreEntries([book([entry({ keys: ['沒提到'] })])], '無關的話')).toEqual([])
  })
})

describe('selectLoreEntries —— 預算裁切', () => {
  const long = (id: string, len: number, over: Partial<LoreEntry> = {}) =>
    entry({ id, constant: true, content: 'x'.repeat(len), ...over })

  it('沒超過預算 → 全留', () => {
    const b = book([long('a', 50), long('b', 50)], { token_budget: 200 })
    expect(selectLoreEntries([b], '').map(e => e.id)).toEqual(['a', 'b'])
  })

  it('超過預算 → 先砍低 priority', () => {
    const b = book([
      long('keep', 50, { insertion_order: 1, priority: 200 }),
      long('drop', 50, { insertion_order: 2, priority: 10 })
    ], { token_budget: 60 })
    expect(selectLoreEntries([b], '').map(e => e.id)).toEqual(['keep'])
  })

  it('priority 相同 → 砍排在後面的', () => {
    const b = book([
      long('first', 50, { insertion_order: 1 }),
      long('second', 50, { insertion_order: 2 })
    ], { token_budget: 60 })
    expect(selectLoreEntries([b], '').map(e => e.id)).toEqual(['first'])
  })

  it('砍到剛好放得下就停，不會多砍', () => {
    const b = book([long('a', 40), long('b', 40), long('c', 40)], { token_budget: 90 })
    expect(selectLoreEntries([b], '').map(e => e.id)).toEqual(['a', 'b'])
  })

  it('留下的仍照原排序，不會變成被砍順序', () => {
    const b = book([
      long('a', 40, { insertion_order: 1, priority: 50 }),
      long('b', 40, { insertion_order: 2, priority: 300 }),
      long('c', 40, { insertion_order: 3, priority: 200 })
    ], { token_budget: 90 })
    expect(selectLoreEntries([b], '').map(e => e.id)).toEqual(['b', 'c'])
  })

  it('opts.budgetChars 覆蓋書上的設定', () => {
    const b = book([long('a', 40), long('b', 40)], { token_budget: 9999 })
    expect(selectLoreEntries([b], '', { budgetChars: 50 }).map(e => e.id)).toEqual(['a'])
  })

  it('多本書 → 取最大的 token_budget，小上限不連坐', () => {
    const small = book([long('a', 40)], { id: 's', token_budget: 10 })
    const big = book([long('b', 40)], { id: 'g', token_budget: 500 })
    expect(selectLoreEntries([small, big], '').map(e => e.id)).toEqual(['a', 'b'])
  })

  it('預算為 0 → 全砍', () => {
    const b = book([long('a', 10)], { token_budget: 0 })
    expect(selectLoreEntries([b], '')).toEqual([])
  })

  it('entryCost 算的是 trim 後的字元數', () => {
    expect(entryCost(entry({ content: '  abc  ' }))).toBe(3)
  })
})

describe('resolveScanDepth', () => {
  it('取各本最大的 scan_depth', () => {
    expect(resolveScanDepth([book([], { scan_depth: 3 }), book([], { scan_depth: 8 })])).toBe(8)
  })

  it('沒有有效值 → 預設', () => {
    expect(resolveScanDepth([])).toBe(DEFAULT_SCAN_DEPTH)
  })
})
