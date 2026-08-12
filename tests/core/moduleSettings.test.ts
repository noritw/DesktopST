import { describe, expect, it } from 'vitest'
import type { StorageAdapter, SyncStorageAdapter } from '../../src/core/adapters/storage'
import {
  hasModuleData,
  hasModuleDataSync,
  hasModuleSettings,
  hasModuleSettingsSync,
  moduleDataKey,
  moduleSettingsKey,
  readModuleData,
  readModuleDataSync,
  readModuleSettings,
  readModuleSettingsSync,
  writeModuleData,
  writeModuleDataSync,
  writeModuleSettings,
  writeModuleSettingsSync
} from '../../src/core/store/moduleSettings'

function createSyncStorage(): SyncStorageAdapter & { files: Map<string, unknown> } {
  const files = new Map<string, unknown>()
  return {
    files,
    readJsonSync<T>(key: string): T | null {
      return files.has(key) ? (files.get(key) as T) : null
    },
    writeJsonSync(key: string, value: unknown): void {
      files.set(key, value)
    },
    existsSync(key: string): boolean {
      return files.has(key)
    },
    readTextSync(key: string): string | null {
      return files.has(key) ? JSON.stringify(files.get(key)) : null
    },
    listSync(): string[] {
      return [...files.keys()]
    },
    removeSync(key: string): void {
      files.delete(key)
    }
  }
}

function createAsyncStorage(): StorageAdapter & { files: Map<string, unknown> } {
  const files = new Map<string, unknown>()
  return {
    files,
    async readJson<T>(key: string): Promise<T | null> {
      return files.has(key) ? (files.get(key) as T) : null
    },
    async writeJson(key: string, value: unknown): Promise<void> {
      files.set(key, value)
    },
    async readBinary(): Promise<Uint8Array | null> {
      return null
    },
    async writeBinary(): Promise<void> {},
    async exists(key: string): Promise<boolean> {
      return files.has(key)
    },
    async remove(key: string): Promise<void> {
      files.delete(key)
    },
    async list(): Promise<string[]> {
      return [...files.keys()]
    }
  }
}

describe('core/store/moduleSettings — key 佈局', () => {
  it('settings key 形如 modules/<moduleId>/settings.json', () => {
    expect(moduleSettingsKey('desktopst.news')).toBe('modules/desktopst.news/settings.json')
  })

  it('data key 形如 modules/<moduleId>/<fileName>', () => {
    expect(moduleDataKey('desktopst.news', 'reader-state.json')).toBe('modules/desktopst.news/reader-state.json')
  })
})

describe('core/store/moduleSettings — 同步版（桌面）', () => {
  it('沒寫過時 has 為 false、read 回 undefined', () => {
    const storage = createSyncStorage()
    expect(hasModuleSettingsSync(storage, 'desktopst.news')).toBe(false)
    expect(readModuleSettingsSync(storage, 'desktopst.news')).toBeUndefined()
  })

  it('write 之後可以用同一個 key 讀回來', () => {
    const storage = createSyncStorage()
    writeModuleSettingsSync(storage, 'desktopst.news', { enabled: true })
    expect(hasModuleSettingsSync(storage, 'desktopst.news')).toBe(true)
    expect(readModuleSettingsSync(storage, 'desktopst.news')).toEqual({ enabled: true })
    expect(storage.files.has('modules/desktopst.news/settings.json')).toBe(true)
  })

  it('moduleData 與 settings.json 各自獨立', () => {
    const storage = createSyncStorage()
    writeModuleSettingsSync(storage, 'desktopst.news', { enabled: true })
    writeModuleDataSync(storage, 'desktopst.news', 'reader-state.json', { pinned: ['a'] })
    expect(hasModuleDataSync(storage, 'desktopst.news', 'reader-state.json')).toBe(true)
    expect(readModuleDataSync(storage, 'desktopst.news', 'reader-state.json')).toEqual({ pinned: ['a'] })
    // 沒動到 settings.json
    expect(readModuleSettingsSync(storage, 'desktopst.news')).toEqual({ enabled: true })
  })
})

describe('core/store/moduleSettings — 非同步版（手機）', () => {
  it('write 之後可以讀回來，key 與同步版一致', async () => {
    const storage = createAsyncStorage()
    await writeModuleSettings(storage, 'desktopst.news', { enabled: true })
    expect(await hasModuleSettings(storage, 'desktopst.news')).toBe(true)
    await expect(readModuleSettings(storage, 'desktopst.news')).resolves.toEqual({ enabled: true })
    expect(storage.files.has('modules/desktopst.news/settings.json')).toBe(true)
  })

  it('moduleData 與 settings.json 各自獨立', async () => {
    const storage = createAsyncStorage()
    await writeModuleData(storage, 'desktopst.news', 'reader-state.json', { pinned: ['a'] })
    expect(await hasModuleData(storage, 'desktopst.news', 'reader-state.json')).toBe(true)
    await expect(readModuleData(storage, 'desktopst.news', 'reader-state.json')).resolves.toEqual({ pinned: ['a'] })
    expect(await hasModuleSettings(storage, 'desktopst.news')).toBe(false)
  })
})
