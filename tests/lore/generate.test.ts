import { describe, it, expect } from 'vitest'
import { loreKeysForCharacter, GENERATED_ENTRY_DEFAULTS } from '@core/lore/generate'

/**
 * 角色卡自動生成條目（docs/future-lorebook.md §8）。
 * 這裡只測純函式部分 —— LLM 呼叫本身不進自動測試（見 tests/README.md）。
 */
describe('loreKeysForCharacter', () => {
  it('關鍵字＝名字 ＋ 暱稱', () => {
    expect(loreKeysForCharacter({ name: '小綠', nicknames: ['綠綠', '小綠子'] }))
      .toEqual(['小綠', '綠綠', '小綠子'])
  })

  it('去空白、去重、略過空字串', () => {
    expect(loreKeysForCharacter({ name: ' 小綠 ', nicknames: ['小綠', '', '  ', '綠綠'] }))
      .toEqual(['小綠', '綠綠'])
  })

  it('沒有暱稱時只有名字', () => {
    expect(loreKeysForCharacter({ name: '小綠' })).toEqual(['小綠'])
  })

  it('名字空白時回空陣列（呼叫端據此放棄生成）', () => {
    expect(loreKeysForCharacter({ name: '   ' })).toEqual([])
  })
})

describe('GENERATED_ENTRY_DEFAULTS', () => {
  it('人名靠關鍵字觸發即可，預設不常駐（§8.2）', () => {
    expect(GENERATED_ENTRY_DEFAULTS).toEqual({ constant: false, enabled: true })
  })
})
