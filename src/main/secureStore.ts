import { safeStorage } from 'electron'

const ENC_PREFIX = 'enc:v1:'

/**
 * 明文 → 密文 快取。
 *
 * DPAPI（safeStorage.encryptString）對同一明文每次都會產生不同密文（含隨機 IV），
 * 但解密結果一致；app 任何地方都不會比對密文位元組，只在意解密後的明文。
 * 因此對「沒變過的明文」重複加密純屬同步浪費——encryptString 是阻塞的 native 呼叫，
 * 而 saveSettings 每次存檔都會把所有 API Key 重新加密一次（即使這次存檔與金鑰無關）。
 *
 * 快取後：明文沒變就直接回傳既有密文，省掉 DPAPI 呼叫，也讓存檔不再無謂變動。
 * 載入時 decrypt 成功會把「明文 → 當時讀到的密文」種入快取，使載入後首次存檔零變動。
 *
 * 對外行為不變：回傳值仍是可被 decrypt 還原成相同明文的合法密文。
 */
const encCache = new Map<string, string>()

export function encrypt(plain: string): string {
  if (!plain) return plain
  if (!safeStorage.isEncryptionAvailable()) return plain
  const cached = encCache.get(plain)
  if (cached) return cached
  try {
    const enc = ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
    encCache.set(plain, enc)
    return enc
  } catch (e) {
    console.warn('[secureStore] encrypt failed, storing plaintext:', e)
    return plain
  }
}

export function decrypt(stored: string): string {
  if (!stored) return stored
  if (!stored.startsWith(ENC_PREFIX)) return stored
  const b64 = stored.slice(ENC_PREFIX.length)
  try {
    const plain = safeStorage.decryptString(Buffer.from(b64, 'base64'))
    // 種入快取：之後對同一明文加密時，直接沿用磁碟上既有密文，存檔零變動。
    encCache.set(plain, stored)
    return plain
  } catch (e) {
    // Happens after OS reinstall / account change — key is gone, prompt re-entry
    console.warn('[secureStore] decrypt failed (reinstall or account change?), returning encrypted value:', e)
    // IMPORTANT: Return the original encrypted value, not empty string!
    // Returning empty string permanently destroys the key. Better to keep the encrypted
    // value and let the user re-enter it in UI.
    return stored
  }
}
