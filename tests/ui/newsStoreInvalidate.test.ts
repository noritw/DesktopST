import { beforeEach, describe, expect, it } from 'vitest'
import type { DataSource } from '@core/data'
import type { NewsKeywordGroup, NewsSource } from '@core/news/types'
import { LocalEventSource } from '../../src/mobile/events/localEventSource'
import { useAppStore } from '../../src/mobile/ui/stores/appStore'
import { useNewsStore } from '../../src/mobile/ui/news/newsStore'

/**
 * owner 2026-08-13 實機回報：從電腦同步新聞關鍵字之後，「管理關鍵字」畫面
 * 分組是空的；手動加一個關鍵字之後分組名稱冒出來了，但裡面還是沒東西。
 *
 * 根因：`newsStore` 打開過一次就 `loaded=true`、不會自動重抓
 * （設計上是「關掉再打開不會重來一次」，見 store 檔頭）。若同步是在
 * 使用者已經開過新聞報之後才跑，這份快取不會知道。接著在「管理關鍵字」
 * 加一個關鍵字時，`mutateSources` 把這份**過期**的 `sources`
 * （很可能是空的）整包送出去覆蓋磁碟——剛同步回來的關鍵字就這樣被洗掉。
 *
 * 修法：`state-invalidated` 事件（同步／匯入都會推）讓 `newsStore` 標成
 * 過期，下次 `open()` 真的重抓一次。這裡驗證整條路徑：開過一次 → 收到
 * 失效事件 → 再 open() 真的拿到新資料，而不是沿用舊的。
 */

function fakeSource(build: () => { news?: Partial<DataSource['news']> }): DataSource {
  return build() as unknown as DataSource
}

describe('newsStore：state-invalidated 之後不再沿用過期快取', () => {
  beforeEach(() => {
    useNewsStore.setState({
      loaded: false,
      loading: false,
      error: null,
      enabled: true,
      items: [],
      sources: [],
      keywordGroups: [],
      readerKeywordGroupIds: [],
      pinnedItems: [],
      dismissedIds: [],
      fetchedAt: null
    })
  })

  it('invalidate() 之後重新 open() 會拿到同步進來的新關鍵字組，不是空的舊快取', async () => {
    let synced = false
    const events = new LocalEventSource()
    const snapshotFields = (): { sources: NewsSource[]; keywordGroups: NewsKeywordGroup[] } =>
      synced
        ? {
            // 同步之後：電腦端的關鍵字組真的進來了
            sources: [
              { id: 'kw1', type: 'keyword', label: '半導體', weight: 'often', enabled: true, origin: 'user', groupId: 'g-work' }
            ],
            keywordGroups: [{ id: 'default', name: '預設組' }, { id: 'g-work', name: '上班用' }]
          }
        : {
            // 使用者第一次打開新聞報：還沒同步過，什麼都沒有
            sources: [],
            keywordGroups: [{ id: 'default', name: '預設組' }]
          }
    const data = fakeSource(() => ({
      news: {
        async getReaderState() {
          return {
            enabled: true,
            readerKeywordGroupIds: [],
            readerMaxItems: 30,
            readerPerKeyword: 3,
            readerBreakoutQuota: 3,
            pinnedItems: [],
            dismissedIds: [],
            ...snapshotFields()
          }
        },
        async fetchBatch() {
          // 真實後端每次回應都帶目前的設定快照——跟 getReaderState 一致，
          // 不是測試才需要這樣接，是契約本來就這樣（見 core/data/types.ts NewsFetchResult）。
          return {
            ok: true,
            items: [],
            fetchedAt: Date.now(),
            readerKeywordGroupIds: [],
            readerMaxItems: 30,
            readerPerKeyword: 3,
            readerBreakoutQuota: 3,
            ...snapshotFields()
          }
        }
      }
    }))

    useAppStore.getState().attach({ data, events })

    // 使用者打開新聞報：抓到「還沒同步」那份空快取
    await useNewsStore.getState().open()
    expect(useNewsStore.getState().sources).toEqual([])
    expect(useNewsStore.getState().keywordGroups.map((g) => g.name)).toEqual(['預設組'])

    // 這時候使用者去跑了「從電腦重新拉設定」——真正的流程會推這個事件
    synced = true
    events.push({ kind: 'state-invalidated', reason: 'desktop' })

    // 快取要標成過期：不會自動重抓（避免不必要的網路流量），但下次 open() 要真的重來一次
    expect(useNewsStore.getState().loaded).toBe(false)
    await useNewsStore.getState().open()

    expect(useNewsStore.getState().keywordGroups.map((g) => g.name)).toEqual(['預設組', '上班用'])
    expect(useNewsStore.getState().sources.map((s) => s.label)).toEqual(['半導體'])
    expect(useNewsStore.getState().sources[0]?.groupId).toBe('g-work')
  })

  it('沒開過新聞報時收到失效事件不會白白多打一次網路（loaded 本來就是 false）', () => {
    const events = new LocalEventSource()
    const data = fakeSource(() => ({}))
    useAppStore.getState().attach({ data, events })

    expect(useNewsStore.getState().loaded).toBe(false)
    events.push({ kind: 'state-invalidated', reason: 'desktop' })
    expect(useNewsStore.getState().loaded).toBe(false)
    expect(useNewsStore.getState().loading).toBe(false)
  })
})
