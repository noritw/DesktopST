import { describe, expect, it } from 'vitest'
import type { HttpAdapter } from '../../src/core/adapters/http'
import type { ParsedFeed, RssParseAdapter } from '../../src/core/news/rssAdapter'
import type { NewsModuleSettings } from '../../src/core/news/types'
import { DEFAULT_KEYWORD_GROUP_ID } from '../../src/core/news/keywordGroups'
import {
  shouldTriggerSearch,
  searchGoogleNewsRss,
  buildConversationSearchInjection,
  getConversationSearchContext,
  type ConversationSearchDeps
} from '../../src/core/news/conversationSearch'
import { makeSettings } from '../fixtures'

/**
 * 對話新聞搜尋（B1 抽 core，桌面搬手機獨立版，2026-08-22）。
 * 邏輯是桌面 `main/modules/news/conversationSearch.ts` 逐字搬過來，只換掉
 * `rss-parser`／`chatWithLLM` 的平台耦合，這裡驗的是搬過程沒有跑掉行為。
 */

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

function makeNewsSettings(over: Partial<NewsModuleSettings['conversationSearch']> = {}): NewsModuleSettings {
  return {
    enabled: true,
    sources: [],
    keywordGroups: [{ id: DEFAULT_KEYWORD_GROUP_ID, name: '預設組' }],
    blacklist: [],
    excludedCategories: [],
    excludedSources: [],
    reducedSources: [],
    langMode: 'translate',
    speakButton: 'sometimes',
    replyModel: 'main',
    reminder: { enabled: false },
    breakout: { enabled: false, weight: 'normal', zhOnly: true },
    localNews: { enabled: false, locations: [] },
    feedback: { adjustments: {} },
    seenIds: [],
    maxAgeDays: 30,
    enrichForChat: true,
    conversationSearch: { enabled: true, triggerWords: ['新聞', '最近'], maxAgeHours: 48, ...over }
  } as NewsModuleSettings
}

describe('shouldTriggerSearch', () => {
  it('空 triggerWords 視為不過濾，一律送', () => {
    expect(shouldTriggerSearch('隨便聊聊天氣', [])).toBe(true)
  })

  it('含任一觸發詞才過關', () => {
    expect(shouldTriggerSearch('最近有什麼新聞嗎', ['新聞', '事件'])).toBe(true)
    expect(shouldTriggerSearch('今天天氣真好', ['新聞', '事件'])).toBe(false)
  })
})

describe('searchGoogleNewsRss', () => {
  const fakeHttp: HttpAdapter = {
    fetch: (async () => new Response('<rss></rss>', { status: 200 })) as typeof globalThis.fetch,
    supportsStreaming: true
  }

  it('拆出「標題 - 媒體」格式，並從 content 抽相關標題當摘要（排除主標題）', async () => {
    const deps: ConversationSearchDeps = {
      http: fakeHttp,
      rss: fakeRss({
        items: [
          {
            title: '某地發生地震 - 中央社',
            link: 'https://example.com/a',
            isoDate: new Date().toISOString(),
            content: '<ol><li><a>某地發生地震</a></li><li><a>氣象署：規模5.2</a></li><li><a>民眾：搖很久</a></li></ol>'
          }
        ]
      })
    }
    const items = await searchGoogleNewsRss(deps, '地震', 48)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('某地發生地震')
    expect(items[0].source).toBe('中央社')
    expect(items[0].summary).toBe('氣象署：規模5.2／民眾：搖很久')
  })

  it('最多回 3 則，超過的部分不收', async () => {
    const now = new Date().toISOString()
    const deps: ConversationSearchDeps = {
      http: fakeHttp,
      rss: fakeRss({
        items: Array.from({ length: 5 }, (_, i) => ({
          title: `標題${i} - 某報`,
          link: `https://example.com/${i}`,
          isoDate: now
        }))
      })
    }
    const items = await searchGoogleNewsRss(deps, 'q', 48)
    expect(items).toHaveLength(3)
  })

  it('maxAgeHours 篩掉太舊的文章；0 表示不限制', async () => {
    const old = new Date(Date.now() - 100 * 3600000).toISOString()
    const fresh = new Date().toISOString()
    const deps: ConversationSearchDeps = {
      http: fakeHttp,
      rss: fakeRss({
        items: [
          { title: '舊聞 - 某報', link: 'https://example.com/old', isoDate: old },
          { title: '新聞 - 某報', link: 'https://example.com/new', isoDate: fresh }
        ]
      })
    }
    const filtered = await searchGoogleNewsRss(deps, 'q', 48)
    expect(filtered.map(i => i.title)).toEqual(['新聞'])

    const unfiltered = await searchGoogleNewsRss(deps, 'q', 0)
    expect(unfiltered.map(i => i.title)).toEqual(['舊聞', '新聞'])
  })

  it('抓取失敗回空陣列，不丟例外', async () => {
    const failingHttp: HttpAdapter = {
      fetch: (async () => { throw new Error('network down') }) as unknown as typeof globalThis.fetch,
      supportsStreaming: true
    }
    const deps: ConversationSearchDeps = { http: failingHttp, rss: fakeRss({ items: [] }) }
    await expect(searchGoogleNewsRss(deps, 'q', 48)).resolves.toEqual([])
  })
})

describe('buildConversationSearchInjection', () => {
  it('沒有結果時回 null，不注入空區塊', () => {
    expect(buildConversationSearchInjection('地震', [])).toBeNull()
  })

  it('組出帶標題、來源、摘要的區塊', () => {
    const text = buildConversationSearchInjection('地震', [
      { title: '某地發生地震', summary: '規模5.2／搖晃時間約10秒', source: '中央社', publishedAt: new Date().toISOString() }
    ])
    expect(text).toContain('[Conversation search: 地震]')
    expect(text).toContain('1. 某地發生地震')
    expect(text).toContain('中央社')
    expect(text).toContain('規模5.2／搖晃時間約10秒')
  })

  it('摘要超過 60 字要裁切並加刪節號', () => {
    const longSummary = 'A'.repeat(80)
    const text = buildConversationSearchInjection('q', [
      { title: 't', summary: longSummary, source: 's', publishedAt: '' }
    ])
    expect(text).toContain('A'.repeat(60) + '…')
    expect(text).not.toContain('A'.repeat(61))
  })
})

describe('getConversationSearchContext（整條流程）', () => {
  /** 攔下送出去的 request：LLM 走 Responses API 端點，其餘視為 RSS fetch。 */
  function stubDeps(opts: { llmReply: string; rssFeed: ParsedFeed }): ConversationSearchDeps {
    const fetch = (async (input: unknown) => {
      const url = String(input)
      if (url.includes('news.google.com')) {
        return new Response('<rss></rss>', { status: 200 })
      }
      return new Response(
        JSON.stringify({ output_text: opts.llmReply, usage: { input_tokens: 10, output_tokens: 3 } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    }) as unknown as typeof globalThis.fetch
    return { http: { fetch, supportsStreaming: false }, rss: fakeRss(opts.rssFeed) }
  }

  it('模組關閉時直接跳過，不打任何請求', async () => {
    let called = false
    const deps: ConversationSearchDeps = {
      http: { fetch: (async () => { called = true; return new Response('') }) as unknown as typeof globalThis.fetch, supportsStreaming: false },
      rss: fakeRss({ items: [] })
    }
    const result = await getConversationSearchContext(deps, '最近有新聞嗎', makeSettings(), makeNewsSettings({ enabled: false }))
    expect(result.context).toBeNull()
    expect(called).toBe(false)
  })

  it('未命中觸發詞時跳過，不打任何請求', async () => {
    let called = false
    const deps: ConversationSearchDeps = {
      http: { fetch: (async () => { called = true; return new Response('') }) as unknown as typeof globalThis.fetch, supportsStreaming: false },
      rss: fakeRss({ items: [] })
    }
    const result = await getConversationSearchContext(deps, '今天天氣真好', makeSettings(), makeNewsSettings())
    expect(result.context).toBeNull()
    expect(called).toBe(false)
  })

  it('LLM 判斷不是時事（回 null）時不搜尋，仍帶回 debugPrompt', async () => {
    const deps = stubDeps({ llmReply: 'null', rssFeed: { items: [] } })
    const result = await getConversationSearchContext(deps, '最近心情不太好', makeSettings(), makeNewsSettings())
    expect(result.context).toBeNull()
    expect(result.debugPrompt).toBeTruthy()
  })

  it('LLM 給出查詢詞時去搜 RSS 並組出注入字串', async () => {
    const deps = stubDeps({
      llmReply: '地震 規模',
      rssFeed: {
        items: [
          { title: '某地發生地震 - 中央社', link: 'https://example.com/a', isoDate: new Date().toISOString() }
        ]
      }
    })
    const result = await getConversationSearchContext(deps, '最近是不是有地震新聞', makeSettings(), makeNewsSettings())
    expect(result.context).toContain('[Conversation search: 地震 規模]')
    expect(result.context).toContain('某地發生地震')
    expect(result.debugPrompt).toBeTruthy()
    expect(result.inputTokens).toBe(10)
    expect(result.outputTokens).toBe(3)
  })

  it('搜到查詢詞但 RSS 沒有結果時回 null context', async () => {
    const deps = stubDeps({ llmReply: '冷門查詢詞', rssFeed: { items: [] } })
    const result = await getConversationSearchContext(deps, '最近有冷門查詢詞的新聞嗎', makeSettings(), makeNewsSettings())
    expect(result.context).toBeNull()
  })
})
