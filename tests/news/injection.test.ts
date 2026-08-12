import { afterEach, describe, expect, it } from 'vitest'
import type { StorageAdapter } from '../../src/core/adapters/storage'
import type { HttpAdapter } from '../../src/core/adapters/http'
import type { ParsedFeed, RssParseAdapter } from '../../src/core/news/rssAdapter'
import type { NewsModuleSettings, NewsSource } from '../../src/core/news/types'
import { saveNewsModuleSettings, loadNewsModuleSettings } from '../../src/core/news/settings'
import { setActiveNewsTopic } from '../../src/core/news/topicState'
import { getNewsInjectionForSpeak, type NewsInjectionDeps } from '../../src/core/news/injection'

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

afterEach(() => {
  // 話題是 process 級單例，不同測試之間要清乾淨
  setActiveNewsTopic(null)
})

describe('core/news/injection — getNewsInjectionForSpeak', () => {
  it('模組停用時回 null', async () => {
    const storage = createStorage()
    const deps: NewsInjectionDeps = { http: fakeHttp, rss: fakeRss({ items: [] }), storage }
    const result = await getNewsInjectionForSpeak(deps)
    expect(result).toBeNull()
  })

  it('有釘住的話題時優先圍繞話題聊，不抽新', async () => {
    const storage = createStorage()
    await saveNewsModuleSettings(storage, { enabled: true } as Partial<NewsModuleSettings>)
    setActiveNewsTopic({ id: 't1', title: '話題標題', summary: '摘要', url: 'https://x', source: '來源' })
    const deps: NewsInjectionDeps = { http: fakeHttp, rss: fakeRss({ items: [] }), storage }
    const result = await getNewsInjectionForSpeak(deps)
    expect(result?.fromTopic).toBe(true)
    expect(result?.item).toBeNull()
    expect(result?.text).toContain('話題標題')
  })

  it('force=true 時忽略 speakButton 機率，抽中就記入 seenIds', async () => {
    const storage = createStorage()
    await saveNewsModuleSettings(storage, {
      enabled: true,
      speakButton: 'off',
      sources: [rssSource]
    } as Partial<NewsModuleSettings>)
    const deps: NewsInjectionDeps = {
      http: fakeHttp,
      storage,
      rss: fakeRss({
        title: '某新聞網',
        items: [{ title: '標題A', link: 'https://example.com/a', guid: 'a', pubDate: new Date().toUTCString() }]
      })
    }
    const result = await getNewsInjectionForSpeak(deps, { force: true })
    expect(result?.fromTopic).toBe(false)
    expect(result?.item?.title).toBe('標題A')
    expect(result?.text).toContain('標題A')
    expect(result?.directive).toContain('標題A')

    const settings = await loadNewsModuleSettings(storage)
    expect(settings.seenIds).toContain(result?.item?.id)
  })

  it('speakButton=off 且非 force 時不抽（回 null）', async () => {
    const storage = createStorage()
    await saveNewsModuleSettings(storage, {
      enabled: true,
      speakButton: 'off',
      sources: [rssSource]
    } as Partial<NewsModuleSettings>)
    const deps: NewsInjectionDeps = {
      http: fakeHttp,
      storage,
      rss: fakeRss({ items: [{ title: '標題A', link: 'https://example.com/a', guid: 'a' }] })
    }
    const result = await getNewsInjectionForSpeak(deps)
    expect(result).toBeNull()
  })
})
