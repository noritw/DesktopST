import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StorageAdapter } from '@core/adapters'

const dataRoot = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'DeSTNutrition')
  : path.join(os.homedir(), 'AppData', 'Roaming', 'DeSTNutrition')

function resolveKey(key: string): string {
  const normalized = key.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`invalid nutrition storage key: ${key}`)
  }
  return path.join(dataRoot, ...normalized.split('/'))
}

async function ensureParent(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

export const nutritionDesktopStorage: StorageAdapter = {
  async readJson<T>(key: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(resolveKey(key), 'utf8')) as T
    } catch {
      return null
    }
  },

  async writeJson(key: string, value: unknown): Promise<void> {
    const filePath = resolveKey(key)
    await ensureParent(filePath)
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
  },

  async readBinary(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(resolveKey(key)))
    } catch {
      return null
    }
  },

  async writeBinary(key: string, data: Uint8Array): Promise<void> {
    const filePath = resolveKey(key)
    await ensureParent(filePath)
    await fs.writeFile(filePath, data)
  },

  async exists(key: string): Promise<boolean> {
    try {
      await fs.stat(resolveKey(key))
      return true
    } catch {
      return false
    }
  },

  async remove(key: string): Promise<void> {
    await fs.rm(resolveKey(key), { recursive: true, force: true })
  },

  async list(prefix: string): Promise<string[]> {
    try {
      const clean = prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      const entries = await fs.readdir(resolveKey(clean), { withFileTypes: true })
      return entries.map((entry) => clean ? `${clean}/${entry.name}` : entry.name).sort()
    } catch {
      return []
    }
  }
}
