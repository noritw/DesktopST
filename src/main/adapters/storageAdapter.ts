import * as fs from 'fs'
import * as path from 'path'
import type { StorageAdapter, SyncStorageAdapter } from '../../core/adapters'
import { getDataDir } from '../fileStore'

/**
 * Electron 端的儲存 adapter。
 *
 * 把 core 用的平台無關 key（'personas/abc.json'）解析成資料夾底下的實際路徑。
 * 根目錄取自 `fileStore.getDataDir()`——**每次呼叫都重新取**，
 * 因為使用者可以在設定裡搬遷資料夾（`relocateDataDir`），不能在載入時就快取。
 *
 * 這一層是新增的並行路徑，現行 `fileStore.ts` 的行為完全沒有改動。
 */

function resolveKey(key: string): string {
  const normalized = key.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`invalid storage key: ${key}`)
  }
  return path.join(getDataDir(), ...normalized.split('/'))
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export const electronStorage: StorageAdapter & SyncStorageAdapter = {
  async readJson<T>(key: string): Promise<T | null> {
    return electronStorage.readJsonSync<T>(key)
  },

  async writeJson(key: string, value: unknown): Promise<void> {
    electronStorage.writeJsonSync(key, value)
  },

  async readBinary(key: string): Promise<Uint8Array | null> {
    const p = resolveKey(key)
    if (!fs.existsSync(p)) return null
    return fs.readFileSync(p)
  },

  async writeBinary(key: string, data: Uint8Array): Promise<void> {
    const p = resolveKey(key)
    ensureParentDir(p)
    fs.writeFileSync(p, data)
  },

  async exists(key: string): Promise<boolean> {
    return electronStorage.existsSync(key)
  },

  async remove(key: string): Promise<void> {
    const p = resolveKey(key)
    if (!fs.existsSync(p)) return
    fs.rmSync(p, { recursive: true, force: true })
  },

  async list(prefix: string): Promise<string[]> {
    const dir = resolveKey(prefix)
    if (!fs.existsSync(dir)) return []
    const clean = prefix.replace(/\\/g, '/').replace(/\/+$/, '')
    return fs.readdirSync(dir).map(name => (clean ? `${clean}/${name}` : name))
  },

  // ── 同步版（給既有桌面路徑沿用，手機端不實作）────────────────

  readJsonSync<T>(key: string): T | null {
    const p = resolveKey(key)
    if (!fs.existsSync(p)) return null
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as T
    } catch {
      return null
    }
  },

  writeJsonSync(key: string, value: unknown): void {
    const p = resolveKey(key)
    ensureParentDir(p)
    fs.writeFileSync(p, JSON.stringify(value, null, 2), 'utf-8')
  },

  existsSync(key: string): boolean {
    return fs.existsSync(resolveKey(key))
  }
}
