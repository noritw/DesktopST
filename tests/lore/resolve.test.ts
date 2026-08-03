import { describe, it, expect } from 'vitest'
import { resolveLorebookIds, orderLorebooks } from '@core/lore/resolve'
import type { Lorebook } from '@core/lore/types'

/**
 * 「這一輪用哪幾本」（規格 §4.2／§6.4）。
 *
 * 疊加（角色卡＋世界觀）與取代（情境）是兩種語意，混淆會讓 TRPG 情境把日常術語也帶進去。
 */

const mk = (id: string): Lorebook => ({
  id, name: id, entries: [], scan_depth: 5, token_budget: 2000, createdAt: 0, updatedAt: 0
})

describe('resolveLorebookIds', () => {
  it('角色卡在前、世界觀在後（疊加）', () => {
    expect(resolveLorebookIds({ characterIds: ['c1'], worldIds: ['w1'] })).toEqual(['c1', 'w1'])
  })

  it('去重且保留第一次出現的位置', () => {
    expect(resolveLorebookIds({ characterIds: ['a', 'b'], worldIds: ['a', 'c'] })).toEqual(['a', 'b', 'c'])
  })

  it('情境有值 → 取代掉角色卡與世界觀', () => {
    expect(resolveLorebookIds({ characterIds: ['c1'], worldIds: ['w1'], sceneIds: ['s1'] })).toEqual(['s1'])
  })

  it('情境是空陣列 → 這個情境一本都不用（不是「跟隨疊加」）', () => {
    expect(resolveLorebookIds({ characterIds: ['c1'], sceneIds: [] })).toEqual([])
  })

  it('情境 undefined → 跟隨疊加結果', () => {
    expect(resolveLorebookIds({ characterIds: ['c1'], sceneIds: undefined })).toEqual(['c1'])
  })

  it('空白 id 略過', () => {
    expect(resolveLorebookIds({ characterIds: ['', '  ', ' x '] })).toEqual(['x'])
  })

  it('全空 → 空陣列', () => {
    expect(resolveLorebookIds({})).toEqual([])
  })
})

describe('orderLorebooks', () => {
  it('照 id 順序取出（Map 與物件都吃）', () => {
    const map = new Map([['a', mk('a')], ['b', mk('b')]])
    expect(orderLorebooks(['b', 'a'], map).map(b => b.id)).toEqual(['b', 'a'])
    expect(orderLorebooks(['b', 'a'], { a: mk('a'), b: mk('b') }).map(b => b.id)).toEqual(['b', 'a'])
  })

  it('載入失敗的那本直接跳過，不中斷（§6.6 靜默略過）', () => {
    expect(orderLorebooks(['a', '壞掉的', 'b'], { a: mk('a'), b: mk('b') }).map(b => b.id)).toEqual(['a', 'b'])
  })
})
