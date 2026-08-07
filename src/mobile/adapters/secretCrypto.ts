import { gcm } from '@noble/ciphers/aes.js'
import { managedNonce, randomBytes } from '@noble/ciphers/utils.js'
import type { SecretAdapter } from '../../core/adapters'
import { SECRET_PREFIX } from '../../core/adapters'
import { bytesToBase64, base64ToBytes } from '../../core/util/base64'

export const MASTER_KEY_BYTES = 32

/** 產生一顆 AES-256 master key（獨立模式首次啟動用）。 */
export function generateMasterKey(): Uint8Array {
  return randomBytes(MASTER_KEY_BYTES)
}

/**
 * 用已解封的 master key 做成同步 `SecretAdapter`。
 *
 * 密文格式：`enc:v1:` + base64(nonce∥ciphertext∥tag)，與桌面前綴相同；
 * 密文本體不可跨裝置搬（key 綁在本機 Keystore／這顆 memory key）。
 *
 * 明文→密文快取比照桌面 `secureStore`：同一明文重複 encrypt 不換密文，
 * 避免無關存檔把 settings 無謂變動。
 */
export function createSecretAdapterFromKey(masterKey: Uint8Array): SecretAdapter {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error(`master key must be ${MASTER_KEY_BYTES} bytes`)
  }
  const aes = managedNonce(gcm)(masterKey)
  const encCache = new Map<string, string>()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  return {
    isAvailable(): boolean {
      return true
    },

    encrypt(plain: string): string {
      if (!plain) return plain
      const cached = encCache.get(plain)
      if (cached) return cached
      try {
        const ct = aes.encrypt(encoder.encode(plain))
        const stored = SECRET_PREFIX + bytesToBase64(ct)
        encCache.set(plain, stored)
        return stored
      } catch (e) {
        console.warn('[capacitorSecrets] encrypt failed, storing plaintext:', e)
        return plain
      }
    },

    decrypt(stored: string): string {
      if (!stored) return stored
      if (!stored.startsWith(SECRET_PREFIX)) return stored
      const b64 = stored.slice(SECRET_PREFIX.length)
      try {
        const plain = decoder.decode(aes.decrypt(base64ToBytes(b64)))
        encCache.set(plain, stored)
        return plain
      } catch (e) {
        console.warn(
          '[capacitorSecrets] decrypt failed (reinstall or key lost?), returning encrypted value:',
          e
        )
        // 與桌面相同：絕不可回空字串，否則永久毀掉金鑰。
        return stored
      }
    }
  }
}

/** 安全儲存不可用／尚未 init 時的 fallback（明文進出，並警告）。 */
export const unavailableSecrets: SecretAdapter = {
  isAvailable: () => false,
  encrypt: (plain) => {
    if (plain) console.warn('[capacitorSecrets] encryption unavailable; storing plaintext')
    return plain
  },
  decrypt: (stored) => stored
}
