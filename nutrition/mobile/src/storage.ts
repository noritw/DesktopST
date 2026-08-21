import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import type { StorageAdapter } from '@core/adapters'
import { base64ToBytes, bytesToBase64 } from '@core/util/base64'

function validateKey(key: string): string {
  const normalized = key.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`invalid nutrition storage key: ${key}`)
  }
  return normalized
}

export const nutritionMobileStorage: StorageAdapter = {
  async readJson<T>(key: string): Promise<T | null> {
    try {
      const { data } = await Filesystem.readFile({
        path: validateKey(key),
        directory: Directory.Data,
        encoding: Encoding.UTF8
      })
      return typeof data === 'string' ? JSON.parse(data) as T : null
    } catch {
      return null
    }
  },

  async writeJson(key: string, value: unknown): Promise<void> {
    await Filesystem.writeFile({
      path: validateKey(key),
      data: JSON.stringify(value, null, 2),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true
    })
  },

  async readBinary(key: string): Promise<Uint8Array | null> {
    try {
      const { data } = await Filesystem.readFile({ path: validateKey(key), directory: Directory.Data })
      return typeof data === 'string' ? base64ToBytes(data) : null
    } catch {
      return null
    }
  },

  async writeBinary(key: string, data: Uint8Array): Promise<void> {
    await Filesystem.writeFile({
      path: validateKey(key),
      data: bytesToBase64(data),
      directory: Directory.Data,
      recursive: true
    })
  },

  async exists(key: string): Promise<boolean> {
    try {
      await Filesystem.stat({ path: validateKey(key), directory: Directory.Data })
      return true
    } catch {
      return false
    }
  },

  async remove(key: string): Promise<void> {
    try {
      const path = validateKey(key)
      const stat = await Filesystem.stat({ path, directory: Directory.Data })
      if (stat.type === 'directory') {
        await Filesystem.rmdir({ path, directory: Directory.Data, recursive: true })
      } else {
        await Filesystem.deleteFile({ path, directory: Directory.Data })
      }
    } catch {
      // Missing files are already removed.
    }
  },

  async list(prefix: string): Promise<string[]> {
    const clean = validateKey(prefix).replace(/^\/+|\/+$/g, '')
    try {
      const { files } = await Filesystem.readdir({
        path: clean || '.',
        directory: Directory.Data
      })
      return files.map((file) => clean ? `${clean}/${file.name}` : file.name).sort()
    } catch {
      return []
    }
  }
}
