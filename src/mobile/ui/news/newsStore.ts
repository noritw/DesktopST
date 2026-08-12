import { create } from 'zustand'
import { DataError } from '@core/data'
import type { NewsFetchResult, NewsReaderSnapshot } from '@core/data'
import type { NewsItem, NewsKeywordGroup, NewsSource } from '@core/news/types'
import {
  BREAKOUT_SECTION_ID,
  addDismissed,
  groupReaderSections,
  mergeBatch,
  moveKeywordSource,
  replaceSection,
  sectionIdOf
} from '@core/news/reader'
import type { ReaderSection } from '@core/news/reader'
import { effectiveGroupId } from '@core/news/keywordGroups'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'

/**
 * 個人新聞報的畫面狀態（B3 階段 6，清單 F1–F13）。
 *
 * ## 這裡沒有業務邏輯
 *
 * 分欄、併回釘選、換掉一欄、dismiss 上限、欄位上下移全部在 `@core/news/reader`；
 * 抓取與篩選在電腦端的 `readerFetch.ts`（桌面新聞報用的是同一支）。
 * 這支只做三件事：**呼叫 DataSource、記住畫面上那份清單、決定要顯示什麼**。
 *
 * ## 為什麼是 store 不是元件的 useState
 *
 * 「換一批」「重抓一欄」都要花 10–30 秒（規劃書 §5.2）。放在元件裡的話，
 * 使用者一關掉 sheet 就重來一次 —— 那是最花電腦資源的操作。
 * 放這裡就能「關掉再打開還在原地」。
 *
 * ## 狀態分兩類（與桌面版一致）
 *
 * · 釘選／不看了 → **電腦端共用**（桌機與手機同一份，規劃書 §3 方案 B）
 * · 顯示模式／目前分頁 → 各裝置自己的 localStorage（UI 偏好；共用的話在手機
 *   點一下會讓桌機畫面跟著跳走）
 */

const LS_DISPLAY = 'desktopst.mobileReader.displayMode'
const LS_TAB = 'desktopst.mobileReader.activeTab'
const LS_GROUP = 'desktopst.mobileReader.activeGroup'

export type DisplayMode = 'title' | 'title-summary'

/** localStorage 在無痕模式／某些 WebView 會丟例外，讀寫一律包起來。 */
function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 存不了就算了，只是偏好 */
  }
}

interface NewsState {
  loaded: boolean
  loading: boolean
  /** 顯示在畫面上的錯誤（電腦端給的字串或連線錯誤的中文翻譯）。 */
  error: string | null
  /** 模組總開關關閉時只顯示提示，不顯示錯誤。 */
  enabled: boolean

  items: NewsItem[]
  sources: NewsSource[]
  keywordGroups: NewsKeywordGroup[]
  readerKeywordGroupIds: string[]
  readerPerKeyword: number
  readerBreakoutQuota: number
  pinnedItems: NewsItem[]
  dismissedIds: string[]
  fetchedAt: number | null

  /** 正在重抓哪一欄（同時只允許一欄，避免兩個結果互相蓋掉）。 */
  refreshingSection: string | null
  /**
   * 導覽第二層：目前看哪一欄（`all` ＝該組全部）。
   * 第一層是 `activeGroup`——分成兩層是因為只有一排 chips 時，
   * 使用者分不出「ACG」與「動畫」是上下層還是並列（owner 2026-08-12 回報）。
   */
  activeTab: string
  /** 導覽第一層：`all` ＝全部組；`__fixed__` ＝熱門／地方／訂閱那些不屬於任何組的欄。 */
  activeGroup: string
  displayMode: DisplayMode
  optionsOpen: boolean
  /**
   * 有一筆「興趣關鍵字」或「關鍵字組」的異動（新增／刪除／改名／改權重／
   * 改分組／新增組／刪除組）還在存檔中。
   *
   * ⚠️ **這是唯一一支寫 `sources` 或 `keywordGroups` 的方法，而且全域只允許
   * 一筆在飛**——`saveSettings` 送的是整個 `sources`／`keywordGroups` 陣列
   * （不是單筆 patch），兩筆同時在飛誰先回來誰就把另一筆的結果蓋掉。
   * owner 2026-08-06 回報「點頻率結果所有關鍵字一起被改掉」，追下來是舊版
   * 只有「頻率」按鈕會檢查 `busy`，啟用勾選框、分組下拉都沒檢查，兩個動作
   * 前後腳送出就會互相蓋過去。用一個全域旗標擋住所有會動這兩個陣列的控制項，
   * 從源頭讓「同時只有一筆在飛」這件事不可能被打破，而不是每加一顆按鈕就要
   * 記得自己補檢查。新增「關鍵字組」CRUD 時沿用同一支旗標，不另開一個——
   * 兩者打的是同一支 `/api/news/settings`，分開擋一樣會互相蓋過去。
   */
  keywordsBusy: boolean

  /** 開啟畫面：只在還沒載入過時抓，關掉再打開不會重來一次。 */
  open: () => Promise<void>
  reload: () => Promise<void>
  /**
   * 電腦端的資料改了（`state-invalidated`）——最典型的是「從電腦匯入／
   * 重新拉設定」把關鍵字組同步過來。這份快取若已經 `loaded`，就標成過期，
   * 下次 `open()` 會真的重抓一次而不是沿用舊的。
   *
   * ⚠️ **沒有這支的話**：使用者先打開過新聞報（這份快取就定住了），
   * 之後才去跑同步，新聞畫面看起來完全沒變——更糟的是接著在「管理關鍵字」
   * 隨手加一個關鍵字，`mutateSources` 會把這份**過期的** `sources` 陣列
   * （很可能是空的）整包送出去覆蓋掉磁碟上剛同步回來的資料，
   * 電腦端設定好的關鍵字就這樣被靜靜洗掉（owner 2026-08-13 實機回報）。
   */
  invalidate: () => void
  fetchBatch: (replaceAll: boolean) => Promise<void>
  refreshSection: (sectionGroupId: string) => Promise<void>
  togglePin: (item: NewsItem) => Promise<void>
  dismiss: (item: NewsItem) => Promise<void>
  openOriginal: (item: NewsItem) => Promise<void>
  setQuota: (sectionGroupId: string, quota: number) => Promise<void>
  setKeywordGroups: (ids: string[]) => Promise<void>
  /** 上移／下移，範圍是該關鍵字**自己所屬的組**（與「要抓哪些組」的閱讀篩選是兩回事）。 */
  moveSource: (sourceId: string, delta: -1 | 1) => Promise<void>
  /** 新增／刪除／改名／改權重／改分組共用這一支，見 `keywordsBusy` 的說明。 */
  mutateSources: (mutate: (sources: NewsSource[]) => NewsSource[], action: string) => Promise<void>
  /** 新增／刪除關鍵字組共用這一支，見 `keywordsBusy` 的說明。 */
  mutateGroups: (mutate: (groups: NewsKeywordGroup[]) => NewsKeywordGroup[], action: string) => Promise<void>
  setActiveTab: (tab: string) => void
  setActiveGroup: (group: string) => void
  toggleDisplayMode: () => void
  toggleOptions: () => void
}

/**
 * 開新聞原文＋隱性回饋加分（清單 F9）。
 *
 * 新聞報的卡片與**聊天紀錄裡的新聞標題**都要用（後者的資料是 `NewsLinkInfo`
 * 而不是 `NewsItem`，所以收兩個欄位而不是整個物件）。
 */
export async function openNewsOriginal(url?: string, sourceId?: string): Promise<void> {
  // 先開視窗再回報：加分失敗不該擋住看新聞這件事
  if (url) window.open(url, '_blank', 'noopener')
  if (!sourceId) return
  try {
    await getData().news.markOpened(sourceId)
  } catch {
    /* 隱性回饋，失敗不必打擾使用者 */
  }
}

/** 連線層失敗的中文；電腦端自己回的拒絕訊息（模組沒開⋯⋯）直接顯示，不經過這裡。 */
export function describeNewsError(e: unknown, action: string): string {
  if (e instanceof DataError) {
    if (e.code === 'unreachable') return `${action}失敗：連不上電腦。請確認電腦已開機且 DeST 正在執行。`
    if (e.code === 'unauthorized') return `${action}失敗：連線權杖失效，請重新掃描 QR code。`
    if (e.code === 'not-supported') return `${action}失敗：這台電腦上的 DeST 版本還沒有新聞報，請更新到新版。`
  }
  return `${action}失敗，請再試一次。`
}

export const useNewsStore = create<NewsState>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  enabled: true,

  items: [],
  sources: [],
  keywordGroups: [],
  readerKeywordGroupIds: [],
  readerPerKeyword: 3,
  readerBreakoutQuota: 3,
  pinnedItems: [],
  dismissedIds: [],
  fetchedAt: null,

  refreshingSection: null,
  activeTab: readLocal(LS_TAB) ?? 'all',
  activeGroup: readLocal(LS_GROUP) ?? 'all',
  displayMode: readLocal(LS_DISPLAY) === 'title-summary' ? 'title-summary' : 'title',
  optionsOpen: false,
  keywordsBusy: false,

  open: async () => {
    if (get().loaded || get().loading) return
    await get().reload()
  },

  invalidate: () => {
    if (get().loaded) set({ loaded: false })
  },

  reload: async () => {
    set({ loading: true, error: null })
    let state: NewsReaderSnapshot
    try {
      state = await getData().news.getReaderState()
    } catch (e) {
      set({ loading: false, error: describeNewsError(e, '讀取新聞報設定') })
      return
    }
    set({
      loaded: true,
      enabled: state.enabled !== false,
      sources: state.sources ?? [],
      keywordGroups: state.keywordGroups ?? [],
      readerKeywordGroupIds: state.readerKeywordGroupIds ?? [],
      readerPerKeyword: state.readerPerKeyword ?? 3,
      readerBreakoutQuota: state.readerBreakoutQuota ?? 3,
      pinnedItems: state.pinnedItems ?? [],
      dismissedIds: state.dismissedIds ?? []
    })
    if (!state.enabled) {
      set({ loading: false })
      return
    }
    await get().fetchBatch(false)
  },

  /**
   * 抓一批。
   *
   * `replaceAll`＝「換一批」：排除畫面上全部（含釘選）以免抽到重複的，
   * 釘選的在本地由 `mergeBatch` 併回來。
   */
  fetchBatch: async (replaceAll) => {
    const { items, pinnedItems } = get()
    set({ loading: true, error: null })

    let r: NewsFetchResult
    try {
      r = await getData().news.fetchBatch({
        excludeIds: replaceAll ? items.map((i) => i.id) : pinnedItems.map((p) => p.id),
        strictExclude: replaceAll
      })
    } catch (e) {
      set({ loading: false, error: describeNewsError(e, '抓取新聞') })
      return
    }

    if (!r.ok) {
      // 電腦端的拒絕訊息（模組沒開、來源全掛）比任何我們自己編的字準確。
      set({ loading: false, error: r.error })
      return
    }

    const dismissedIds = get().dismissedIds
    set({
      loading: false,
      ...applySnapshot(r),
      items: mergeBatch({ pinnedItems: get().pinnedItems, freshItems: r.items, dismissedIds }),
      fetchedAt: r.fetchedAt || Date.now()
    })
  },

  refreshSection: async (sectionGroupId) => {
    const { items, sources, pinnedItems } = get()
    const pinnedIds = new Set(pinnedItems.map((p) => p.id))
    set({ refreshingSection: sectionGroupId })

    let r: NewsFetchResult
    try {
      r = await getData().news.fetchSection({
        sectionGroupId,
        // 釘選的不排除：它們等一下要留在原位，排除了電腦端就不會再回同一則
        excludeIds: items
          .filter((i) => sectionIdOf(i, sources) === sectionGroupId && !pinnedIds.has(i.id))
          .map((i) => i.id),
        strictExclude: true
      })
    } catch (e) {
      set({ refreshingSection: null })
      useUiStore.getState().toast(describeNewsError(e, '重抓'), 'error')
      return
    }

    set({ refreshingSection: null })
    if (!r.ok) {
      useUiStore.getState().toast(r.error, 'error')
      return
    }
    applyFreshSection(set, get, sectionGroupId, r)
  },

  togglePin: async (item) => {
    const prev = get().pinnedItems
    const exists = prev.some((p) => p.id === item.id)
    const next = exists ? prev.filter((p) => p.id !== item.id) : prev.concat([item])
    set({ pinnedItems: next })
    try {
      await getData().news.setPinned(next)
    } catch (e) {
      // 寫不回去就退回原狀：留著會讓使用者以為釘好了，下次打開卻不見
      set({ pinnedItems: prev })
      useUiStore.getState().toast(describeNewsError(e, '釘選'), 'error')
    }
  },

  dismiss: async (item) => {
    const prevDismissed = get().dismissedIds
    const prevPinned = get().pinnedItems
    const nextDismissed = addDismissed(prevDismissed, item.id)
    const wasPinned = prevPinned.some((p) => p.id === item.id)
    const nextPinned = wasPinned ? prevPinned.filter((p) => p.id !== item.id) : prevPinned

    set({
      dismissedIds: nextDismissed,
      pinnedItems: nextPinned,
      items: get().items.filter((i) => i.id !== item.id)
    })

    try {
      await getData().news.setDismissed(nextDismissed)
      if (wasPinned) await getData().news.setPinned(nextPinned)
    } catch (e) {
      useUiStore.getState().toast(describeNewsError(e, '設定不看了'), 'error')
    }
  },

  openOriginal: async (item) => openNewsOriginal(item.url, item.sourceId),

  setQuota: async (sectionGroupId, quota) => {
    set({ refreshingSection: sectionGroupId })
    let r: NewsFetchResult
    try {
      r = await getData().news.setQuota(sectionGroupId, quota)
    } catch (e) {
      set({ refreshingSection: null })
      useUiStore.getState().toast(describeNewsError(e, '設定則數'), 'error')
      return
    }
    set({ refreshingSection: null })

    // ⚠️ **本地那份配額也要跟著改。** 磁碟上已經是新值，但這份 store 沒動，
    // 於是畫面上的數字框（`key={value}`）還顯示舊值、「熱門話題開關」也不會翻，
    // 使用者以為沒生效（owner 2026-08-12）。正規化規則與
    // `core/news/readerFetch.setReaderQuota` 對齊——那邊會把「與全域相同」
    // 的單欄覆寫清掉，這裡不跟著清的話下次讀回來又對不上。
    const n = Math.max(0, Math.min(20, Math.floor(quota)))
    if (sectionGroupId === BREAKOUT_SECTION_ID) {
      set({ readerBreakoutQuota: n })
    } else if (sectionGroupId.startsWith('kw:')) {
      const sourceId = sectionGroupId.slice(3)
      const perKeyword = get().readerPerKeyword
      set({
        sources: get().sources.map((src) => {
          if (src.id !== sourceId) return src
          if (n === perKeyword || n < 1) {
            const { readerQuota: _drop, ...rest } = src
            return rest as NewsSource
          }
          return { ...src, readerQuota: n }
        })
      })
    } else {
      set({ readerPerKeyword: Math.max(1, n) })
    }
    // ⚠️ 配額的更新要放在 `r.ok` 檢查**之前**：`setReaderQuota` 是「先存檔、
    // 再重抓那一欄」，重抓失敗（弱網、CORS…）不代表沒存到。放在後面的話
    // 存檔成功但畫面停在舊數字，看起來就是「設了 5 卻還是 3」。
    if (!r.ok) {
      useUiStore.getState().toast(r.error, 'error')
      return
    }
    applyFreshSection(set, get, sectionGroupId, r)
  },

  setKeywordGroups: async (ids) => {
    const prev = get().readerKeywordGroupIds
    set({ readerKeywordGroupIds: ids })
    try {
      await getData().news.setKeywordGroups(ids)
    } catch (e) {
      set({ readerKeywordGroupIds: prev })
      useUiStore.getState().toast(describeNewsError(e, '設定關鍵字組'), 'error')
      return
    }
    // 換了組要重抓，否則畫面上還是舊組的新聞，看起來像沒生效
    await get().fetchBatch(false)
  },

  moveSource: async (sourceId, delta) => {
    if (get().keywordsBusy) return
    const prev = get().sources
    const moved = prev.find((s) => s.id === sourceId)
    if (!moved) return
    // 在自己所屬的組內排序，跟「新聞報要抓哪些組」的閱讀篩選無關——
    // 管理畫面要能調整任何一組的順序，不管那組現在有沒有勾選要抓。
    const next = moveKeywordSource(prev, sourceId, delta, [effectiveGroupId(moved.groupId)])
    if (next === prev) return
    set({ keywordsBusy: true, sources: next })
    try {
      const saved = await getData().news.setSourceOrder(next.map((s) => s.id))
      if (Array.isArray(saved) && saved.length > 0) set({ sources: saved })
    } catch (e) {
      set({ sources: prev })
      useUiStore.getState().toast(describeNewsError(e, '調整欄位順序'), 'error')
    } finally {
      set({ keywordsBusy: false })
    }
  },

  /**
   * 新增／刪除／改名／改權重／改分組共用這一支。
   *
   * 全域只允許一筆在飛（`keywordsBusy`）——見這個欄位的說明。
   * 失敗時整批退回原狀：`saveSettings` 送的是完整陣列，沒辦法只精準復原這一筆，
   * 退回「送出前」的快照是唯一乾淨的做法。
   */
  mutateSources: async (mutate, action) => {
    if (get().keywordsBusy) return
    const prev = get().sources
    const next = mutate(prev)
    if (next === prev) return
    set({ keywordsBusy: true, sources: next })
    try {
      const saved = await getData().news.saveSettings({ sources: next })
      set({ sources: saved.sources, keywordGroups: saved.keywordGroups })
    } catch (e) {
      set({ sources: prev })
      useUiStore.getState().toast(describeNewsError(e, action), 'error')
    } finally {
      set({ keywordsBusy: false })
    }
  },

  /**
   * 新增／刪除關鍵字組。同一支 `keywordsBusy`，理由同 `mutateSources`。
   *
   * 失敗時 `sources` 不必回滾——組沒真的存到磁碟，`groupId` 指向不存在的組
   * 這件事只發生在「已經存成功之後」（電腦端 `normalizeNewsModuleSettings`
   * 才會把指向已刪除組的關鍵字清回預設組），存檔失敗時原本的 `sources` 沒被動過。
   */
  mutateGroups: async (mutate, action) => {
    if (get().keywordsBusy) return
    const prev = get().keywordGroups
    const next = mutate(prev)
    if (next === prev) return
    set({ keywordsBusy: true, keywordGroups: next })
    try {
      const saved = await getData().news.saveSettings({ keywordGroups: next })
      set({ sources: saved.sources, keywordGroups: saved.keywordGroups })
    } catch (e) {
      set({ keywordGroups: prev })
      useUiStore.getState().toast(describeNewsError(e, action), 'error')
    } finally {
      set({ keywordsBusy: false })
    }
  },

  setActiveTab: (tab) => {
    writeLocal(LS_TAB, tab)
    set({ activeTab: tab })
  },

  // 換組一定要把第二層歸零：留著上一組的欄位 id 會讓畫面空白。
  setActiveGroup: (group) => {
    writeLocal(LS_GROUP, group)
    writeLocal(LS_TAB, 'all')
    set({ activeGroup: group, activeTab: 'all' })
  },

  toggleDisplayMode: () =>
    set((s) => {
      const next: DisplayMode = s.displayMode === 'title' ? 'title-summary' : 'title'
      writeLocal(LS_DISPLAY, next)
      return { displayMode: next }
    }),

  toggleOptions: () => set((s) => ({ optionsOpen: !s.optionsOpen }))
}))

/** 抓取回應順便帶回的設定快照（電腦端那份才是真的，以它為準）。 */
function applySnapshot(r: Extract<NewsFetchResult, { ok: true }>): Partial<NewsState> {
  return {
    sources: r.sources ?? [],
    keywordGroups: r.keywordGroups ?? [],
    readerKeywordGroupIds: r.readerKeywordGroupIds ?? [],
    readerPerKeyword: r.readerPerKeyword ?? 3,
    readerBreakoutQuota: r.readerBreakoutQuota ?? 3
  }
}

/** 單欄重抓／改配額共用的收尾：就地換掉那一欄，其他欄不動。 */
function applyFreshSection(
  set: (partial: Partial<NewsState>) => void,
  get: () => NewsState,
  sectionGroupId: string,
  r: Extract<NewsFetchResult, { ok: true }>
): void {
  const snapshot = applySnapshot(r)
  set({
    ...snapshot,
    items: replaceSection({
      items: get().items,
      // 順序可能剛被電腦端調整過，用新的那份判斷欄位歸屬
      sources: snapshot.sources ?? get().sources,
      sectionGroupId,
      freshItems: r.items,
      dismissedIds: get().dismissedIds,
      pinnedIds: get().pinnedItems.map((p) => p.id)
    })
  })
}

// ── 給元件用的衍生資料（不放進 state，避免兩份真相）──────────
//
// ⚠️ **這兩支不可以當 zustand 的 selector 用**（`useNewsStore(selectSections)`）：
// 每次都回傳新陣列，`useSyncExternalStore` 的快照比對永遠不相等，React 會判定
// 「狀態一直在變」而無限重繪（實測：`Maximum update depth exceeded`，畫面整片空白）。
// 元件端用 `useMemo` 包起來，deps 給 `items`／`sources` 這些真正的來源。

export function selectSections(items: NewsItem[], sources: NewsSource[]): ReaderSection[] {
  return groupReaderSections(items, sources)
}


