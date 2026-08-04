/**
 * SHA-1（純 TypeScript，約 50 行）。
 *
 * **為什麼要自己寫**：新聞 id 目前用 Node 的 `crypto.createHash('sha1')` 算，
 * 而 `crypto` 是 Node 專屬，手機端沒有。`core/util/base64.ts` 是同樣的理由。
 *
 * **為什麼不換一個更簡單的雜湊**：新聞 id 確實只需要穩定去重、不需要密碼學強度，
 * 但它已經被寫進使用者的資料裡了——`seenIds`（看過哪些）與新聞報的釘選／不看了
 * 都以這個 id 當鍵。換演算法＝全部的 id 變號＝看過的新聞重新冒出來、釘選的主題掉光，
 * 而且是靜默發生。**維持與 SHA-1 逐位元組相同才是零成本的那條路。**
 *
 * 輸出與 Node `createHash('sha1').update(text).digest('hex')` 完全一致
 * （已在 `tests/util/sha1.test.ts` 逐一比對）。
 */

function toHex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0')
}

export function sha1HexBytes(msg: Uint8Array): string {
  const byteLen = msg.length
  const bitLen = byteLen * 8
  // 補一個 0x80、補零，最後 8 位元組放大端序的原始位元長度
  const blocks = Math.ceil((byteLen + 1 + 8) / 64)
  const total = blocks * 64
  const buf = new Uint8Array(total)
  buf.set(msg)
  buf[byteLen] = 0x80
  const dv = new DataView(buf.buffer)
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000))
  dv.setUint32(total - 4, bitLen >>> 0)

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Uint32Array(80)

  for (let i = 0; i < blocks; i++) {
    const off = i * 64
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(off + j * 4)
    for (let j = 16; j < 80; j++) {
      const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16]
      w[j] = (n << 1) | (n >>> 31)
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let j = 0; j < 80; j++) {
      let f: number, k: number
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5a827999 }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc }
      else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) >>> 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = t
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  return toHex8(h0) + toHex8(h1) + toHex8(h2) + toHex8(h3) + toHex8(h4)
}

/** 字串以 UTF-8 編碼後取 SHA-1（等同 Node 的 `.update(text)` 預設行為）。 */
export function sha1Hex(text: string): string {
  return sha1HexBytes(new TextEncoder().encode(text))
}
