import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import type { StorageAdapter } from '../../core/adapters'
import { base64ToBytes, bytesToBase64 } from '../../core/util/base64'
import { assertValidStorageKey, cleanPrefix } from './storageKey'

const DIR = Directory.Data

/**
 * Capacitor 端的儲存 adapter。
 *
 * key 佈局與桌面相同（`settings.json`、`characters/<id>/card.json`…），
 * 根目錄是 Android／iOS 的 app 資料目錄（`Directory.Data`）。
 * **不實作** `SyncStorageAdapter`（Filesystem 只有非同步 API）。
 */
export const capacitorStorage: StorageAdapter = {
  async readJson<T>(key: string): Promise<T | null> {
    const path = assertValidStorageKey(key)
    try {
      const { data } = await Filesystem.readFile({
        path,
        directory: DIR,
        encoding: Encoding.UTF8
      })
      if (typeof data !== 'string') return null
      return JSON.parse(data) as T
    } catch {
      return null
    }
  },

  async writeJson(key: string, value: unknown): Promise<void> {
    const path = assertValidStorageKey(key)
    await Filesystem.writeFile({
      path,
      data: JSON.stringify(value, null, 2),
      directory: DIR,
      encoding: Encoding.UTF8,
      recursive: true
    })
  },

  async readBinary(key: string): Promise<Uint8Array | null> {
    const path = assertValidStorageKey(key)
    try {
      const { data } = await Filesystem.readFile({ path, directory: DIR })
      if (typeof data !== 'string') return null
      return base64ToBytes(data)
    } catch {
      return null
    }
  },

  async writeBinary(key: string, data: Uint8Array): Promise<void> {
    const path = assertValidStorageKey(key)
    await Filesystem.writeFile({
      path,
      data: bytesToBase64(data),
      directory: DIR,
      recursive: true
    })
  },

  async exists(key: string): Promise<boolean> {
    const path = assertValidStorageKey(key)
    try {
      await Filesystem.stat({ path, directory: DIR })
      return true
    } catch {
      return false
    }
  },

  async remove(key: string): Promise<void> {
    const path = assertValidStorageKey(key)
    try {
      const stat = await Filesystem.stat({ path, directory: DIR })
      if (stat.type === 'directory') {
        await Filesystem.rmdir({ path, directory: DIR, recursive: true })
      } else {
        await Filesystem.deleteFile({ path, directory: DIR })
      }
    } catch {
      // 不存在就當已刪
    }
  },

  async list(prefix: string): Promise<string[]> {
    const clean = cleanPrefix(prefix)
    try {
      const { files } = await Filesystem.readdir({
        path: clean || '.',
        directory: DIR
      })
      return files
        .map((f) => (clean ? `${clean}/${f.name}` : f.name))
        .sort()
    } catch {
      return []
    }
  }
}
