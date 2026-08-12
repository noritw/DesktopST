import { describe, expect, it } from 'vitest'
import type { StorageAdapter, SyncStorageAdapter } from '../../src/core/adapters/storage'
import type { NewsItem } from '../../src/core/news/types'
import {
  hasNewsReaderState,
  hasNewsReaderStateSync,
  loadNewsReaderState,
  loadNewsReaderStateSync,
  saveNewsReaderDismissed,
  saveNewsReaderDismissedSync,
  saveNewsReaderPinned,
  saveNewsReaderPinnedSync,
  saveNewsReaderStateSync
} from '../../src/core/news/readerState'

function createSyncStorage(): SyncStorageAdapter {
  const files = new Map<string, unknown>()
  return {
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

function createAsyncStorage(): StorageAdapter {
  const files = new Map<string, unknown>()
  return {
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

const item = (id: string): NewsItem => ({
  id,
  title: `title-${id}`,
  summary: '',
  source: 'src',
  tags: [],
  url: `https://example.com/${id}`,
  publishedAt: '',
  sourceId: 's1',
  sourceType: 'rss',
  sourceWeight: 'normal'
})

describe('core/news/readerState — 同步版（桌面）', () => {
  it('沒寫過時 has 為 false，read 回空狀態', () => {
    const storage = createSyncStorage()
    expect(hasNewsReaderStateSync(storage)).toBe(false)
    expect(loadNewsReaderStateSync(storage)).toEqual({ pinnedItems: [], dismissedIds: [] })
  })

  it('釘選與不看了各自獨立寫入、互不覆蓋', () => {
    const storage = createSyncStorage()
    saveNewsReaderPinnedSync(storage, [item('a')])
    saveNewsReaderDismissedSync(storage, ['b'])
    const state = loadNewsReaderStateSync(storage)
    expect(state.pinnedItems.map(i => i.id)).toEqual(['a'])
    expect(state.dismissedIds).toEqual(['b'])
    expect(hasNewsReaderStateSync(storage)).toBe(true)
  })

  it('dismissedIds 超過上限只保留最後 500 筆', () => {
    const storage = createSyncStorage()
    const many = Array.from({ length: 510 }, (_, i) => `id-${i}`)
    saveNewsReaderDismissedSync(storage, many)
    const state = loadNewsReaderStateSync(storage)
    expect(state.dismissedIds).toHaveLength(500)
    expect(state.dismissedIds[0]).toBe('id-10')
  })

  it('saveNewsReaderStateSync 兩項一起寫，未帶的欄位維持原值', () => {
    const storage = createSyncStorage()
    saveNewsReaderPinnedSync(storage, [item('a')])
    saveNewsReaderStateSync(storage, { dismissedIds: ['x'] })
    const state = loadNewsReaderStateSync(storage)
    expect(state.pinnedItems.map(i => i.id)).toEqual(['a'])
    expect(state.dismissedIds).toEqual(['x'])
  })
})

describe('core/news/readerState — 非同步版（手機），key 與同步版一致', () => {
  it('釘選寫入後讀得回來', async () => {
    const storage = createAsyncStorage()
    await saveNewsReaderPinned(storage, [item('a')])
    await expect(hasNewsReaderState(storage)).resolves.toBe(true)
    const state = await loadNewsReaderState(storage)
    expect(state.pinnedItems.map(i => i.id)).toEqual(['a'])
  })

  it('不看了寫入不影響釘選', async () => {
    const storage = createAsyncStorage()
    await saveNewsReaderPinned(storage, [item('a')])
    await saveNewsReaderDismissed(storage, ['b'])
    const state = await loadNewsReaderState(storage)
    expect(state.pinnedItems.map(i => i.id)).toEqual(['a'])
    expect(state.dismissedIds).toEqual(['b'])
  })
})
