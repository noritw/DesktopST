import { describe, expect, it } from 'vitest'
import { computeDiff, isDiffEmpty } from '../../../src/core/sync/diff'
import type { Manifest, SyncBaseline } from '../../../src/core/sync/types'

function emptyManifest(settingsHash = 'h0'): Manifest {
  return { characters: [], personas: [], worlds: [], scenes: [], lorebooks: [], conversations: [], settingsHash }
}

function emptyBaseline(settingsHash = 'h0'): SyncBaseline {
  return {
    hostBaseUrl: 'http://192.168.1.5:5175',
    syncedAt: 1000,
    characters: {},
    personas: {},
    worlds: {},
    scenes: {},
    lorebooks: {},
    conversations: {},
    settingsHash
  }
}

describe('computeDiff', () => {
  it('回傳 hasBaseline: false 且全空，當手機上還沒有基準（第一次切換）', () => {
    const local = emptyManifest()
    local.characters.push({ id: 'c1', name: '星離宸', updatedAt: 100 })
    const remote = emptyManifest()
    remote.characters.push({ id: 'c9', name: '琉緋璃', updatedAt: 200 })

    const diff = computeDiff(null, local, remote)

    expect(diff.hasBaseline).toBe(false)
    expect(diff.characters.localNew).toEqual([])
    expect(diff.characters.remoteNew).toEqual([])
    expect(isDiffEmpty(diff)).toBe(true)
  })

  it('偵測本地新增：本地有這個 id，基準裡沒有', () => {
    const baseline = emptyBaseline()
    const local = emptyManifest()
    local.characters.push({ id: 'c1', name: '星離宸', updatedAt: 100 })
    const remote = emptyManifest()

    const diff = computeDiff(baseline, local, remote)
    expect(diff.characters.localNew).toEqual(['c1'])
    expect(isDiffEmpty(diff)).toBe(false)
  })

  it('偵測本地修改：本地 updatedAt > baseline.localUpdatedAt', () => {
    const baseline = emptyBaseline()
    baseline.characters['c1'] = { remoteId: 'rc1', localUpdatedAt: 100, remoteUpdatedAt: 100 }
    const local = emptyManifest()
    local.characters.push({ id: 'c1', name: '星離宸', updatedAt: 200 })
    const remote = emptyManifest()
    remote.characters.push({ id: 'rc1', name: '星離宸', updatedAt: 100 })

    const diff = computeDiff(baseline, local, remote)
    expect(diff.characters.localModified).toEqual(['c1'])
    expect(diff.characters.remoteModified).toEqual([])
  })

  it('偵測本地刪除：基準裡有，本地查不到', () => {
    const baseline = emptyBaseline()
    baseline.characters['c1'] = { remoteId: 'rc1', localUpdatedAt: 100, remoteUpdatedAt: 100 }
    const local = emptyManifest()
    const remote = emptyManifest()
    remote.characters.push({ id: 'rc1', name: '星離宸', updatedAt: 100 })

    const diff = computeDiff(baseline, local, remote)
    expect(diff.characters.localDeleted).toEqual(['c1'])
  })

  it('偵測遠端新增／修改／刪除，規則與本地對稱', () => {
    const baseline = emptyBaseline()
    baseline.characters['c1'] = { remoteId: 'rc1', localUpdatedAt: 100, remoteUpdatedAt: 100 }
    const local = emptyManifest()
    local.characters.push({ id: 'c1', name: '星離宸', updatedAt: 100 })
    local.characters.push({ id: 'c2', name: '本地限定', updatedAt: 50 })
    const remote = emptyManifest()
    remote.characters.push({ id: 'rc1', name: '星離宸', updatedAt: 300 })
    remote.characters.push({ id: 'rc9', name: '電腦新角色', updatedAt: 400 })

    const diff = computeDiff(baseline, local, remote)
    expect(diff.characters.localNew).toEqual(['c2'])
    expect(diff.characters.remoteNew).toEqual(['rc9'])
    expect(diff.characters.remoteModified).toEqual(['rc1'])
    expect(diff.characters.remoteDeleted).toEqual([])
  })

  it('設定變動：目前內容雜湊 != baseline.settingsHash', () => {
    const baseline = emptyBaseline('h0')
    const local = emptyManifest('h1')
    const remote = emptyManifest('h0')

    const diff = computeDiff(baseline, local, remote)
    expect(diff.settingsChanged).toBe(true)
  })

  it('衝突：同一筆基準對應的實體兩邊都改了，不算進 modified，改記進 conflicts', () => {
    const baseline = emptyBaseline()
    baseline.characters['c1'] = { remoteId: 'rc1', localUpdatedAt: 100, remoteUpdatedAt: 100 }
    const local = emptyManifest()
    local.characters.push({ id: 'c1', name: '星離宸', updatedAt: 200 })
    const remote = emptyManifest()
    remote.characters.push({ id: 'rc1', name: '星離宸', updatedAt: 300 })

    const diff = computeDiff(baseline, local, remote)
    expect(diff.characters.conflicts).toEqual(['c1'])
    expect(diff.characters.localModified).toEqual([])
    expect(diff.characters.remoteModified).toEqual([])
  })

  it('改名後不重複：已有基準對應的實體改名，靠 id 對應表找到，不會被判成新增', () => {
    const baseline = emptyBaseline()
    baseline.characters['c1'] = { remoteId: 'rc1', localUpdatedAt: 100, remoteUpdatedAt: 100 }
    const local = emptyManifest()
    local.characters.push({ id: 'c1', name: '改名後的星離宸', updatedAt: 100 })
    const remote = emptyManifest()
    remote.characters.push({ id: 'rc1', name: '星離宸', updatedAt: 100 })

    const diff = computeDiff(baseline, local, remote)
    expect(diff.characters.localNew).toEqual([])
    expect(diff.characters.remoteNew).toEqual([])
    expect(diff.characters.localModified).toEqual([])
  })

  it('名字後備配對：雙方都還沒有基準紀錄、名字相同的實體視為已對應，不算新增', () => {
    const baseline = emptyBaseline()
    const local = emptyManifest()
    local.characters.push({ id: 'c1', name: '同名角色', updatedAt: 100 })
    const remote = emptyManifest()
    remote.characters.push({ id: 'rc1', name: '同名角色', updatedAt: 100 })

    const diff = computeDiff(baseline, local, remote)
    expect(diff.characters.localNew).toEqual([])
    expect(diff.characters.remoteNew).toEqual([])
  })

  it('對話比對套用同一套規則，以 title 當名字後備', () => {
    const baseline = emptyBaseline()
    const local = emptyManifest()
    local.conversations.push({ id: 'conv1', title: '日常對話', updatedAt: 100, messageCount: 12 })
    const remote = emptyManifest()

    const diff = computeDiff(baseline, local, remote)
    expect(diff.conversations.localNew).toEqual(['conv1'])
  })
})
