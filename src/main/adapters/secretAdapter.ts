import type { SecretAdapter } from '../../core/adapters'
import { safeStorage } from 'electron'
import { encrypt, decrypt } from '../secureStore'

/**
 * Electron 端的金鑰 adapter。
 *
 * 直接沿用現行 `secureStore.ts`（含它的密文快取與「解密失敗回傳原密文」保護），
 * 這裡只是把它套進 core 的介面形狀，**沒有重寫任何加解密邏輯**。
 */
export const electronSecrets: SecretAdapter = {
  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  },
  encrypt,
  decrypt
}
