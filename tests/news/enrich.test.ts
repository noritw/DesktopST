import { describe, it, expect } from 'vitest'
import {
  isSummaryAdequate,
  looksLikeRelatedHeadlineChain,
  fallbackPromptContext,
  resolvePromptContext,
  decideArticleHandling,
  clipPromptContext,
  ARTICLE_DIRECT_MAX_LEN,
  SUMMARY_ADEQUATE_MIN_LEN,
  extractGarturlres,
  cacheManualPromptContext,
  clearNewsEnrichCache,
  enrichNewsForChat
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

describe('extractGarturlres — batchexecute 回應解析', () => {
  const URL = 'https://today.line.me/tw/v2/article/AbCdE'
  const envelope = (u: string) =>
    JSON.stringify([['wrb.fr', 'Fbv4je', JSON.stringify(['garturlres', u]), null, null, null, 'generic']])

  it('多段回應（實際格式）：跳過長度數字行，挖得到原文網址', () => {
    // 2026-08-12 真機診斷的實際形狀：)]}' 之後每段前面都有一行長度數字，
    // 而且後面還跟著一段 af.httprm。舊寫法在這裡整包 JSON.parse 必炸。
    const body = `)]}'\n\n${envelope(URL).length}\n${envelope(URL)}\n26\n${JSON.stringify([['di', 25], ['af.httprm', 25, '123', 5]])}\n`
    expect(extractGarturlres(body)).toBe(URL)
  })

  it('單段、沒有長度數字行也要能解', () => {
    expect(extractGarturlres(`)]}'\n\n${envelope(URL)}`)).toBe(URL)
  })

  it('外層包裝整個變了，regex 保底仍撈得到', () => {
    expect(extractGarturlres(`)]}'\n\n<<<不是 JSON>>> [\\"garturlres\\",\\"${URL}\\"] 後面亂七八糟`)).toBe(URL)
  })

  it('真的沒有 garturlres 就回 null，不要瞎猜一個網址', () => {
    const other = JSON.stringify([['wrb.fr', 'Other', JSON.stringify(['nope']), null, null, null, 'generic']])
    expect(extractGarturlres(`)]}'\n\n${other.length}\n${other}\n`)).toBeNull()
  })
})

describe('extractGarturlres — CapacitorHttp 的雙重編碼（手機專屬）', () => {
  const URL = 'https://www.cw.com.tw/article/12345'
  const envelope = (u: string) =>
    JSON.stringify([['wrb.fr', 'Fbv4je', JSON.stringify(['garturlres', u]), null, null, null, 'generic']])
  const realBody = `)]}'\n\n${envelope(URL).length}\n${envelope(URL)}\n26\n[["di",25]]\n`

  /** 手機收到的樣子：整包再被 JSON 編碼一次（外層引號會被剝掉） */
  const doubleEncoded = JSON.stringify(realBody).slice(1, -1)

  it('雙重編碼的回應要還原得回來', () => {
    // 這正是 2026-08-12 真機 log 看到的字串：換行是字面的 \n、garturlres 前有三個反斜線
    expect(doubleEncoded).toContain('\\\\"garturlres')
    expect(doubleEncoded).not.toContain('\n')
    expect(extractGarturlres(doubleEncoded)).toBe(URL)
  })

  it('沒被多包一層時完全不動它（桌面那條路徑要逐字等價）', () => {
    expect(extractGarturlres(realBody)).toBe(URL)
  })
})

describe('cacheManualPromptContext — 清除摘要', () => {
  it('清成空字串是「不要摘要了」，不可以把空的存進快取', async () => {
    // 存進去的話，同一則之後再按「聊這個」會拿到空的 manual 快取，
    // 看起來像整理壞掉（而且 forceRefresh 之前都救不回來）。
    clearNewsEnrichCache()
    const item = { id: 'news-1', title: '標題', summary: '短摘要', url: '', sourceId: 's', source: '來源', keyword: 'k' }
    const deps = { http: { fetch: async () => { throw new Error('不該連網') } }, storage: {} }

    cacheManualPromptContext('news-1', '手動寫的一段摘要')
    const cached = await enrichNewsForChat(deps as never, item as never, { settings: makeSettings() })
    expect(cached.promptContext).toBe('手動寫的一段摘要')

    cacheManualPromptContext('news-1', '   ')
    const after = await enrichNewsForChat(deps as never, item as never, { settings: makeSettings() })
    // 快取被清掉 → 重新整理（這裡沒有 url，落回 RSS 退回），而不是回一個空字串
    expect(after.promptContext).not.toBe('')
    expect(after.source).not.toBe('manual')
  })
})
