import { describe, it, expect } from 'vitest'
import {
  importStLorebook, exportStLorebook, extractCharacterBook
} from '@core/lore/stLorebook'
import { LoreError, DEFAULT_SCAN_DEPTH, DEFAULT_TOKEN_BUDGET } from '@core/lore/types'

/**
 * ST `character_book` 對映（規格 §5.2）。
 *
 * 重點在**未實作欄位不能掉** —— ST → DeST → ST 來回要一字不差，
 * 否則使用者把卡片匯入再匯出就把別人的世界觀刪掉了。
 *
 * ⚠️ `now` 一律注入，不依賴當下時間。
 */

const T0 = 1_700_000_000_000

const stBook = {
  name: '測試書',
  description: '書層級未實作欄位',
  scan_depth: 3,
  token_budget: 512,
  recursive_scanning: false,
  extensions: { foo: 1 },
  entries: [
    {
      id: 0,
      keys: ['DeST', 'DesktopST'],
      secondary_keys: [],
      comment: '專案名',
      content: 'DeST 是使用者開發的桌面程式。',
      constant: true,
      selective: false,
      insertion_order: 10,
      enabled: true,
      position: 'before_char',
      case_sensitive: false,
      priority: 100,
      extensions: { depth: 4 },
      use_regex: false
    },
    {
      id: 1,
      keys: ['小明'],
      content: '小明是使用者的同事。',
      enabled: false,
      insertion_order: 20
    }
  ]
}

describe('importStLorebook', () => {
  it('基本欄位對映', () => {
    const book = importStLorebook(stBook, { id: 'lb1', now: T0 })
    expect(book.id).toBe('lb1')
    expect(book.name).toBe('測試書')
    expect(book.scan_depth).toBe(3)
    expect(book.token_budget).toBe(512)
    expect(book.createdAt).toBe(T0)
    expect(book.updatedAt).toBe(T0)
    expect(book.entries).toHaveLength(2)
    expect(book.entries[0].keys).toEqual(['DeST', 'DesktopST'])
    expect(book.entries[0].constant).toBe(true)
    expect(book.entries[1].enabled).toBe(false)
  })

  it('缺 scan_depth／token_budget → 用預設值', () => {
    const book = importStLorebook({ entries: [] }, { id: 'x', now: T0 })
    expect(book.scan_depth).toBe(DEFAULT_SCAN_DEPTH)
    expect(book.token_budget).toBe(DEFAULT_TOKEN_BUDGET)
  })

  it('沒寫 enabled 視為啟用（ST 慣例）', () => {
    const book = importStLorebook({ entries: [{ keys: ['a'], content: 'A' }] }, { id: 'x', now: T0 })
    expect(book.entries[0].enabled).toBe(true)
  })

  it('沒有 insertion_order → 用索引，順序不會全部擠在 0', () => {
    const book = importStLorebook(
      { entries: [{ content: 'A' }, { content: 'B' }, { content: 'C' }] },
      { id: 'x', now: T0 }
    )
    expect(book.entries.map(e => e.insertion_order)).toEqual([0, 1, 2])
  })

  it('沒有 name → 用 fallbackName（core 不寫死中文文案）', () => {
    const book = importStLorebook({ entries: [] }, { id: 'x', now: T0, fallbackName: '小美' })
    expect(book.name).toBe('小美')
  })

  it('未實作欄位收進 _passthrough，已知欄位不重複收', () => {
    const book = importStLorebook(stBook, { id: 'lb1', now: T0 })
    expect(book._passthrough).toEqual({
      description: '書層級未實作欄位',
      recursive_scanning: false,
      extensions: { foo: 1 }
    })
    expect(book.entries[0]._passthrough).toEqual({
      position: 'before_char',
      extensions: { depth: 4 },
      use_regex: false
    })
  })

  it('沒有多餘欄位時 _passthrough 是 undefined，不留空物件', () => {
    const book = importStLorebook({ entries: [{ keys: ['a'], content: 'A' }] }, { id: 'x', now: T0 })
    expect(book._passthrough).toBeUndefined()
    expect(book.entries[0]._passthrough).toBeUndefined()
  })

  it('沒有 entries 陣列 → 拋錯誤代碼（不是中文訊息）', () => {
    expect(() => importStLorebook({ name: '空的' }, { id: 'x', now: T0 })).toThrow(LoreError)
    try {
      importStLorebook(null, { id: 'x', now: T0 })
    } catch (err) {
      expect((err as LoreError).code).toBe('not-a-lorebook')
    }
  })

  it('makeEntryId 可注入（core 不生亂數）', () => {
    const book = importStLorebook(
      { entries: [{ content: 'A' }, { content: 'B' }] },
      { id: 'x', now: T0, makeEntryId: i => `entry-${i}` }
    )
    expect(book.entries.map(e => e.id)).toEqual(['entry-0', 'entry-1'])
  })
})

describe('exportStLorebook —— 往返', () => {
  it('ST → DeST → ST：未實作欄位一個不掉', () => {
    const book = importStLorebook(stBook, { id: 'lb1', now: T0 })
    const out = exportStLorebook(book)
    // `enabled` / `constant` 有明確預設值，匯出一律寫明（來源省略時補 false），
    // 其餘欄位含未實作的那些都必須原樣吐回。
    expect(out).toEqual({
      ...stBook,
      entries: [stBook.entries[0], { ...stBook.entries[1], constant: false }]
    })
  })

  it('未設的可選欄位不會憑空冒出來', () => {
    const book = importStLorebook({ entries: [{ keys: ['a'], content: 'A' }] }, { id: 'x', now: T0 })
    const out = exportStLorebook(book) as { entries: Record<string, unknown>[] }
    expect(Object.keys(out.entries[0]).sort()).toEqual(
      ['constant', 'content', 'enabled', 'id', 'insertion_order', 'keys']
    )
  })

  it('DeST 這邊改過的已知欄位覆蓋 _passthrough，不被舊值蓋回去', () => {
    const book = importStLorebook(stBook, { id: 'lb1', now: T0 })
    book.name = '改過的名字'
    book.entries[0].content = '改過的內容'
    const out = exportStLorebook(book) as { name: string; entries: { content: string }[] }
    expect(out.name).toBe('改過的名字')
    expect(out.entries[0].content).toBe('改過的內容')
  })

  it('非數字的條目 id 原樣吐字串', () => {
    const book = importStLorebook({ entries: [{ content: 'A' }] }, { id: 'x', now: T0, makeEntryId: () => 'abc' })
    const out = exportStLorebook(book) as { entries: { id: unknown }[] }
    expect(out.entries[0].id).toBe('abc')
  })
})

describe('extractCharacterBook', () => {
  it('從 chara_card_v2 的 data 底下撈出來', () => {
    const card = { spec: 'chara_card_v2', data: { name: '小美', character_book: stBook } }
    expect(extractCharacterBook(card)).toEqual(stBook)
  })

  it('平鋪在根層也吃', () => {
    expect(extractCharacterBook({ name: '小美', character_book: stBook })).toEqual(stBook)
  })

  it('沒有就回 null，不拋錯（匯入流程不該被擋）', () => {
    expect(extractCharacterBook({ data: { name: '小美' } })).toBeNull()
    expect(extractCharacterBook(null)).toBeNull()
    expect(extractCharacterBook('不是物件')).toBeNull()
  })
})
