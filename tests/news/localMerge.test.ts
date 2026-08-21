import { describe, it, expect } from 'vitest'
import {
  migrateLocalNewsToKeywords, LOCAL_KEYWORD_GROUP_ID, normalizeNewsModuleSettings,
  loadNewsModuleSettings, saveNewsModuleSettings
} from '@core/news/settings'
import { DEFAULT_KEYWORD_GROUP_ID } from '@core/news/keywordGroups'
import type { NewsModuleSettings, NewsSource } from '@core/news/types'

const groups = [{ id: DEFAULT_KEYWORD_GROUP_ID, name: '預設組' }]
const kw = (id: string, label: string): NewsSource =>
  ({ id, type: 'keyword', label, weight: 'normal', enabled: true, origin: 'user' })

describe('地方新聞併回關鍵字組', () => {
  it('縣市變成「地方」組底下的一般關鍵字，權重保留', () => {
    const r = migrateLocalNewsToKeywords({
      sources: [kw('k1', 'AI')],
      keywordGroups: groups,
      localNews: { enabled: true, locations: [{ name: '台南', weight: 'often' }, { name: '高雄', weight: 'normal' }] }
    })
    expect(r.keywordGroups.map(g => g.id)).toContain(LOCAL_KEYWORD_GROUP_ID)
    const added = r.sources.filter(s => s.groupId === LOCAL_KEYWORD_GROUP_ID)
    expect(added.map(s => s.label)).toEqual(['台南', '高雄'])
    expect(added[0].weight).toBe('often')
    expect(added.every(s => s.origin === 'user' && s.type === 'keyword')).toBe(true)
    expect(r.localNews.locations).toEqual([])
    expect(r.localNews.migratedAt).toBeTypeOf('number')
  })

  it('id 沿用 `loc-<縣市>`：feedback.adjustments 以 sourceId 當鍵，換 id 等於丟掉學習權重', () => {
    const r = migrateLocalNewsToKeywords({
      sources: [], keywordGroups: groups,
      localNews: { enabled: true, locations: [{ name: '台南', weight: 'normal' }] }
    })
    expect(r.sources[0].id).toBe('loc-台南')
  })

  it('原本整個關掉 → 關鍵字加進去但停用，不替使用者做他沒答應的決定', () => {
    const r = migrateLocalNewsToKeywords({
      sources: [], keywordGroups: groups,
      localNews: { enabled: false, locations: [{ name: '台北', weight: 'normal' }] }
    })
    expect(r.sources[0].enabled).toBe(false)
  })

  it('已有同名關鍵字就不重複加，而且不留下一個空的「地方」組', () => {
    // owner 的機器上正是這個情況：四個縣市早就自己建成一般關鍵字了。
    // 先建組再去重的話，管理畫面會多出一個空的同名複本。
    const r = migrateLocalNewsToKeywords({
      sources: [kw('k1', '台南')], keywordGroups: groups,
      localNews: { enabled: true, locations: [{ name: '台南', weight: 'normal' }] }
    })
    expect(r.sources).toHaveLength(1)
    expect(r.keywordGroups.map(g => g.id)).not.toContain(LOCAL_KEYWORD_GROUP_ID)
    expect(r.localNews.migratedAt).toBeTypeOf('number')
  })

  it('冪等：已遷移過就原封不動', () => {
    const already = {
      sources: [] as NewsSource[], keywordGroups: groups,
      localNews: { enabled: false, locations: [{ name: '台南', weight: 'normal' as const }], migratedAt: 123 }
    }
    expect(migrateLocalNewsToKeywords(already)).toBe(already)
  })

  it('⚠️ 冪等不能靠「locations 空不空」：刪光縣市關鍵字後重開不可以被建回來', () => {
    // 第一次遷移
    const once = normalizeNewsModuleSettings({
      localNews: { enabled: true, locations: [{ name: '台南', weight: 'normal' }] }
    } as never)
    expect(once.sources.map(s => s.label)).toEqual(['台南'])

    // 使用者手動刪掉那個關鍵字 → 存檔 → 再讀回來
    const afterDelete = normalizeNewsModuleSettings({ ...once, sources: [] } as never)
    expect(afterDelete.sources).toEqual([])
  })

  it('沒有縣市可搬時也要蓋旗標（讓它變終態，不用每次都重跑）', () => {
    const r = migrateLocalNewsToKeywords({
      sources: [], keywordGroups: groups, localNews: { enabled: false, locations: [] }
    })
    expect(r.localNews.migratedAt).toBeTypeOf('number')
  })
})

describe('遷移必須寫回磁碟（真機抓到的實作 bug）', () => {
  function fakeAdapter(initial: unknown) {
    const files = new Map<string, unknown>()
    if (initial !== undefined) files.set('modules/desktopst.news/settings.json', initial)
    return {
      files,
      adapter: {
        readJson: async (k: string) => files.get(k) ?? null,
        writeJson: async (k: string, v: unknown) => { files.set(k, v) },
        remove: async (k: string) => { files.delete(k) },
        list: async () => [...files.keys()],
        exists: async (k: string) => files.has(k)
      }
    }
  }

  it('讀一次就把遷移結果寫回，冪等旗標才會真的生效', async () => {
    const { files, adapter } = fakeAdapter({
      enabled: true,
      localNews: { enabled: true, locations: [{ name: '台南', weight: 'normal' }] }
    })
    const first = await loadNewsModuleSettings(adapter as never)
    expect(first.sources.map((s) => s.label)).toEqual(['台南'])

    // 磁碟上必須已經是遷移後的樣子（不是等下次存設定才寫）
    const onDisk = files.get('modules/desktopst.news/settings.json') as NewsModuleSettings
    expect(onDisk.localNews.migratedAt).toBeTypeOf('number')
    expect(onDisk.sources.map((s: { label: string }) => s.label)).toEqual(['台南'])

    // 使用者刪掉那個關鍵字之後再讀 → 不可以被建回來
    await saveNewsModuleSettings(adapter as never, { sources: [] })
    const after = await loadNewsModuleSettings(adapter as never)
    expect(after.sources).toEqual([])
  })

  it('還沒有設定檔就不要為了遷移憑空建一份', async () => {
    const { files, adapter } = fakeAdapter(undefined)
    await loadNewsModuleSettings(adapter as never)
    expect(files.size).toBe(0)
  })
})
