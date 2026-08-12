import { describe, expect, it } from 'vitest'
import type { StorageAdapter } from '../../src/core/adapters/storage'
import type { HttpAdapter } from '../../src/core/adapters/http'
import type { ParsedFeed, RssParseAdapter } from '../../src/core/news/rssAdapter'
import type { NewsModuleSettings, NewsSource } from '../../src/core/news/types'
import { saveNewsModuleSettings } from '../../src/core/news/settings'
import {
  fetchReaderBatch,
  fetchReaderSection,
  setReaderQuota,
  setReaderSourceOrder,
  type ReaderFetchDeps
} from '../../src/core/news/readerFetch'

function createStorage(): StorageAdapter {
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

/** http 不實際用到（rss adapter 直接回解析好的 feed），但形狀要對得上 HttpAdapter。 */
const fakeHttp: HttpAdapter = {
  fetch: (async () => new Response('<rss></rss>', { status: 200 })) as typeof globalThis.fetch,
  supportsStreaming: true
}

function fakeRss(feed: ParsedFeed): RssParseAdapter {
  return {
    async parseFeed() {
      return feed
    },
    async parseTrendsFeed() {
      return { items: [] }
    }
  }
}

const rssSource: NewsSource = {
  id: 'feed-1',
  type: 'rss',
  label: '某新聞網',
  url: 'https://example.com/rss',
  weight: 'normal',
  enabled: true
}

describe('core/news/readerFetch — 批次／單欄抓取', () => {
  it('新聞模組未啟用時回正常拒絕，不是連線錯誤', async () => {
    const deps: ReaderFetchDeps = { http: fakeHttp, rss: fakeRss({ items: [] }), storage: createStorage() }
    const result = await fetchReaderBatch(deps)
    expect(result).toEqual({ ok: false, error: '新聞模組尚未啟用' })
  })

  it('啟用後抓得到來源的新聞，快照欄位齊全', async () => {
    const storage = createStorage()
    await saveNewsModuleSettings(storage, { enabled: true, sources: [rssSource] } as Partial<NewsModuleSettings>)
    const deps: ReaderFetchDeps = {
      http: fakeHttp,
      storage,
      rss: fakeRss({
        title: '某新聞網',
        items: [{ title: '標題A', link: 'https://example.com/a', guid: 'a', pubDate: new Date().toUTCString() }]
      })
    }
    const result = await fetchReaderBatch(deps)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.items.map(i => i.title)).toEqual(['標題A'])
    expect(result.sources.map(s => s.id)).toEqual(['feed-1'])
    expect(result.readerMaxItems).toBe(30)
  })

  it('fetchSection 用 feed: 字首抓單一 RSS 來源', async () => {
    const storage = createStorage()
    await saveNewsModuleSettings(storage, { enabled: true, sources: [rssSource] } as Partial<NewsModuleSettings>)
    const deps: ReaderFetchDeps = {
      http: fakeHttp,
      storage,
      rss: fakeRss({
        items: [{ title: '標題B', link: 'https://example.com/b', guid: 'b', pubDate: new Date().toUTCString() }]
      })
    }
    const result = await fetchReaderSection(deps, { sectionGroupId: 'feed:feed-1' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.sectionGroupId).toBe('feed:feed-1')
    expect(result.items.map(i => i.title)).toEqual(['標題B'])
  })

  it('fetchSection 找不到來源時回錯誤而不是丟例外', async () => {
    const storage = createStorage()
    await saveNewsModuleSettings(storage, { enabled: true, sources: [] } as Partial<NewsModuleSettings>)
    const deps: ReaderFetchDeps = { http: fakeHttp, storage, rss: fakeRss({ items: [] }) }
    const result = await fetchReaderSection(deps, { sectionGroupId: 'feed:nope' })
    expect(result).toEqual({ ok: false, error: '找不到此訂閱來源' })
  })
})

describe('core/news/readerFetch — setReaderQuota／setReaderSourceOrder', () => {
  it('setReaderQuota 改熱門配額後存檔生效', async () => {
    const storage = createStorage()
    await saveNewsModuleSettings(storage, { enabled: true, breakout: { enabled: true, weight: 'normal', zhOnly: true } } as Partial<NewsModuleSettings>)
    const deps: ReaderFetchDeps = { http: fakeHttp, storage, rss: fakeRss({ items: [] }) }
    const result = await setReaderQuota(deps, '__breakout__', 7)
    // __breakout__ 沒有實際來源可抓，回的是「熱門話題未啟用」以外的正常結果或空清單皆可，
    // 這裡只驗證設定真的被存下來
    expect(result.ok).toBe(true)
    const settings = await import('../../src/core/news/settings').then(m => m.loadNewsModuleSettings(storage))
    expect(settings.readerBreakoutQuota).toBe(7)
  })

  it('setReaderSourceOrder 依傳入順序排列，沒列到的接在後面', async () => {
    const storage = createStorage()
    const sources: NewsSource[] = [
      { ...rssSource, id: 'a' },
      { ...rssSource, id: 'b' },
      { ...rssSource, id: 'c' }
    ]
    await saveNewsModuleSettings(storage, { enabled: true, sources } as Partial<NewsModuleSettings>)
    const deps: ReaderFetchDeps = { http: fakeHttp, storage, rss: fakeRss({ items: [] }) }
    const reordered = await setReaderSourceOrder(deps, ['c', 'a'])
    expect(reordered.map(s => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('setReaderSourceOrder 傳入不存在的 id 會被忽略，其餘來源維持原順序', async () => {
    const storage = createStorage()
    await saveNewsModuleSettings(storage, { enabled: true, sources: [rssSource] } as Partial<NewsModuleSettings>)
    const deps: ReaderFetchDeps = { http: fakeHttp, storage, rss: fakeRss({ items: [] }) }
    const reordered = await setReaderSourceOrder(deps, ['not-exist'])
    expect(reordered.map(s => s.id)).toEqual(['feed-1'])
  })
})
