import { describe, it, expect, vi } from 'vitest'
import { isAddressed, sortRespondersByKeywordMatch, shuffleIds, pickPrimaryResponderId } from '@core/group/responders'
import { stripOtherCharacterSpeakerLines } from '@core/group/dialogueCleanup'
import { normalizeCharacterDialogue, maybeUnwrapSingleDialogueQuote, stripSpeakerPrefixFromLine } from '@core/prompt/dialogue'
import { characterAliases } from '@core/character'
import { CHAR, CHAR2, makeSeededRandom } from '../fixtures'
import type { Character } from '@core/types'

/**
 * 群組接龍「誰該回話」的判斷邏輯 —— §6.2 第 2 項。
 * 這塊錯了很難察覺：不會報錯，只會變成「那個角色最近好像都不太講話」。
 */

const withNicknames = { ...CHAR, nicknames: ['小綠綠', 'Green'] } as unknown as Character

describe('characterAliases', () => {
  it('包含本名與所有暱稱', () => {
    expect(characterAliases(withNicknames)).toEqual(expect.arrayContaining(['小綠', '小綠綠', 'Green']))
  })
})

describe('isAddressed', () => {
  it('直接提到名字算點名', () => {
    expect(isAddressed('小綠你覺得呢', CHAR)).toBe(true)
  })

  it('@暱稱也算', () => {
    expect(isAddressed('@Green 過來一下', withNicknames)).toBe(true)
  })

  it('大小寫不敏感', () => {
    expect(isAddressed('green?', withNicknames)).toBe(true)
  })

  it('沒提到就不算', () => {
    expect(isAddressed('今天天氣真好', CHAR)).toBe(false)
  })

  it('空字串不算', () => {
    expect(isAddressed('', CHAR)).toBe(false)
  })
})

describe('sortRespondersByKeywordMatch', () => {
  const getChar = (id: string): Character | undefined => {
    if (id === 'a') return { ...CHAR, id: 'a', newsKeywords: ['半導體', 'AI'] } as unknown as Character
    if (id === 'b') return { ...CHAR2, id: 'b', newsKeywords: ['棒球'] } as unknown as Character
    if (id === 'c') return { ...CHAR2, id: 'c' } as unknown as Character
    return undefined
  }

  it('關鍵字有中的排前面', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(42))
    const out = sortRespondersByKeywordMatch(['a', 'b', 'c'], '今天聊聊半導體吧', getChar)
    expect(out[0]).toBe('a')
  })

  it('大小寫不敏感（AI vs ai）', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(7))
    expect(sortRespondersByKeywordMatch(['b', 'a'], '關於 ai 的事', getChar)[0]).toBe('a')
  })

  it('沒有人中關鍵字時，所有人都還在（只是順序被打亂）', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(1))
    const out = sortRespondersByKeywordMatch(['a', 'b', 'c'], '晚餐吃什麼', getChar)
    expect([...out].sort()).toEqual(['a', 'b', 'c'])
  })

  it('只有一個人時原樣回傳（且不是同一個陣列物件）', () => {
    const ids = ['a']
    const out = sortRespondersByKeywordMatch(ids, '半導體', getChar)
    expect(out).toEqual(['a'])
    expect(out).not.toBe(ids)
  })

  it('查不到角色不會爆', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(3))
    expect(sortRespondersByKeywordMatch(['x', 'y'], '任意', () => undefined)).toHaveLength(2)
  })
})

describe('shuffleIds', () => {
  it('不改變成員，只改順序', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(99))
    const out = shuffleIds(['a', 'b', 'c', 'd', 'e'])
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('不修改原陣列', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(5))
    const src = ['a', 'b', 'c']
    shuffleIds(src)
    expect(src).toEqual(['a', 'b', 'c'])
  })

  it('同一個 seed 給同一個結果（可重現）', () => {
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(123))
    const a = shuffleIds(['1', '2', '3', '4'])
    vi.spyOn(Math, 'random').mockImplementation(makeSeededRandom(123))
    const b = shuffleIds(['1', '2', '3', '4'])
    expect(a).toEqual(b)
  })
})

describe('pickPrimaryResponderId', () => {
  it('沒有人要回話 → null', () => {
    expect(pickPrimaryResponderId([], [])).toBeNull()
  })

  it('取第一個回應者', () => {
    expect(pickPrimaryResponderId(['a', 'b'], [])).toBe('a')
    expect(pickPrimaryResponderId(['a', 'b'], ['b'])).toBe('a')
  })
})

describe('stripOtherCharacterSpeakerLines', () => {
  const chars = [CHAR, CHAR2] as unknown as Character[]

  it('刪掉別的角色的台詞行，保留自己的內容', () => {
    const raw = '我覺得可以。\n小藍：我不同意。'
    expect(stripOtherCharacterSpeakerLines(raw, 'char-1', chars)).toBe('我覺得可以。')
  })

  it('自己的名字前綴不會被當成別人', () => {
    const raw = '小綠：我覺得可以。'
    expect(stripOtherCharacterSpeakerLines(raw, 'char-1', chars)).toContain('我覺得可以。')
  })

  it('沒有任何角色前綴時原樣', () => {
    expect(stripOtherCharacterSpeakerLines('就這樣吧。', 'char-1', chars)).toBe('就這樣吧。')
  })
})

describe('normalizeCharacterDialogue', () => {
  it('去掉自己的名字前綴', () => {
    expect(normalizeCharacterDialogue('小綠：好啊。', CHAR)).toBe('好啊。')
  })

  it('整段被引號包住時脫掉引號', () => {
    expect(maybeUnwrapSingleDialogueQuote('「好啊。」')).toBe('好啊。')
  })

  it('只有部分引號時不動', () => {
    expect(maybeUnwrapSingleDialogueQuote('他說「好啊」然後走了')).toBe('他說「好啊」然後走了')
  })

  it('stripSpeakerPrefixFromLine 只吃行首的別名', () => {
    expect(stripSpeakerPrefixFromLine('小綠：早安', ['小綠'])).toBe('早安')
    expect(stripSpeakerPrefixFromLine('我跟小綠：說了', ['小綠'])).toBe('我跟小綠：說了')
  })
})
