import { describe, it, expect } from 'vitest'
import {
  isSummaryAdequate,
  looksLikeRelatedHeadlineChain,
  fallbackPromptContext,
  resolvePromptContext,
  decideArticleHandling,
  clipPromptContext,
  ARTICLE_DIRECT_MAX_LEN,
  SUMMARY_ADEQUATE_MIN_LEN
} from '@core/news/enrich'
import { buildNewsContextString, buildNewsDirective, buildTopicContextString } from '@core/news/trigger'
import type { NewsItem, NewsModuleSettings } from '@core/news/types'
import { DEFAULT_KEYWORD_GROUP_ID } from '@core/news/keywordGroups'

function makeSettings(over: Partial<NewsModuleSettings> = {}): NewsModuleSettings {
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
    ...over
  } as NewsModuleSettings
}

function makeItem(over: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'n1',
    title: '某國通過新法案',
    summary: '議會今日三讀通過數位隱私相關法案，預計半年後上路，業界反應兩極。',
    source: '示例報',
    tags: [],
    url: 'https://example.com/a',
    publishedAt: '',
    sourceId: 's1',
    sourceType: 'keyword',
    sourceWeight: 'normal',
    ...over
  }
}

describe('isSummaryAdequate', () => {
  it('rejects empty / title-equal / too short', () => {
    expect(isSummaryAdequate('標題', '')).toBe(false)
    expect(isSummaryAdequate('標題', '標題')).toBe(false)
    expect(isSummaryAdequate('長標題ABC', '標題')).toBe(false)
    expect(isSummaryAdequate('標題', 'a'.repeat(SUMMARY_ADEQUATE_MIN_LEN - 1))).toBe(false)
  })

  it('rejects Google-style related headline chains', () => {
    const chain = '甲媒體：事件爆發／乙台：當局回應／丙報：股市震盪／丁社：專家看法'
    expect(looksLikeRelatedHeadlineChain(chain)).toBe(true)
    expect(isSummaryAdequate('主標題事件', chain)).toBe(false)
  })

  it('accepts a real prose summary', () => {
    const prose =
      '地方政府今宣布將於下月起調整大眾運輸票價，平均漲幅約百分之五，並同步推出低收入戶補助方案，預計影響上百萬通勤族。相關配套亦包含學生票優惠延長與偏鄉路線補貼措施。'
    expect(prose.length).toBeGreaterThanOrEqual(SUMMARY_ADEQUATE_MIN_LEN)
    expect(isSummaryAdequate('大眾運輸調漲', prose)).toBe(true)
  })
})

describe('resolvePromptContext / buildNewsContextString', () => {
  it('prefers promptContext over RSS summary', () => {
    const item = makeItem({
      summary: 'RSS 摘要不夠用的標題串／另一則／再一則',
      promptContext: 'enrich 後的事實大意：某某公司宣布併購案，金額未公開。'
    })
    expect(resolvePromptContext(item)).toContain('enrich 後')
    const ctx = buildNewsContextString(item, makeSettings())
    expect(ctx).toContain('enrich 後的事實大意')
    expect(ctx).not.toContain('標題串')
  })

  it('falls back to RSS when no promptContext', () => {
    const item = makeItem()
    const ctx = buildNewsContextString(item, makeSettings())
    expect(ctx).toContain(item.summary)
  })

  it('omits duplicate summary when falling back', () => {
    const item = makeItem({ title: '同標題', summary: '同標題' })
    expect(fallbackPromptContext(item.title, item.summary)).toBe('')
    const ctx = buildNewsContextString(item, makeSettings())
    expect(ctx).not.toMatch(/^Summary:/m)
  })

  it('directive uses promptContext briefly', () => {
    const long = '這是一段較長的事實摘要用來塞進 directive 測試截斷行為。'.repeat(8)
    const item = makeItem({ promptContext: long })
    const d = buildNewsDirective(item)
    expect(d).toContain(item.title)
    expect(d).toContain('…')
    expect(d.includes(long)).toBe(false)
  })

  it('topic context prefers promptContext', () => {
    const s = buildTopicContextString({
      id: 't1',
      title: '話題標題',
      summary: '舊 RSS',
      url: '',
      source: '報',
      promptContext: '使用者改過的版本'
    })
    expect(s).toContain('使用者改過的版本')
    expect(s).not.toContain('舊 RSS')
  })
})

describe('decideArticleHandling', () => {
  it('short → direct, long → utility', () => {
    expect(decideArticleHandling('短文'.repeat(10))).toBe('direct')
    expect(decideArticleHandling('字'.repeat(ARTICLE_DIRECT_MAX_LEN + 1))).toBe('utility')
  })

  it('clips hard max', () => {
    expect(clipPromptContext('あ'.repeat(2000)).length).toBeLessThanOrEqual(1200)
  })
})
