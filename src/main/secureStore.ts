import { safeStorage } from 'electron'

const ENC_PREFIX = 'enc:v1:'

export function encrypt(plain: string): string {
  if (!plain) return plain
  if (!safeStorage.isEncryptionAvailable()) return plain
  try {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
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
    return safeStorage.decryptString(Buffer.from(b64, 'base64'))
  } catch (e) {
    // Happens after OS reinstall / account change — key is gone, prompt re-entry
    console.warn('[secureStore] decrypt failed (reinstall or account change?), clearing key:', e)
    return ''
  }
}
