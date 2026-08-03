import { describe, it, expect } from 'vitest'
import { filterAndPick, detectLang, isForeignLanguage, collectInterestTerms } from '@core/news/filter'
import { DEFAULT_KEYWORD_GROUP_ID, weightToValue, effectiveGroupId } from '@core/news/keywordGroups'
import { makeSeededRandom } from '../fixtures'
import type { NewsItem, NewsModuleSettings } from '@core/news/types'

/**
 * 新聞六層篩選與加權抽選 —— §6.2 第 3 項。
 *
 * `filterAndPick` 的 `rng` 是**注入**的，所以這塊完全可決定性：
 * 能精確測到「第幾層淘汰了幾則」與「權重有沒有生效」。
 *
 * ⚠️ `defaultNewsModuleSettings()` 住在 `main/`（走檔案存取的鄰居），
 * 測試不碰 main，因此這裡自備一份等價的最小設定。
 * 那支預設值若增刪欄位，這裡要跟著補 —— 但 `filterAndPick` 只讀下列欄位，
 * 不相干的欄位變動不會讓這些測試紅字。
 */

function makeNewsSettings(over: Partial<NewsModuleSettings> = {}): NewsModuleSettings {
  return {
    enabled: true,
    sources: [],
    keywordGroups: [{ id: DEFAULT_KEYWORD_GROUP_ID, name: '預設組' }],
    blacklist: [],
    excludedCategories: [],
    excludedSources: [],
    reducedSources: [],
    langMode: 'raw',
    speakButton: 'sometimes',
    replyModel: 'main',
    reminder: { enabled: false },
    breakout: { enabled: false, weight: 'normal', zhOnly: true },
    localNews: { enabled: false, locations: [] },
    feedback: { adjustments: {} },
    seenIds: [],
    maxAgeDays: 0,
    readerMaxItems: 30,
    readerPerKeyword: 3,
    readerBreakoutQuota: 3,
    readerKeywordGroupIds: [],
    conversationSearch: { enabled: false, triggerWords: [], maxAgeHours: 48 },
    ...over
  } as unknown as NewsModuleSettings
}

function makeItem(over: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'n1',
    title: '台北捷運新路線通車',
    summary: '今日正式通車。',
    source: '中央社',
    tags: [],
    url: 'https://example.com/1',
    publishedAt: new Date().toISOString(),
    sourceId: 'rss-1',
    sourceType: 'rss',
    sourceWeight: 'normal',
    ...over
  } as unknown as NewsItem
}

/** 固定亂數：同一個 seed → 同一個抽選結果 */
const rng = (seed: number): (() => number) => makeSeededRandom(seed)

describe('detectLang', () => {
  it('繁中 / 簡中 / 日文 / 韓文 / 其他', () => {
    expect(detectLang('台北捷運通車了')).toBe('zh-hant')
    expect(detectLang('台北地铁开通运营')).toBe('zh-hans')
    expect(detectLang('こんにちは、今日はいい天気ですね')).toBe('ja')
    expect(detectLang('안녕하세요 오늘 날씨가 좋네요')).toBe('ko')
    expect(detectLang('Hello world, this is english text')).toBe('other')
  })
})

describe('filterAndPick — 逐層淘汰', () => {
  it('同 id 只留一則（多來源混入同一篇）', () => {
    const items = [makeItem(), makeItem({ title: '不同標題但同 id' })]
    const r = filterAndPick(items, makeNewsSettings(), { rng: rng(1) })
    expect(r.stats.total).toBe(2)
    expect(r.candidateCount).toBe(1)
  })

  it('日期截止：過舊的被剔除，沒有日期的放行', () => {
    const old = makeItem({ id: 'old', publishedAt: new Date(Date.now() - 60 * 86_400_000).toISOString() })
    const fresh = makeItem({ id: 'fresh' })
    const noDate = makeItem({ id: 'nodate', publishedAt: '' })
    const r = filterAndPick([old, fresh, noDate], makeNewsSettings({ maxAgeDays: 30 }), { rng: rng(1) })
    expect(r.stats.afterAge).toBe(2)
  })

  it('來源排除（子字串、大小寫不敏感）', () => {
    const items = [makeItem({ id: 'a', source: '某某週刊' }), makeItem({ id: 'b', source: '中央社' })]
    const r = filterAndPick(items, makeNewsSettings({ excludedSources: ['週刊'] }), { rng: rng(1) })
    expect(r.stats.afterSourceExclude).toBe(1)
    expect(r.picked?.id).toBe('b')
  })

  it('黑名單關鍵字（比對標題與摘要）', () => {
    const items = [makeItem({ id: 'a', title: '某藝人緋聞' }), makeItem({ id: 'b' })]
    const r = filterAndPick(items, makeNewsSettings({ blacklist: ['緋聞'] }), { rng: rng(1) })
    expect(r.stats.afterBlacklist).toBe(1)
    expect(r.picked?.id).toBe('b')
  })

  it('整類排除', () => {
    const items = [makeItem({ id: 'a', category: '娛樂' }), makeItem({ id: 'b', category: '科技' })]
    const r = filterAndPick(items, makeNewsSettings({ excludedCategories: ['娛樂'] }), { rng: rng(1) })
    expect(r.stats.afterCategoryExclude).toBe(1)
  })

  it('zh-only 模式只留繁中', () => {
    const items = [
      makeItem({ id: 'zh', title: '台北捷運通車' }),
      makeItem({ id: 'en', title: 'Taipei metro line opens today', summary: 'The new line started service.' })
    ]
    const r = filterAndPick(items, makeNewsSettings({ langMode: 'zh-only' }), { rng: rng(1) })
    expect(r.stats.afterLang).toBe(1)
    expect(r.picked?.id).toBe('zh')
  })

  it('raw 模式保留外語', () => {
    const items = [makeItem({ id: 'en', title: 'Taipei metro line opens', summary: 'English summary here.' })]
    const r = filterAndPick(items, makeNewsSettings({ langMode: 'raw' }), { rng: rng(1) })
    expect(r.stats.afterLang).toBe(1)
  })

  it('seenIds 去重', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })]
    const r = filterAndPick(items, makeNewsSettings({ seenIds: ['a'] }), { rng: rng(1) })
    expect(r.stats.afterSeen).toBe(1)
    expect(r.picked?.id).toBe('b')
  })

  it('全部被篩掉時 picked 為 null，且不會爆', () => {
    const r = filterAndPick([makeItem({ id: 'a' })], makeNewsSettings({ seenIds: ['a'] }), { rng: rng(1) })
    expect(r.picked).toBeNull()
    expect(r.candidateCount).toBe(0)
  })

  it('空輸入', () => {
    const r = filterAndPick([], makeNewsSettings(), { rng: rng(1) })
    expect(r.picked).toBeNull()
    expect(r.stats.total).toBe(0)
  })
})

describe('filterAndPick — 加權抽選', () => {
  it('同一個 rng 給同一個結果（可重現）', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })]
    const a = filterAndPick(items, makeNewsSettings(), { rng: rng(777) })
    const b = filterAndPick(items, makeNewsSettings(), { rng: rng(777) })
    expect(a.picked?.id).toBe(b.picked?.id)
  })

  it('權重高的來源抽中機率明顯較高（often=3 vs rarely=1）', () => {
    const items = [
      makeItem({ id: 'often', sourceWeight: 'often', summary: '' }),
      makeItem({ id: 'rarely', sourceWeight: 'rarely', summary: '' })
    ]
    const gen = rng(20260804)
    let often = 0
    const N = 2000
    for (let i = 0; i < N; i++) {
      if (filterAndPick(items, makeNewsSettings(), { rng: gen }).picked?.id === 'often') often++
    }
    // 理論值 3/4 = 0.75，抓寬一點只擋「權重整個沒生效」等級的錯
    expect(often / N).toBeGreaterThan(0.65)
    expect(often / N).toBeLessThan(0.85)
  })

  it('有摘要的略為加權（1.6 倍），但不是硬性優先', () => {
    const items = [
      makeItem({ id: 'withSummary', summary: '這則有補充說明。' }),
      makeItem({ id: 'titleOnly', summary: '' })
    ]
    const gen = rng(555)
    let withSummary = 0
    const N = 2000
    for (let i = 0; i < N; i++) {
      if (filterAndPick(items, makeNewsSettings(), { rng: gen }).picked?.id === 'withSummary') withSummary++
    }
    expect(withSummary / N).toBeGreaterThan(0.5)
    expect(withSummary / N).toBeLessThan(0.75)
  })

  it('抽出來的一定在候選池裡', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })]
    for (let s = 1; s <= 50; s++) {
      const r = filterAndPick(items, makeNewsSettings(), { rng: rng(s) })
      expect(['a', 'b', 'c']).toContain(r.picked?.id)
    }
  })
})

describe('keywordGroups helper', () => {
  it('weightToValue 單調遞增（rarely < normal < often）', () => {
    expect(weightToValue('rarely')).toBeLessThan(weightToValue('normal'))
    expect(weightToValue('normal')).toBeLessThan(weightToValue('often'))
  })

  it('未知值退回 normal', () => {
    expect(weightToValue('不存在' as never)).toBe(weightToValue('normal'))
  })

  it('effectiveGroupId：沒設定時給預設組', () => {
    expect(effectiveGroupId(undefined)).toBe(DEFAULT_KEYWORD_GROUP_ID)
    expect(effectiveGroupId('my-group')).toBe('my-group')
  })
})

describe('isForeignLanguage / collectInterestTerms', () => {
  it('繁中不算外語，其餘算', () => {
    expect(isForeignLanguage(makeItem({ title: '台北捷運通車' }))).toBe(false)
    expect(isForeignLanguage(makeItem({ title: 'Hello world this is english', summary: 'more english' }))).toBe(true)
  })

  it('沒有任何關鍵字來源時給空陣列', () => {
    expect(collectInterestTerms(makeNewsSettings())).toEqual([])
  })
})
