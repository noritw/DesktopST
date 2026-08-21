import type { StorageAdapter } from '../../core/adapters'
import { assertValidStorageKey, cleanPrefix } from './storageKey'

/**
 * 記憶體版 `StorageAdapter`——給契約測試與不碰 Capacitor 的驗證用。
 * 行為對齊檔案系統語意（含子路徑 list／遞迴 remove）。
 */
export function createMemoryStorage(): StorageAdapter {
  const files = new Map<string, Uint8Array>()

  const textEncoder = new TextEncoder()
  const textDecoder = new TextDecoder()

  function listKeysUnder(prefix: string): string[] {
    const clean = cleanPrefix(prefix)
    const out: string[] = []
    const seen = new Set<string>()
    for (const key of files.keys()) {
      if (clean && key !== clean && !key.startsWith(clean + '/')) continue
      const rest = clean ? key.slice(clean.length + 1) : key
      if (!rest) continue
      const first = rest.split('/')[0]
      const entry = clean ? `${clean}/${first}` : first
      if (!seen.has(entry)) {
        seen.add(entry)
        out.push(entry)
      }
    }
    return out.sort()
  }

  return {
    async readJson<T>(key: string): Promise<T | null> {
      const k = assertValidStorageKey(key)
      const raw = files.get(k)
      if (!raw) return null
      try {
        return JSON.parse(textDecoder.decode(raw)) as T
      } catch {
        return null
      }
    },

    async writeJson(key: string, value: unknown): Promise<void> {
      const k = assertValidStorageKey(key)
      files.set(k, textEncoder.encode(JSON.stringify(value, null, 2)))
    },

    async readBinary(key: string): Promise<Uint8Array | null> {
      const k = assertValidStorageKey(key)
      const raw = files.get(k)
      return raw ? new Uint8Array(raw) : null
    },

    async writeBinary(key: string, data: Uint8Array): Promise<void> {
      const k = assertValidStorageKey(key)
      files.set(k, new Uint8Array(data))
    },

    async exists(key: string): Promise<boolean> {
      const k = assertValidStorageKey(key)
      if (files.has(k)) return true
      // 目錄語意：底下有任何檔就算存在
      for (const f of files.keys()) {
        if (f.startsWith(k + '/')) return true
      }
      return false
    },

    async remove(key: string): Promise<void> {
      const k = assertValidStorageKey(key)
      files.delete(k)
      for (const f of [...files.keys()]) {
        if (f.startsWith(k + '/')) files.delete(f)
      }
    },

    async list(prefix: string): Promise<string[]> {
      return listKeysUnder(prefix)
    }
  }
}
