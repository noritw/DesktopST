/**
 * Base64 ⇄ 位元組，純實作。
 *
 * 為什麼不用現成的：
 * - `Buffer` 是 Node 專屬，手機端沒有
 * - `atob` / `btoa` 在 Node 16+ 與瀏覽器都有，但**型別不在 `lib: ES2022` 裡**，
 *   而 `core/` 同時要被桌面（無 DOM lib）與前端兩套 tsconfig 編譯
 *
 * 兩邊都成立的只剩自己寫。約 30 行，沒有維護負擔。
 * 文字編解碼另外用 `TextEncoder` / `TextDecoder`（兩套環境的型別都有）。
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += CHARS[b0 >> 2]
    out += CHARS[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : CHARS[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : CHARS[b2 & 63]
  }
  return out
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array((clean.length * 3) >> 2)
  let p = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n0 = CHARS.indexOf(clean[i])
    const n1 = CHARS.indexOf(clean[i + 1])
    const n2 = CHARS.indexOf(clean[i + 2])
    const n3 = CHARS.indexOf(clean[i + 3])
    out[p++] = (n0 << 2) | (n1 >> 4)
    if (n2 >= 0) out[p++] = ((n1 & 15) << 4) | (n2 >> 2)
    if (n3 >= 0) out[p++] = ((n2 & 3) << 6) | n3
  }
  return p === out.length ? out : out.subarray(0, p)
}

export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

export function base64ToUtf8(b64: string): string {
  return new TextDecoder('utf-8').decode(base64ToBytes(b64))
}
