import { describe, expect, it } from 'vitest'
import type { Lorebook } from '@core/lore'
import type { Character, WorldPreset, ScenePreset } from '@core/types'
import { buildLoreBlockFor } from '../../src/mobile/runtime/chat'

/**
 * 獨立模式聊天注入 `[Glossary]`（缺口 #2 的另一半：資料能編輯後，實際要影響 prompt）。
 *
 * 只測 `buildLoreBlockFor` 本身——`selectLoreEntries`／`formatLoreBlock` 等純函式
 * 已在 `tests/core/lore` 涵蓋，這裡只驗證獨立版把「角色／世界觀／情境的 lorebookIds
 * 解析成實際載入哪幾本、掃描哪段文字」這段接線接對了。
 */

const BOOK: Lorebook = {
  id: 'lb1',
  name: '專案用語',
  entries: [
    { id: 'e1', keys: ['DeST', 'DesktopST'], content: 'DeST 是使用者的桌面 AI 程式。', enabled: true, constant: false, insertion_order: 0 }
  ],
  scan_depth: 0,
  token_budget: 2000,
  createdAt: 0,
  updatedAt: 0
}

const CHAR: Character = { id: 'c1', name: '小綠' } as Character
const WORLD: WorldPreset = { id: 'w1', name: '預設世界觀' } as WorldPreset

describe('buildLoreBlockFor（獨立模式）', () => {
  it('角色／世界觀都沒掛書時回 undefined（不出現空標籤）', async () => {
    const block = await buildLoreBlockFor(CHAR, WORLD, null, { recentContents: ['隨便聊聊'] }, async () => null, new Map())
    expect(block).toBeUndefined()
  })

  it('關鍵字命中時組出 [Glossary] 區塊', async () => {
    const char = { ...CHAR, lorebookIds: ['lb1'] }
    const load = async (id: string) => (id === 'lb1' ? BOOK : null)
    const block = await buildLoreBlockFor(char, WORLD, null, { recentContents: ['DeST 是什麼？'] }, load, new Map())
    expect(block).toContain('[Glossary]')
    expect(block).toContain('DeST 是使用者的桌面 AI 程式。')
  })

  it('沒命中關鍵字時回 undefined', async () => {
    const char = { ...CHAR, lorebookIds: ['lb1'] }
    const load = async (id: string) => (id === 'lb1' ? BOOK : null)
    const block = await buildLoreBlockFor(char, WORLD, null, { recentContents: ['今天天氣真好'] }, load, new Map())
    expect(block).toBeUndefined()
  })

  it('情境綁定是取代式：情境設定了自己的清單就不再疊加角色／世界觀', async () => {
    const char = { ...CHAR, lorebookIds: ['lb1'] }
    const scene: ScenePreset = { id: 's1', name: '深夜', lorebookIds: [] } as unknown as ScenePreset
    const load = async (id: string) => (id === 'lb1' ? BOOK : null)
    const block = await buildLoreBlockFor(char, WORLD, scene, { recentContents: ['DeST 是什麼？'] }, load, new Map())
    expect(block).toBeUndefined()
  })

  it('讀取失敗（loadLorebook 回 null）靜默略過，不拋例外', async () => {
    const char = { ...CHAR, lorebookIds: ['missing'] }
    const block = await buildLoreBlockFor(char, WORLD, null, { recentContents: ['DeST'] }, async () => null, new Map())
    expect(block).toBeUndefined()
  })

  it('同一輪內用同一個 cache，loadLorebook 只呼叫一次', async () => {
    const char = { ...CHAR, lorebookIds: ['lb1'] }
    let calls = 0
    const load = async (id: string) => {
      calls++
      return id === 'lb1' ? BOOK : null
    }
    const cache = new Map()
    await buildLoreBlockFor(char, WORLD, null, { recentContents: ['DeST'] }, load, cache)
    await buildLoreBlockFor(char, WORLD, null, { recentContents: ['DeST'] }, load, cache)
    expect(calls).toBe(1)
  })
})
