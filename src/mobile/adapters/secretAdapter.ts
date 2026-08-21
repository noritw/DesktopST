import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { Capacitor } from '@capacitor/core'
import type { SecretAdapter } from '../../core/adapters'
import { bytesToBase64, base64ToBytes } from '../../core/util/base64'
import {
  createSecretAdapterFromKey,
  generateMasterKey,
  unavailableSecrets
} from './secretCrypto'

const KEY_PREFIX = 'dest_'
const MASTER_KEY_ID = 'master-key-v1'

let impl: SecretAdapter = unavailableSecrets
let initPromise: Promise<SecretAdapter> | null = null

/**
 * Capacitor 端的金鑰 adapter。
 *
 * `SecretAdapter` 必須是**同步**的（對齊 `core/store/settings`），
 * 但 Keystore 外掛是 async KV。做法：
 * 1. `initCapacitorSecrets()` 從 SecureStorage 讀／產生 master key，快取進記憶體
 * 2. 之後 `encrypt`／`decrypt` 用 AES-GCM（`@noble/ciphers`）同步跑
 * 3. 密文仍以 `enc:v1:` 寫進 settings.json（走 StorageAdapter），不是把 API Key 直接塞 KV
 *
 * 呼叫端（W2 獨立啟動）必須在碰 settings 之前 await `initCapacitorSecrets()`。
 */
export const capacitorSecrets: SecretAdapter = {
  isAvailable(): boolean {
    return impl.isAvailable()
  },
  encrypt(plain: string): string {
    return impl.encrypt(plain)
  },
  decrypt(stored: string): string {
    return impl.decrypt(stored)
  }
}

/**
 * 解封或建立 master key。可重入；並行呼叫會共用同一個 Promise。
 */
export function initCapacitorSecrets(): Promise<SecretAdapter> {
  if (impl.isAvailable()) return Promise.resolve(impl)
  if (initPromise) return initPromise
  initPromise = doInit().finally(() => {
    initPromise = null
  })
  return initPromise
}

async function doInit(): Promise<SecretAdapter> {
  // 網頁遙控模式不該走到這裡；若誤呼叫，保持 unavailable（明文 fallback）。
  if (!Capacitor.isNativePlatform()) {
    console.warn('[capacitorSecrets] not a native platform; encryption unavailable')
    impl = unavailableSecrets
    return impl
  }

  try {
    await SecureStorage.setKeyPrefix(KEY_PREFIX)
    const existing = await SecureStorage.get(MASTER_KEY_ID)
    let keyBytes: Uint8Array
    if (typeof existing === 'string' && existing.length > 0) {
      keyBytes = base64ToBytes(existing)
      if (keyBytes.length !== 32) {
        console.warn('[capacitorSecrets] stored master key length unexpected; rotating')
        keyBytes = generateMasterKey()
        await SecureStorage.set(MASTER_KEY_ID, bytesToBase64(keyBytes))
      }
    } else {
      keyBytes = generateMasterKey()
      await SecureStorage.set(MASTER_KEY_ID, bytesToBase64(keyBytes))
    }
    impl = createSecretAdapterFromKey(keyBytes)
    return impl
  } catch (e) {
    console.warn('[capacitorSecrets] init failed; encryption unavailable:', e)
    impl = unavailableSecrets
    return impl
  }
}

/** 測試用：直接注入已解封的 adapter（略過 SecureStorage）。 */
export function setCapacitorSecretsForTests(next: SecretAdapter): void {
  impl = next
}
