import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { sha1Hex, sha1HexBytes } from '../../src/core/util/sha1'
import { stableId } from '../../src/core/news/stableId'
import { makeSeededRandom } from '../fixtures'

/**
 * 這支測試的意義：新聞 id 從 Node 的 `crypto.createHash('sha1')` 換成純 JS 實作，
 * **輸出必須逐字元相同**——否則使用者的 seenIds 與新聞報釘選會靜默失效。
 * 比對方式比照 `base64.test.ts`：拿 Node 原生實作當標準答案。
 */

const nodeSha1 = (text: string): string => createHash('sha1').update(text).digest('hex')

describe('sha1Hex', () => {
  it('符合公開測試向量', () => {
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('與 Node crypto 一致：常見字串', () => {
    const samples = [
      '',
      'a',
      'https://news.google.com/rss/articles/CBMi',
      '中文標題也要一樣',
      '👨‍👩‍👧‍👦 emoji 與代理對',
      'tag:news.google.com,2005:cluster=12345678901234567890',
      'a'.repeat(55),  // 補綴邊界：55/56/57 剛好跨過 block
      'a'.repeat(56),
      'a'.repeat(57),
      'a'.repeat(63),
      'a'.repeat(64),
      'a'.repeat(65),
      'x'.repeat(1000)
    ]
    for (const s of samples) {
      expect(sha1Hex(s), `輸入長度 ${s.length}`).toBe(nodeSha1(s))
    }
  })

  it('與 Node crypto 一致：200 組隨機字串（固定 seed，不依賴亂數）', () => {
    const rand = makeSeededRandom(20260804)
    for (let i = 0; i < 200; i++) {
      const len = Math.floor(rand() * 300)
      let s = ''
      for (let j = 0; j < len; j++) {
        s += String.fromCodePoint(Math.floor(rand() * 0x2000) + 0x20)
      }
      expect(sha1Hex(s)).toBe(nodeSha1(s))
    }
  })

  it('位元組版與字串版對 UTF-8 輸入一致', () => {
    const text = '澆花與部門會議'
    expect(sha1HexBytes(new TextEncoder().encode(text))).toBe(sha1Hex(text))
  })
})

describe('stableId', () => {
  it('與舊實作（Node sha1 前 12 碼）相同', () => {
    for (const key of ['https://example.com/a', 'guid-123', '中文 guid']) {
      expect(stableId('keyword', key)).toBe(`keyword-${nodeSha1(key).slice(0, 12)}`)
    }
  })

  it('同一個 key 永遠算出同一個 id', () => {
    expect(stableId('rss', 'k')).toBe(stableId('rss', 'k'))
    expect(stableId('rss', 'k')).not.toBe(stableId('rss', 'k2'))
  })

  it('前綴不同則 id 不同', () => {
    expect(stableId('rss', 'k')).not.toBe(stableId('json', 'k'))
  })
})
