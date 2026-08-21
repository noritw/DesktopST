import { describe, it, expect } from 'vitest'
import {
  BREAKOUT_SECTION_ID,
  OTHER_SECTION_ID,
  MAX_DISMISSED,
  addDismissed,
  groupReaderSections,
  groupSourcesByKeywordGroup,
  mergeBatch,
  moveKeywordSource,
  replaceSection,
  sectionIdOf,
  sectionQuota,
  sortPinnedFirst,
  visibleKeywordSources,
  withNewKeyword,
  withSourceEnabled,
  withSourceGroup,
  withSourceLabel,
  withSourceWeight,
  withoutSource
} from '../../src/core/news/reader'
import { withNewGroup, withoutGroup } from '../../src/core/news/keywordGroups'
import type { NewsItem, NewsSource } from '../../src/core/news/types'

/**
 * 個人新聞報的純邏輯（B3 階段 6）。
 *
 * 這些規則以前有兩份：桌面 `groupNewsItemsByKeyword` 與 `mobile.html` 的
 * `nrGroupByKeyword`。搬進 core 之後，這裡就是那份規則唯一的說明書。
 */

const src = (over: Partial<NewsSource> & { id: string; label: string }): NewsSource => ({
  type: 'keyword',
  weight: 'normal',
  enabled: true,
  origin: 'user',
  ...over
})

const item = (over: Partial<NewsItem> & { id: string; sourceId: string }): NewsItem => ({
  title: `標題 ${over.id}`,
  summary: '',
  source: '某報',
  tags: [],
  url: 'https://example.com',
  publishedAt: '',
  sourceType: 'keyword',
  sourceWeight: 'normal',
  ...over
})

const SOURCES: NewsSource[] = [
  src({ id: 'kw-a', label: '獨立遊戲' }),
  src({ id: 'kw-b', label: 'AI', groupId: 'g2' }),
  src({ id: 'feed-1', label: 'iThome', type: 'rss', url: 'https://x/rss' }),
  src({ id: 'kw-off', label: '停用的', enabled: false }),
  // 遷移後的縣市：id 仍是 `loc-*`（保住 feedback 權重），但已經是**一般關鍵字**
  src({ id: 'loc-台北市', label: '台北市', groupId: 'g-local' })
]

describe('分欄（F1：原本桌面與 mobile.html 各一份）', () => {
  it('熱門在最前、其他在最後，關鍵字欄依 sources 的順序', () => {
    const sections = groupReaderSections(
      [
        item({ id: '1', sourceId: 'kw-b' }),
        item({ id: '2', sourceId: 'unknown-src', sourceType: 'rss' }),
        item({ id: '3', sourceId: 'kw-a' }),
        item({ id: '4', sourceId: 'kw-a', breakout: true }),
        item({ id: '5', sourceId: 'loc-台北市' }),
        item({ id: '6', sourceId: 'feed-1', sourceType: 'rss' })
      ],
      SOURCES
    )
    expect(sections.map((s) => s.groupId)).toEqual([
      BREAKOUT_SECTION_ID,
      'kw:kw-a',
      'kw:kw-b',
      // 地方新聞併回一般關鍵字後，縣市就是普通的 kw: 欄，沒有獨立的 __local__
      'kw:loc-台北市',
      'feed:feed-1',
      OTHER_SECTION_ID
    ])
  })

  it('固定欄不帶文案（label 由 UI 給），關鍵字欄用來源名稱', () => {
    const sections = groupReaderSections(
      [item({ id: '1', sourceId: 'kw-a' }), item({ id: '2', sourceId: 'kw-a', breakout: true })],
      SOURCES
    )
    expect(sections.find((s) => s.kind === 'breakout')?.label).toBe('')
    expect(sections.find((s) => s.kind === 'keyword')?.label).toBe('獨立遊戲')
  })

  it('空的欄不出現（沒有新聞的關鍵字不占一格）', () => {
    const sections = groupReaderSections([item({ id: '1', sourceId: 'kw-a' })], SOURCES)
    expect(sections.map((s) => s.groupId)).toEqual(['kw:kw-a'])
  })

  it('sectionIdOf 與分欄同一套判斷 —— 不同就會重抓錯欄', () => {
    for (const it of [
      item({ id: '1', sourceId: 'kw-a' }),
      item({ id: '2', sourceId: 'loc-台北市' }),
      item({ id: '3', sourceId: 'feed-1', sourceType: 'rss' }),
      item({ id: '4', sourceId: 'kw-a', breakout: true }),
      item({ id: '5', sourceId: '???', sourceType: 'json' })
    ]) {
      const sections = groupReaderSections([it], SOURCES)
      expect(sectionIdOf(it, SOURCES)).toBe(sections[0].groupId)
    }
  })
})

describe('配額（F4）', () => {
  const quota = { readerPerKeyword: 3, readerBreakoutQuota: 5 }

  it('熱門有自己的配額，關鍵字可覆寫，其餘落回全域', () => {
    const sources = [...SOURCES, src({ id: 'kw-q', label: '有覆寫', readerQuota: 7 })]
    expect(sectionQuota(BREAKOUT_SECTION_ID, sources, quota)).toBe(5)
    expect(sectionQuota('kw:kw-q', sources, quota)).toBe(7)
    expect(sectionQuota('kw:kw-a', sources, quota)).toBe(3)
    expect(sectionQuota('kw:loc-台北市', sources, quota)).toBe(3)
    expect(sectionQuota('feed:feed-1', sources, quota)).toBe(3)
  })
})

describe('關鍵字組與欄位順序（F5／F6）', () => {
  it('沒選組＝全部組；只有停用的不列', () => {
    // 縣市現在是一般關鍵字，會出現在排序清單裡（原本被 origin==='location' 濾掉、
    // 使用者根本移不動它）——這正是這次合併要解決的事。
    expect(visibleKeywordSources(SOURCES, []).map((s) => s.id)).toEqual(['kw-a', 'kw-b', 'loc-台北市'])
  })

  it('`loc-` 前綴只是歷史 id，不可以再有任何行為', () => {
    const locItem = item({ id: 'x', sourceId: 'loc-台北市' })
    expect(sectionIdOf(locItem, SOURCES)).toBe('kw:loc-台北市')
    expect(visibleKeywordSources(SOURCES, ['g-local']).map((s) => s.id)).toEqual(['loc-台北市'])
  })

  it('選了組就只列那幾組', () => {
    expect(visibleKeywordSources(SOURCES, ['g2']).map((s) => s.id)).toEqual(['kw-b'])
    // 未設 groupId 視為預設組
    expect(visibleKeywordSources(SOURCES, ['default']).map((s) => s.id)).toEqual(['kw-a'])
  })

  it('上移只在「看得到的關鍵字」之間對調，跳過中間的訂閱來源', () => {
    // 畫面上是 kw-a、kw-b；中間夾著 feed-1。按 ▲ 要和 kw-a 對調，不是和 feed-1
    const moved = moveKeywordSource(SOURCES, 'kw-b', -1, [])
    expect(moved.map((s) => s.id)).toEqual(['kw-b', 'kw-a', 'feed-1', 'kw-off', 'loc-台北市'])
  })

  it('已在頭／尾時原樣回傳（同一個參照，呼叫端才知道不必送出）', () => {
    expect(moveKeywordSource(SOURCES, 'kw-a', -1, [])).toBe(SOURCES)
    expect(moveKeywordSource(SOURCES, 'loc-台北市', 1, [])).toBe(SOURCES)
    expect(moveKeywordSource(SOURCES, '不存在', -1, [])).toBe(SOURCES)
  })
})

describe('併回釘選與換掉一欄（F3／F7／F8）', () => {
  it('換一批：釘選保留在最前，dismiss 過的兩邊都不留', () => {
    const merged = mergeBatch({
      pinnedItems: [item({ id: 'p1', sourceId: 'kw-a' }), item({ id: 'gone', sourceId: 'kw-a' })],
      freshItems: [item({ id: 'f1', sourceId: 'kw-a' }), item({ id: 'bad', sourceId: 'kw-a' })],
      dismissedIds: ['gone', 'bad']
    })
    expect(merged.map((i) => i.id)).toEqual(['p1', 'f1'])
  })

  it('釘選的那則也在新的一批裡時不重複', () => {
    const merged = mergeBatch({
      pinnedItems: [item({ id: 'x', sourceId: 'kw-a' })],
      freshItems: [item({ id: 'x', sourceId: 'kw-a' }), item({ id: 'y', sourceId: 'kw-a' })],
      dismissedIds: []
    })
    expect(merged.map((i) => i.id)).toEqual(['x', 'y'])
  })

  it('單欄重抓只換那一欄，其他欄與該欄的釘選都留著', () => {
    const items = [
      item({ id: 'a1', sourceId: 'kw-a' }),
      item({ id: 'a2', sourceId: 'kw-a' }),
      item({ id: 'b1', sourceId: 'kw-b' })
    ]
    const next = replaceSection({
      items,
      sources: SOURCES,
      sectionGroupId: 'kw:kw-a',
      freshItems: [item({ id: 'a3', sourceId: 'kw-a' }), item({ id: 'a1', sourceId: 'kw-a' })],
      dismissedIds: [],
      pinnedIds: ['a2']
    })
    // a2 是釘選留著；a1 被換掉但新的一批又回傳它 → 只留一份；b1 是別欄不動
    expect(next.map((i) => i.id)).toEqual(['a2', 'b1', 'a3', 'a1'])
  })

  it('不看了的上限是 500，超過丟最舊的', () => {
    let ids: string[] = []
    for (let i = 0; i < MAX_DISMISSED + 10; i++) ids = addDismissed(ids, `n${i}`)
    expect(ids.length).toBe(MAX_DISMISSED)
    expect(ids[0]).toBe('n10')
  })

  it('重複加同一則不會變長，也不必再送一次（回傳同一個參照）', () => {
    const ids = addDismissed([], 'a')
    expect(addDismissed(ids, 'a')).toBe(ids)
  })

  it('釘選排在該欄最前，其餘維持原順序', () => {
    const list = [
      item({ id: '1', sourceId: 'kw-a' }),
      item({ id: '2', sourceId: 'kw-a' }),
      item({ id: '3', sourceId: 'kw-a' })
    ]
    expect(sortPinnedFirst(list, ['3']).map((i) => i.id)).toEqual(['3', '1', '2'])
  })
})

describe('關鍵字管理（owner 2026-08-06：新增／刪除／排序／分組合成一個畫面）', () => {
  const GROUPS = [
    { id: 'default', name: '預設組' },
    { id: 'g2', name: '生活' }
  ]

  it('分桶依組排列，組內維持 sources 原順序；非關鍵字來源不列', () => {
    const buckets = groupSourcesByKeywordGroup(SOURCES, [...GROUPS, { id: 'g-local', name: '地方' }])
    expect(buckets.map((b) => b.group.id)).toEqual(['default', 'g2', 'g-local'])
    expect(buckets[0].sources.map((s) => s.id)).toEqual(['kw-a', 'kw-off'])
    expect(buckets[1].sources.map((s) => s.id)).toEqual(['kw-b'])
    expect(buckets[2].sources.map((s) => s.id)).toEqual(['loc-台北市'])
  })

  it('空組也回傳（管理畫面要能對著剛新增、還沒放關鍵字的組操作）', () => {
    const onlyDefault = [src({ id: 'kw-a', label: '獨立遊戲' })]
    const buckets = groupSourcesByKeywordGroup(onlyDefault, GROUPS)
    expect(buckets.map((b) => b.group.id)).toEqual(['default', 'g2'])
    expect(buckets.find((b) => b.group.id === 'g2')?.sources).toEqual([])
  })

  it('改權重／改標籤／改分組／停用只影響那一筆', () => {
    expect(withSourceWeight(SOURCES, 'kw-a', 'rarely').find((s) => s.id === 'kw-a')?.weight).toBe('rarely')
    expect(withSourceWeight(SOURCES, 'kw-a', 'rarely').find((s) => s.id === 'kw-b')?.weight).toBe('normal')

    expect(withSourceLabel(SOURCES, 'kw-a', '  新名字  ').find((s) => s.id === 'kw-a')?.label).toBe('新名字')
    expect(withSourceLabel(SOURCES, 'kw-a', '   ')).toBe(SOURCES) // 空白不改，回傳同一參照

    expect(withSourceGroup(SOURCES, 'kw-a', 'g2').find((s) => s.id === 'kw-a')?.groupId).toBe('g2')
    // 設回預設組時清掉 groupId（undefined 與 'default' 語意相同，不留多餘欄位）
    expect(withSourceGroup(SOURCES, 'kw-b', 'default').find((s) => s.id === 'kw-b')?.groupId).toBeUndefined()

    expect(withSourceEnabled(SOURCES, 'kw-off', true).find((s) => s.id === 'kw-off')?.enabled).toBe(true)
    expect(withSourceEnabled(SOURCES, 'kw-off', true).find((s) => s.id === 'kw-a')?.enabled).toBe(true)
  })

  it('刪除只移除那一筆', () => {
    const next = withoutSource(SOURCES, 'kw-a')
    expect(next.map((s) => s.id)).not.toContain('kw-a')
    expect(next.length).toBe(SOURCES.length - 1)
  })

  it('新增關鍵字不帶 id（由電腦端產生），trim 過的標籤，空字串不新增', () => {
    const next = withNewKeyword(SOURCES, '  鐵道旅行  ', 'g2')
    const added = next[next.length - 1]
    expect(added.id).toBe('')
    expect(added.label).toBe('鐵道旅行')
    expect(added.groupId).toBe('g2')
    expect(withNewKeyword(SOURCES, '   ', 'g2')).toBe(SOURCES)
  })
})

describe('關鍵字組 CRUD（owner 2026-08-06 當天追加：新增／刪除組）', () => {
  const GROUPS = [
    { id: 'default', name: '預設組' },
    { id: 'g2', name: '生活' }
  ]

  it('新增組不帶 id（由電腦端產生），trim 過的名稱，空字串不新增', () => {
    const next = withNewGroup(GROUPS, '  遊戲  ')
    const added = next[next.length - 1]
    expect(added.id).toBe('')
    expect(added.name).toBe('遊戲')
    expect(withNewGroup(GROUPS, '   ')).toBe(GROUPS)
  })

  it('刪除組只移除那一組，不動關鍵字所屬（伺服器端才會把孤兒關鍵字歸回預設組）', () => {
    const next = withoutGroup(GROUPS, 'g2')
    expect(next.map((g) => g.id)).toEqual(['default'])
  })

  it('預設組永遠留著，就算被要求刪除也擋下來（同一參照，UI 才知道不必送出）', () => {
    expect(withoutGroup(GROUPS, 'default')).toBe(GROUPS)
  })
})
