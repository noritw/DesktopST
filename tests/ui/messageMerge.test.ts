import { describe, it, expect } from 'vitest'
import { DataError } from '../../src/core/data'
import type { MessageSnapshot } from '../../src/core/data'
import { mergeIncoming, describeError, isOptimistic } from '../../src/mobile/ui/stores/appStore'

/**
 * 訊息併入（清單 A4 樂觀渲染）。
 *
 * 這是階段 2 唯一「不看畫面也驗得出來」的邏輯，而且是最容易出錯的一塊：
 * 少了取代就會看到自己的訊息出現兩次，少了去重則重連對帳後整串翻倍。
 */

const msg = (over: Partial<MessageSnapshot>): MessageSnapshot => ({
  id: 'm1',
  role: 'user',
  content: '嗨',
  timestamp: 1000,
  ...over
})

describe('樂觀訊息的取代', () => {
  it('伺服器回音取代掉樂觀那則，不會變成兩則', () => {
    const list = [msg({ id: 'optimistic:1', content: '嗨' })]
    const out = mergeIncoming(list, msg({ id: 'real-1', content: '嗨' }))
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('real-1')
  })

  it('內容不同就不是同一則，兩則都留著', () => {
    const list = [msg({ id: 'optimistic:1', content: '嗨' })]
    const out = mergeIncoming(list, msg({ id: 'real-1', content: '你好' }))
    expect(out).toHaveLength(2)
  })

  it('角色訊息不會去取代使用者的樂觀訊息', () => {
    const list = [msg({ id: 'optimistic:1', content: '嗨' })]
    const out = mergeIncoming(list, msg({ id: 'r1', role: 'character', content: '嗨' }))
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('optimistic:1')
  })

  it('時間戳不同也照樣取代 —— 伺服器與手機的時鐘不會一致', () => {
    const list = [msg({ id: 'optimistic:1', content: '嗨', timestamp: 1000 })]
    const out = mergeIncoming(list, msg({ id: 'real-1', content: '嗨', timestamp: 999999 }))
    expect(out).toHaveLength(1)
  })

  it('連送兩則相同內容時，只取代最舊的那則', () => {
    const list = [
      msg({ id: 'optimistic:1', content: '嗨' }),
      msg({ id: 'optimistic:2', content: '嗨' })
    ]
    const out = mergeIncoming(list, msg({ id: 'real-1', content: '嗨' }))
    expect(out.map((m) => m.id)).toEqual(['real-1', 'optimistic:2'])
  })
})

describe('去重', () => {
  it('同一個 id 進來兩次只留一則（重連對帳後會發生）', () => {
    const list = [msg({ id: 'real-1' })]
    expect(mergeIncoming(list, msg({ id: 'real-1' }))).toHaveLength(1)
  })

  it('沒有相符的樂觀訊息時就直接附在最後', () => {
    const out = mergeIncoming([msg({ id: 'a' })], msg({ id: 'b', role: 'character' }))
    expect(out.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('isOptimistic', () => {
  it('只認前綴，不猜', () => {
    expect(isOptimistic(msg({ id: 'optimistic:123' }))).toBe(true)
    expect(isOptimistic(msg({ id: 'real' }))).toBe(false)
  })
})

describe('錯誤代碼翻成使用者看得懂的話', () => {
  it('每個代碼在兩種情境下都有對應文案，且都不是代碼本身', () => {
    for (const code of ['unreachable', 'unauthorized', 'invalid-input', 'not-supported', 'unknown'] as const) {
      for (const ctx of ['send', 'load'] as const) {
        const text = describeError(new DataError(code), ctx)
        expect(text).not.toContain(code)
        expect(text.length).toBeGreaterThan(5)
      }
    }
  })

  it('同一個代碼在送出與載入下講的話不同 —— 使用者關心的事不一樣', () => {
    expect(describeError(new DataError('unreachable'), 'send')).toContain('送不出去')
    expect(describeError(new DataError('unreachable'), 'load')).toContain('載入失敗')
  })

  it('不是 DataError 的東西也要有話講，不能露出堆疊', () => {
    expect(describeError(new TypeError('boom'), 'send')).not.toContain('boom')
  })
})
