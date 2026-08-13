import { describe, expect, it } from 'vitest'
import {
  actionFor,
  applyPreset,
  countPlan,
  defaultChoice,
  defaultChoices,
  isNoop,
  listDeletions,
  pairCollection,
  pairManifests,
  type ChoiceMap,
  type PairEntity,
  type PairRow,
  type PairTable
} from '../../../src/core/sync/pair'

const emptyChoiceMap = (): ChoiceMap => ({
  characters: {},
  personas: {},
  worlds: {},
  scenes: {},
  lorebooks: {}
})
import type { Manifest } from '../../../src/core/sync/types'

const e = (id: string, name: string, updatedAt = 1000, contentHash?: string): PairEntity => ({
  id,
  name,
  updatedAt,
  contentHash
})

describe('pairCollection', () => {
  it('id 相同的配成一列', () => {
    const rows = pairCollection([e('a', '小明')], [e('a', '小明')])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ localId: 'a', remoteId: 'a' })
  })

  it('id 不同但名稱相同的也配成一列——這是 M3 重複資料的核心修正', () => {
    const rows = pairCollection([e('phone-1', 'Nori')], [e('desktop-9', 'Nori')])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ localId: 'phone-1', remoteId: 'desktop-9' })
  })

  it('名稱配對忽略大小寫與前後空白', () => {
    const rows = pairCollection([e('l', '  Nori ')], [e('r', 'nori')])
    expect(rows).toHaveLength(1)
    expect(rows[0].remoteId).toBe('r')
  })

  it('id 相同但名字被改過時，仍視為同一個，並保留兩邊的名字', () => {
    const rows = pairCollection([e('x', '手機資料測試用')], [e('x', '手機資料世界觀電腦改過')])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('手機資料測試用')
    expect(rows[0].remoteName).toBe('手機資料世界觀電腦改過')
  })

  it('只有一邊有的各自成列', () => {
    const rows = pairCollection([e('l', '只有手機')], [e('r', '只有電腦')])
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.name === '只有手機')).toMatchObject({ localId: 'l', remoteId: undefined })
    expect(rows.find((r) => r.name === '只有電腦')).toMatchObject({ localId: undefined, remoteId: 'r' })
  })

  it('同一側有多筆同名時依 updatedAt 由新到舊依序配對，多的自成一列', () => {
    const rows = pairCollection(
      [e('l1', 'TRPG', 300), e('l2', 'TRPG', 100)],
      [e('r1', 'TRPG', 200)]
    )
    expect(rows).toHaveLength(2)
    // 最新的手機那筆配到電腦唯一那筆
    expect(rows.find((r) => r.localId === 'l1')?.remoteId).toBe('r1')
    expect(rows.find((r) => r.localId === 'l2')?.remoteId).toBeUndefined()
  })

  it('id 配對優先於名稱配對', () => {
    const rows = pairCollection([e('same', 'A'), e('other', 'A')], [e('same', 'A'), e('zzz', 'A')])
    expect(rows.find((r) => r.localId === 'same')?.remoteId).toBe('same')
    expect(rows.find((r) => r.localId === 'other')?.remoteId).toBe('zzz')
  })

  it('contentHash 相同 → same；不同 → differs；缺一邊 → unknown', () => {
    expect(pairCollection([e('a', 'X', 1, 'h1')], [e('a', 'X', 2, 'h1')])[0].compare).toBe('same')
    expect(pairCollection([e('a', 'X', 1, 'h1')], [e('a', 'X', 2, 'h2')])[0].compare).toBe('differs')
    expect(pairCollection([e('a', 'X', 1, 'h1')], [e('a', 'X', 2)])[0].compare).toBe('unknown')
  })

  it('updatedAt 較新不代表內容不同（推送會把接收端時間設成現在）', () => {
    const rows = pairCollection([e('a', 'X', 1, 'h1')], [e('a', 'X', 999999, 'h1')])
    expect(rows[0].compare).toBe('same')
  })

  it('兩邊都空時回空陣列', () => {
    expect(pairCollection([], [])).toEqual([])
  })

  it('key 唯一，可直接當 React key', () => {
    const rows = pairCollection([e('a', 'A'), e('b', 'B')], [e('c', 'C')])
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })
})

describe('defaultChoice', () => {
  it('只有手機有 → 推過去', () => {
    expect(defaultChoice({ key: 'k', name: 'n', localId: 'a' })).toBe('local')
  })
  it('只有電腦有 → 拉回來', () => {
    expect(defaultChoice({ key: 'k', name: 'n', remoteId: 'a' })).toBe('remote')
  })
  it('兩邊都有 → 預設不動，不替使用者決定', () => {
    expect(defaultChoice({ key: 'k', name: 'n', localId: 'a', remoteId: 'b', compare: 'differs' })).toBe('keep')
  })
})

function table(rows: Partial<PairTable>): PairTable {
  return {
    characters: [],
    personas: [],
    worlds: [],
    scenes: [],
    lorebooks: [],
    ...rows
  }
}

describe('applyPreset', () => {
  const t = table({
    personas: [
      { key: 'both', name: '兩邊都有', localId: 'l', remoteId: 'r', compare: 'differs' },
      { key: 'onlyL', name: '只有手機', localId: 'l2' },
      { key: 'onlyR', name: '只有電腦', remoteId: 'r2' }
    ]
  })

  it('全部用手機：兩邊都有的選手機，單邊獨有的仍然補到對面（不刪東西）', () => {
    const c = applyPreset(t, 'local')
    expect(c.personas.both).toBe('local')
    expect(c.personas.onlyL).toBe('local')
    expect(c.personas.onlyR).toBe('remote')
  })

  it('全部用電腦：同理，只影響兩邊都有的那些列', () => {
    const c = applyPreset(t, 'remote')
    expect(c.personas.both).toBe('remote')
    expect(c.personas.onlyL).toBe('local')
    expect(c.personas.onlyR).toBe('remote')
  })

  it('保留差異：只補缺的，衝突的一律不動', () => {
    const c = applyPreset(t, 'keep')
    expect(c.personas.both).toBe('keep')
    expect(c.personas.onlyL).toBe('local')
    expect(c.personas.onlyR).toBe('remote')
  })
})

describe('isNoop / countPlan', () => {
  it('內容相同的列選哪一邊都不必動', () => {
    const row = { key: 'k', name: 'n', localId: 'l', remoteId: 'r', compare: 'same' as const }
    expect(isNoop(row, 'local')).toBe(true)
    expect(isNoop(row, 'remote')).toBe(true)
  })

  it('統計推幾筆、拉幾筆、不動幾筆', () => {
    const t = table({
      characters: [
        { key: 'a', name: 'a', localId: 'l' },
        { key: 'b', name: 'b', remoteId: 'r' },
        { key: 'c', name: 'c', localId: 'l', remoteId: 'r', compare: 'same' },
        { key: 'd', name: 'd', localId: 'l', remoteId: 'r', compare: 'differs' }
      ]
    })
    expect(countPlan(t, defaultChoices(t))).toEqual({
      push: 1,
      pull: 1,
      deleteLocal: 0,
      deleteRemote: 0,
      untouched: 2
    })
  })
})

/**
 * 「選了空的那一邊 ＝ 刪掉另一邊」（owner 2026-08-14）。
 * 情境：在電腦上刪掉測試資料後，要讓手機跟著刪。
 */
describe('選空的那一邊＝刪除', () => {
  const onlyLocal: PairRow = { key: 'k', name: '手機才有', localId: 'l' }
  const onlyRemote: PairRow = { key: 'k', name: '電腦才有', remoteId: 'r' }

  it('只有手機有、卻選了電腦 → 刪掉手機那份', () => {
    expect(actionFor(onlyLocal, 'remote')).toBe('delete-local')
  })

  it('只有電腦有、卻選了手機 → 刪掉電腦那份', () => {
    expect(actionFor(onlyRemote, 'local')).toBe('delete-remote')
  })

  it('選自己有的那一邊仍然是複製，不是刪除', () => {
    expect(actionFor(onlyLocal, 'local')).toBe('push')
    expect(actionFor(onlyRemote, 'remote')).toBe('pull')
  })

  it('選「不動」永遠不刪東西', () => {
    expect(actionFor(onlyLocal, 'keep')).toBe('none')
    expect(actionFor(onlyRemote, 'keep')).toBe('none')
  })

  it('三顆快捷鍵都不會產生刪除——一顆按鈕能刪幾十筆遲早會被手滑按到', () => {
    const t = table({ characters: [onlyLocal, { key: 'k2', name: '電腦才有', remoteId: 'r' }] })
    for (const preset of ['local', 'remote', 'keep'] as const) {
      const counts = countPlan(t, applyPreset(t, preset))
      expect(counts.deleteLocal, preset).toBe(0)
      expect(counts.deleteRemote, preset).toBe(0)
    }
  })

  it('countPlan 分開統計兩個方向的刪除', () => {
    const t = table({
      characters: [onlyLocal, { key: 'k2', name: '電腦才有', remoteId: 'r' }]
    })
    const counts = countPlan(t, { ...emptyChoiceMap(), characters: { k: 'remote', k2: 'local' } })
    expect(counts).toMatchObject({ deleteLocal: 1, deleteRemote: 1, push: 0, pull: 0 })
  })

  it('listDeletions 逐筆列出要刪什麼、刪在哪一台（確認視窗要用）', () => {
    const t = table({ personas: [onlyLocal] })
    const out = listDeletions(t, { ...emptyChoiceMap(), personas: { k: 'remote' } })
    expect(out).toEqual([{ kind: 'personas', name: '手機才有', side: 'local' }])
  })
})

describe('pairManifests', () => {
  const m = (over: Partial<Manifest>): Manifest => ({
    characters: [],
    personas: [],
    worlds: [],
    scenes: [],
    lorebooks: [],
    conversations: [],
    settingsHash: 'h',
    ...over
  })

  it('五個 collection 都會被配對，對話不在其中（M4 不同步對話）', () => {
    const t = pairManifests(m({ characters: [e('a', 'A')] }), m({ personas: [e('b', 'B')] }))
    expect(t.characters).toHaveLength(1)
    expect(t.personas).toHaveLength(1)
    expect(Object.keys(t)).toEqual(['characters', 'personas', 'worlds', 'scenes', 'lorebooks'])
  })
})
