import { describe, expect, it } from 'vitest'
import type { Conversation, Message } from '../../../src/core/types'
import { resolveCharacterName, stampCharacterNames } from '../../../src/core/chat/characterName'

const CHARS = [
  { id: 'c1', name: '星離宸' },
  { id: 'c2', name: '琉緋璃' }
]

function msg(over: Partial<Message> = {}): Message {
  return { id: 'm1', role: 'character', characterId: 'c1', content: '哈囉', timestamp: 1, ...over }
}

function conv(messages: Message[]): Conversation {
  return {
    id: 'conv1',
    title: 't',
    participantIds: [],
    messages,
    summary: '',
    createdAt: 1,
    updatedAt: 1
  }
}

describe('resolveCharacterName', () => {
  it('角色還在 → 用現在的名字（改過名的話舊訊息也要跟著更新）', () => {
    // 快照是舊名字，但角色還在且已改名 → 顯示新名字，不是快照
    expect(resolveCharacterName('c1', CHARS, '舊名字')).toBe('星離宸')
  })

  it('角色查不到 → 退回訊息裡的名字快照', () => {
    expect(resolveCharacterName('gone', CHARS, '汪逸彤')).toBe('汪逸彤')
  })

  it('角色查不到又沒有快照 → 用呼叫端給的 fallback', () => {
    expect(resolveCharacterName('gone', CHARS, undefined, '角色')).toBe('角色')
    expect(resolveCharacterName('gone', CHARS)).toBe('')
  })

  it('快照是空白字串時視同沒有', () => {
    expect(resolveCharacterName('gone', CHARS, '   ', '角色')).toBe('角色')
  })

  it('沒有 characterId（系統訊息）→ fallback', () => {
    expect(resolveCharacterName(undefined, CHARS, '不該用到', '系統')).toBe('系統')
  })
})

describe('stampCharacterNames', () => {
  it('補上角色訊息的名字快照', () => {
    const c = conv([msg({ id: 'm1', characterId: 'c1' }), msg({ id: 'm2', characterId: 'c2' })])
    expect(stampCharacterNames(c, CHARS)).toBe(true)
    expect(c.messages[0]!.characterName).toBe('星離宸')
    expect(c.messages[1]!.characterName).toBe('琉緋璃')
  })

  it('已經有快照的不覆蓋——那是當時存的，比現在的名單可信', () => {
    const c = conv([msg({ characterName: '當時的名字' })])
    expect(stampCharacterNames(c, CHARS)).toBe(false)
    expect(c.messages[0]!.characterName).toBe('當時的名字')
  })

  it('查不到角色就不寫，不要塞一個猜的名字進使用者的存檔', () => {
    const c = conv([msg({ characterId: '已經被刪掉的角色' })])
    expect(stampCharacterNames(c, CHARS)).toBe(false)
    expect(c.messages[0]!.characterName).toBeUndefined()
  })

  it('使用者訊息與系統訊息不碰', () => {
    const c = conv([
      msg({ id: 'u', role: 'user', characterId: undefined }),
      msg({ id: 's', role: 'system', characterId: undefined })
    ])
    expect(stampCharacterNames(c, CHARS)).toBe(false)
    expect(c.messages[0]!.characterName).toBeUndefined()
    expect(c.messages[1]!.characterName).toBeUndefined()
  })

  it('沒有任何要補的就回 false，呼叫端可以據此跳過寫檔', () => {
    const c = conv([msg({ characterName: '有了' })])
    expect(stampCharacterNames(c, CHARS)).toBe(false)
  })
})
