import { describe, expect, it } from 'vitest'
import { isActiveSceneDirty } from '../../src/core/scene/dirty'
import type { DesktopCharacterState } from '../../src/core/types'

function char(id: string): DesktopCharacterState {
  return {
    characterId: id,
    position: { x: 0, y: 0 },
    size: 1,
    flipped: false,
    muted: false,
    zIndex: 0
  }
}

const baseScene = {
  activePersonaId: 'p1',
  activeWorldId: 'w1',
  colorTheme: 'mint' as const,
  lastActiveConversationId: 'c1',
  desktopCharacters: [char('a'), char('b')]
}

const baseCurrent = {
  activePersonaId: 'p1',
  activeWorldId: 'w1',
  colorTheme: 'mint' as const,
  lastActiveConversationId: 'c1',
  desktopCharacterIds: ['a', 'b']
}

describe('isActiveSceneDirty', () => {
  it('狀態一致時不 dirty', () => {
    expect(isActiveSceneDirty(baseScene, baseCurrent)).toBe(false)
  })

  it('配色不同時 dirty', () => {
    expect(isActiveSceneDirty(baseScene, { ...baseCurrent, colorTheme: 'forest' })).toBe(true)
  })

  it('情境未寫 colorTheme 時視同 mint', () => {
    const { colorTheme: _omit, ...noTheme } = baseScene
    expect(isActiveSceneDirty(noTheme, { ...baseCurrent, colorTheme: 'mint' })).toBe(false)
    expect(isActiveSceneDirty(noTheme, { ...baseCurrent, colorTheme: 'dark' })).toBe(true)
  })

  it('使用者設定或世界觀不同時 dirty', () => {
    expect(isActiveSceneDirty(baseScene, { ...baseCurrent, activePersonaId: 'p2' })).toBe(true)
    expect(isActiveSceneDirty(baseScene, { ...baseCurrent, activeWorldId: 'w2' })).toBe(true)
  })

  it('對話不同時 dirty', () => {
    expect(isActiveSceneDirty(baseScene, { ...baseCurrent, lastActiveConversationId: 'c2' })).toBe(true)
  })

  it('在場角色成員不同時 dirty；順序無關', () => {
    expect(isActiveSceneDirty(baseScene, { ...baseCurrent, desktopCharacterIds: ['b', 'a'] })).toBe(false)
    expect(isActiveSceneDirty(baseScene, { ...baseCurrent, desktopCharacterIds: ['a'] })).toBe(true)
    expect(isActiveSceneDirty(baseScene, { ...baseCurrent, desktopCharacterIds: ['a', 'b', 'c'] })).toBe(true)
  })

  it('角色座標不參與 dirty 判定', () => {
    const moved = {
      ...baseScene,
      desktopCharacters: [
        { ...char('a'), position: { x: 99, y: 88 } },
        char('b')
      ]
    }
    expect(isActiveSceneDirty(moved, baseCurrent)).toBe(false)
  })
})
