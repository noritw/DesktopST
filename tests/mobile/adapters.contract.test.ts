import { describe, expect, it } from 'vitest'
import { SECRET_PREFIX } from '@core/adapters'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import {
  createSecretAdapterFromKey,
  generateMasterKey,
  unavailableSecrets
} from '../../src/mobile/adapters/secretCrypto'
import { assertValidStorageKey } from '../../src/mobile/adapters/storageKey'
import { capacitorHttp } from '../../src/mobile/adapters/httpAdapter'

describe('mobile adapters contract', () => {
  describe('storageKey', () => {
    it('rejects absolute and .. keys', () => {
      expect(() => assertValidStorageKey('/settings.json')).toThrow(/invalid/)
      expect(() => assertValidStorageKey('a/../b')).toThrow(/invalid/)
    })

    it('normalizes backslashes', () => {
      expect(assertValidStorageKey('characters\\id\\card.json')).toBe(
        'characters/id/card.json'
      )
    })
  })

  describe('memory StorageAdapter', () => {
    it('round-trips json and binary; list and remove work', async () => {
      const storage = createMemoryStorage()

      await storage.writeJson('settings.json', { llm: { provider: 'gemini' } })
      expect(await storage.readJson<{ llm: { provider: string } }>('settings.json')).toEqual({
        llm: { provider: 'gemini' }
      })

      const bytes = new Uint8Array([1, 2, 3, 250])
      await storage.writeBinary('characters/c1/avatar.png', bytes)
      expect(await storage.readBinary('characters/c1/avatar.png')).toEqual(bytes)
      expect(await storage.exists('characters/c1/avatar.png')).toBe(true)

      await storage.writeJson('characters/c1/card.json', { id: 'c1', name: 'A' })
      await storage.writeJson('characters/c2/card.json', { id: 'c2', name: 'B' })
      expect(await storage.list('characters')).toEqual(['characters/c1', 'characters/c2'])

      await storage.remove('characters/c1')
      expect(await storage.exists('characters/c1/card.json')).toBe(false)
      expect(await storage.exists('characters/c1/avatar.png')).toBe(false)
      expect(await storage.list('characters')).toEqual(['characters/c2'])

      expect(await storage.readJson('missing.json')).toBeNull()
      expect(await storage.list('personas')).toEqual([])
    })
  })

  describe('SecretAdapter (master-key AES)', () => {
    it('encrypts with enc:v1 prefix and decrypts back', () => {
      const secrets = createSecretAdapterFromKey(generateMasterKey())
      expect(secrets.isAvailable()).toBe(true)

      const plain = 'sk-test-key-你好'
      const enc = secrets.encrypt(plain)
      expect(enc.startsWith(SECRET_PREFIX)).toBe(true)
      expect(enc).not.toContain(plain)
      expect(secrets.decrypt(enc)).toBe(plain)
    })

    it('caches encrypt so same plaintext yields same ciphertext', () => {
      const secrets = createSecretAdapterFromKey(generateMasterKey())
      const a = secrets.encrypt('same')
      const b = secrets.encrypt('same')
      expect(a).toBe(b)
    })

    it('returns original ciphertext when decrypt fails', () => {
      const a = createSecretAdapterFromKey(generateMasterKey())
      const b = createSecretAdapterFromKey(generateMasterKey())
      const enc = a.encrypt('secret')
      expect(b.decrypt(enc)).toBe(enc)
    })

    it('leaves non-prefixed values alone', () => {
      const secrets = createSecretAdapterFromKey(generateMasterKey())
      expect(secrets.decrypt('plaintext-legacy')).toBe('plaintext-legacy')
    })

    it('unavailable fallback passes through', () => {
      expect(unavailableSecrets.isAvailable()).toBe(false)
      expect(unavailableSecrets.encrypt('x')).toBe('x')
      expect(unavailableSecrets.decrypt(SECRET_PREFIX + 'abc')).toBe(SECRET_PREFIX + 'abc')
    })
  })

  describe('HttpAdapter', () => {
    it('declares no streaming support', () => {
      expect(capacitorHttp.supportsStreaming).toBe(false)
      expect(typeof capacitorHttp.fetch).toBe('function')
    })
  })
})
