import { describe, it, expect } from 'vitest'
import { bytesToBase64, base64ToBytes, utf8ToBase64, base64ToUtf8 } from '@core/util/base64'

/**
 * base64 —— §6.2 第 7 項。
 *
 * 為什麼 core 要自己寫一份：`Buffer` 是 Node 專屬；`atob`/`btoa` 兩端 runtime 都有，
 * 但型別不在 `lib: ES2022` 裡，而 core 要同時被桌面與前端兩套 tsconfig 編譯。
 * 搬移當時已與 Node `Buffer` 逐位元組比對過，這裡把它固化成常設測試。
 */

function randomBytes(n: number, seed: number): Uint8Array {
  let s = seed >>> 0
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    out[i] = s & 0xff
  }
  return out
}

describe('bytesToBase64 / base64ToBytes', () => {
  it('與 Node Buffer 逐位元組相同（長度 0..300）', () => {
    for (let n = 0; n <= 300; n++) {
      const bytes = randomBytes(n, n + 1)
      const mine = bytesToBase64(bytes)
      const node = Buffer.from(bytes).toString('base64')
      expect(mine).toBe(node)
    }
  })

  it('來回轉換還原成原始位元組', () => {
    for (let n = 0; n <= 300; n += 7) {
      const bytes = randomBytes(n, n + 77)
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes))
    }
  })

  it('三種 padding 長度都正確（0 / 1 / 2 個 =）', () => {
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).toBe('AQID')
    expect(bytesToBase64(new Uint8Array([1, 2]))).toBe('AQI=')
    expect(bytesToBase64(new Uint8Array([1]))).toBe('AQ==')
  })

  it('空輸入', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
    expect(base64ToBytes('')).toHaveLength(0)
  })

  it('含換行的 base64 也解得開（PNG chunk 常見）', () => {
    const b64 = Buffer.from('hello world').toString('base64')
    const withNewlines = b64.slice(0, 4) + '\n' + b64.slice(4)
    expect(new TextDecoder().decode(base64ToBytes(withNewlines))).toBe('hello world')
  })
})

describe('utf8ToBase64 / base64ToUtf8', () => {
  it('ASCII', () => {
    expect(base64ToUtf8(utf8ToBase64('hello'))).toBe('hello')
  })

  it('中文', () => {
    const s = '小綠說：今天天氣真好。'
    expect(utf8ToBase64(s)).toBe(Buffer.from(s, 'utf8').toString('base64'))
    expect(base64ToUtf8(utf8ToBase64(s))).toBe(s)
  })

  it('emoji（代理對）', () => {
    const s = '🎲🏮🙏🪙 擲骰'
    expect(utf8ToBase64(s)).toBe(Buffer.from(s, 'utf8').toString('base64'))
    expect(base64ToUtf8(utf8ToBase64(s))).toBe(s)
  })

  it('含換行與空字串', () => {
    expect(base64ToUtf8(utf8ToBase64('a\nb\r\nc'))).toBe('a\nb\r\nc')
    expect(base64ToUtf8(utf8ToBase64(''))).toBe('')
  })
})
