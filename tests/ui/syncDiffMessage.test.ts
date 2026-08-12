import { describe, expect, it } from 'vitest'
import { formatDiffMessage, formatFirstRunMessage } from '../../src/mobile/ui/shell/syncDiffMessage'
import type { Manifest, SyncDiff } from '../../src/core/sync/types'

function emptyManifest(): Manifest {
  return { characters: [], personas: [], worlds: [], scenes: [], lorebooks: [], conversations: [], settingsHash: 'h' }
}

const EMPTY_COLLECTION = {
  localNew: [],
  localModified: [],
  localDeleted: [],
  remoteNew: [],
  remoteModified: [],
  remoteDeleted: [],
  conflicts: []
}

function emptyDiff(): SyncDiff {
  return {
    hasBaseline: true,
    characters: { ...EMPTY_COLLECTION },
    personas: { ...EMPTY_COLLECTION },
    worlds: { ...EMPTY_COLLECTION },
    scenes: { ...EMPTY_COLLECTION },
    lorebooks: { ...EMPTY_COLLECTION },
    conversations: { ...EMPTY_COLLECTION },
    settingsChanged: false
  }
}

describe('formatFirstRunMessage', () => {
  it('列出雙邊筆數統計，不逐筆貼標籤', () => {
    const local = emptyManifest()
    local.characters.push({ id: 'c1', name: '星離宸', updatedAt: 1 })
    const remote = emptyManifest()
    remote.characters.push({ id: 'rc1', name: 'A', updatedAt: 1 })
    remote.characters.push({ id: 'rc2', name: 'B', updatedAt: 1 })

    const msg = formatFirstRunMessage(local, remote)
    expect(msg).toContain('手機：角色 1')
    expect(msg).toContain('電腦：角色 2')
    expect(msg).not.toContain('新增')
  })
})

describe('formatDiffMessage', () => {
  it('只列出有變動的 collection', () => {
    const diff = emptyDiff()
    diff.characters.localNew = ['c1', 'c2']
    diff.conversations.remoteModified = ['rc1']

    const msg = formatDiffMessage(diff)
    expect(msg).toContain('角色：手機新增 2')
    expect(msg).toContain('對話：電腦修改 1')
    expect(msg).not.toContain('人設')
  })

  it('衝突與設定變動都會被列出', () => {
    const diff = emptyDiff()
    diff.characters.conflicts = ['c1']
    diff.settingsChanged = true

    const msg = formatDiffMessage(diff)
    expect(msg).toContain('衝突 1')
    expect(msg).toContain('設定：兩邊不一樣')
  })
})
