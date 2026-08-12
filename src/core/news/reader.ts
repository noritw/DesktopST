/**
 * 個人新聞報的純邏輯（B3 階段 6，清單 F1／F3／F4／F6／F7／F8）。
 *
 * ## 為什麼在 core
 *
 * 分欄規則原本有兩份：桌面 `groupNewsItemsByKeyword`（renderer）與
 * `assets/mobile.html` 的 `nrGroupByKeyword`（vanilla JS 手抄）。
 * 兩份同一套規則遲早走鐘（`docs/mobile-html-feature-inventory.md` §4「新聞分欄算了兩次」），
 * 所以搬到這裡，桌面與 React 手機 UI 都薄薄包一層。
 *
 * 併回釘選、換掉一欄、dismiss 上限這些也一起收進來 —— 它們是同一組規則的另一半，
 * 留在 UI 裡就等於「換個畫面就再抄一次」。
 *
 * ## 一條界線
 *
 * **這裡沒有 UI 文案**（roadmap §3.3）：熱門／地方／其他三種固定欄只回 `kind`，
 * 標題由呼叫端決定。關鍵字欄與訂閱欄的 `label` 來自使用者自己設的來源名稱，
 * 那是資料不是文案，照原樣帶出來。
 */

import type { NewsItem, NewsKeywordGroup, NewsSource, NewsWeight } from './types'
import { DEFAULT_KEYWORD_GROUP_ID, effectiveGroupId } from './keywordGroups'

// ── 固定欄的 id（與 main 的 readerFetch／mobileRoutes 對得上，不可改字串）──
export const BREAKOUT_SECTION_ID = '__breakout__'
export const OTHER_SECTION_ID = '__other__'

/** 「這則不要看了」保留幾筆（與 main 的 `readerState.ts` 一致）。 */
export const MAX_DISMISSED = 500

export type ReaderSectionKind = 'breakout' | 'keyword' | 'feed' | 'other'

export interface ReaderSection {
  /** `__breakout__` / `kw:<sourceId>` / `feed:<sourceId>` / `__other__` */
  groupId: string
  kind: ReaderSectionKind
  /** 使用者自訂的來源名稱；固定欄（熱門／其他）為空字串，由 UI 給標題。 */
  label: string
  items: NewsItem[]
}

/** 這則新聞屬於哪一欄。分欄與「重抓一欄」必須用同一套判斷，否則重抓會換錯欄。 */
export function sectionIdOf(item: NewsItem, sources: NewsSource[]): string {
  if (item.breakout === true) return BREAKOUT_SECTION_ID
  const src = sources.find(s => s.id === item.sourceId)
  if (src?.type === 'keyword' || item.sourceType === 'keyword') {
    return `kw:${src ? src.id : item.sourceId}`
  }
  if (src) return `feed:${src.id}`
  return OTHER_SECTION_ID
}

/**
 * 報紙牆分欄：同一個關鍵字／訂閱來源歸一欄，熱門／地方／其他各自成欄。
 *
 * 關鍵字欄依 `sources` 的順序預建，欄位順序才會跟著「上移／下移」的設定走
 * （清單 F6）—— 靠新聞出現的先後排會每次抓完都不一樣。
 */
export function groupReaderSections(items: NewsItem[], sources: NewsSource[]): ReaderSection[] {
  const byId = new Map(sources.map(s => [s.id, s]))
  const breakout: NewsItem[] = []
  const other: NewsItem[] = []
  const keyword = new Map<string, { label: string; items: NewsItem[] }>()
  const feed = new Map<string, { label: string; items: NewsItem[] }>()

  for (const s of sources) {
    if (s.type === 'keyword' && s.enabled) keyword.set(s.id, { label: s.label, items: [] })
  }

  for (const item of items) {
    if (item.breakout === true) { breakout.push(item); continue }

    const src = byId.get(item.sourceId)
    if (src?.type === 'keyword' || item.sourceType === 'keyword') {
      const key = src ? src.id : item.sourceId
      const label = src?.label ?? item.keyword ?? item.source ?? key
      const bucket = keyword.get(key)
      if (bucket) bucket.items.push(item)
      else keyword.set(key, { label, items: [item] })
      continue
    }
    if (src) {
      const bucket = feed.get(src.id)
      if (bucket) bucket.items.push(item)
      else feed.set(src.id, { label: src.label, items: [item] })
      continue
    }
    other.push(item)
  }

  const out: ReaderSection[] = []
  if (breakout.length > 0) {
    out.push({ groupId: BREAKOUT_SECTION_ID, kind: 'breakout', label: '', items: breakout })
  }
  for (const [id, b] of keyword) {
    if (b.items.length > 0) out.push({ groupId: `kw:${id}`, kind: 'keyword', label: b.label, items: b.items })
  }
  for (const [id, b] of feed) {
    if (b.items.length > 0) out.push({ groupId: `feed:${id}`, kind: 'feed', label: b.label, items: b.items })
  }
  if (other.length > 0) {
    out.push({ groupId: OTHER_SECTION_ID, kind: 'other', label: '', items: other })
  }
  return out
}

// ── 配額（清單 F4）───────────────────────────────────────────

export interface ReaderQuotaSettings {
  readerPerKeyword: number
  readerBreakoutQuota: number
}

/** 某一欄目前抓幾則。地方／訂閱沒有獨立配額，顯示的是全域每關鍵字預設（與桌面同行為）。 */
export function sectionQuota(
  sectionGroupId: string,
  sources: NewsSource[],
  settings: ReaderQuotaSettings
): number {
  if (sectionGroupId === BREAKOUT_SECTION_ID) return settings.readerBreakoutQuota
  if (sectionGroupId.startsWith('kw:')) {
    const src = sources.find(s => s.id === sectionGroupId.slice(3))
    if (src && typeof src.readerQuota === 'number' && src.readerQuota >= 1) return src.readerQuota
  }
  return settings.readerPerKeyword
}

// ── 關鍵字組與欄位順序（清單 F5／F6）──────────────────────────

/**
 * 欄位順序清單要列哪些關鍵字來源。
 *
 * 必須跟著「要抓哪些關鍵字組」走：沒選＝全部組，有選＝只列那幾組的關鍵字。
 * 否則切了組卻看到同一份清單，使用者會以為切換沒生效。
 */
export function visibleKeywordSources(sources: NewsSource[], selectedGroupIds: string[]): NewsSource[] {
  return sources.filter(s => {
    if (s.type !== 'keyword' || !s.enabled) return false
    if (selectedGroupIds.length === 0) return true
    return selectedGroupIds.some(id => effectiveGroupId(id) === effectiveGroupId(s.groupId))
  })
}

/**
 * 上移／下移一個關鍵字欄（手機不做拖曳，清單 F6）。
 *
 * **只在「畫面上看得到的關鍵字」之間對調**，跳過中間夾雜的其他組與訂閱來源 ——
 * 否則按 ▲ 會跟一個看不見的項目交換，看起來像沒反應。
 * 回傳整份 `sources`（含沒被列到的），因為端點要的是完整順序。
 */
export function moveKeywordSource(
  sources: NewsSource[],
  sourceId: string,
  delta: -1 | 1,
  selectedGroupIds: string[]
): NewsSource[] {
  const next = sources.slice()
  const idx = next.findIndex(s => s.id === sourceId)
  if (idx < 0) return sources

  const visible = new Set(visibleKeywordSources(sources, selectedGroupIds).map(s => s.id))
  const visibleIdx = next.map((s, i) => (visible.has(s.id) ? i : -1)).filter(i => i >= 0)
  const pos = visibleIdx.indexOf(idx)
  if (pos < 0) return sources
  const targetIdx = visibleIdx[pos + delta]
  if (targetIdx == null) return sources

  const tmp = next[idx]
  next[idx] = next[targetIdx]
  next[targetIdx] = tmp
  return next
}

/** 關鍵字所屬組的名稱（顯示「全部組」時標一下，才知道清單為什麼混在一起）。 */
export function keywordGroupNameOf(
  source: NewsSource,
  groups: { id: string; name: string }[]
): string {
  const gid = effectiveGroupId(source.groupId)
  if (gid === DEFAULT_KEYWORD_GROUP_ID && groups.length <= 1) return ''
  return groups.find(g => g.id === gid)?.name ?? ''
}

// ── 併回釘選 ／ 換掉一欄（清單 F3／F7）────────────────────────

/**
 * 抓完一批之後的清單。
 *
 * 釘選一律保留（換一批時不該把使用者特地留下的東西沖掉），
 * 已在新的一批裡出現的釘選不重複放，dismiss 過的兩邊都濾掉。
 *
 * ⚠️ 桌面版 `mergeKeepingPins` 會依每欄配額細部併回；這裡刻意簡化為
 * 「釘選一律保留、分欄時各自歸位」—— 行為好預測，也不必維護第二份配額演算法
 * （`docs/news-reader-mobile-plan.md` §9 已知限制）。
 */
export function mergeBatch(args: {
  pinnedItems: NewsItem[]
  freshItems: NewsItem[]
  dismissedIds: string[]
}): NewsItem[] {
  const dismissed = new Set(args.dismissedIds)
  const fresh = args.freshItems.filter(i => !dismissed.has(i.id))
  const freshIds = new Set(fresh.map(i => i.id))
  const keptPins = args.pinnedItems.filter(p => !freshIds.has(p.id) && !dismissed.has(p.id))
  return keptPins.concat(fresh)
}

/** 單欄重抓後就地換掉那一欄（其他欄不動，釘選的留著）。 */
export function replaceSection(args: {
  items: NewsItem[]
  sources: NewsSource[]
  sectionGroupId: string
  freshItems: NewsItem[]
  dismissedIds: string[]
  pinnedIds: string[]
}): NewsItem[] {
  const dismissed = new Set(args.dismissedIds)
  const pinned = new Set(args.pinnedIds)
  const kept = args.items.filter(
    i => sectionIdOf(i, args.sources) !== args.sectionGroupId || pinned.has(i.id)
  )
  const keptIds = new Set(kept.map(i => i.id))
  const fresh = args.freshItems.filter(i => !dismissed.has(i.id) && !keptIds.has(i.id))
  return kept.concat(fresh)
}

/** 加一筆「不看了」，維持上限。已存在就原樣回傳（不必要的寫回會多打一次端點）。 */
export function addDismissed(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids
  return ids.concat([id]).slice(-MAX_DISMISSED)
}

/** 釘選的排在該欄最前（換一批後仍看得到自己留的那幾則）。 */
export function sortPinnedFirst(items: NewsItem[], pinnedIds: string[]): NewsItem[] {
  const pinned = new Set(pinnedIds)
  return items.slice().sort((a, b) => (pinned.has(b.id) ? 1 : 0) - (pinned.has(a.id) ? 1 : 0))
}

// ── 關鍵字管理（owner 2026-08-06 回報：新增／刪除／排序／分組要合成一個畫面）──
//
// 這一段服務的是「興趣關鍵字管理」畫面，跟上面「新聞報要抓哪些組」是兩件事：
// 上面的 `visibleKeywordSources` 用 `selectedGroupIds` 篩選「要不要抓」，
// 這裡的 `groupSourcesByKeywordGroup` 是把**全部**關鍵字依「屬於哪組」分桶顯示，
// 讓使用者不必開下拉選單就能看出每個關鍵字在哪一組（owner 原話「一目了然」）。

export interface KeywordGroupBucket {
  group: NewsKeywordGroup
  sources: NewsSource[]
}

/**
 * 把興趣關鍵字（不含地方新聞帶入的）依所屬組分桶，依 `groups` 的順序排列，
 * 組內維持 `sources` 原本的相對順序（上移／下移操作的就是這個順序）。
 * 停用的關鍵字也列出來（管理畫面要能重新啟用），但地方新聞來源不列——那不是使用者自己加的。
 *
 * ⚠️ **空組也回傳**（不像 `groupNewsItemsByKeyword` 那種「顯示用」分欄會把空欄濾掉）——
 * 這支是給管理畫面用的：剛新增的組在還沒放進第一個關鍵字之前就是空的，
 * 濾掉的話新增組之後畫面上會找不到它，等於新增功能點了像沒反應。
 */
export function groupSourcesByKeywordGroup(
  sources: NewsSource[],
  groups: NewsKeywordGroup[]
): KeywordGroupBucket[] {
  const buckets = new Map<string, NewsSource[]>()
  for (const g of groups) buckets.set(g.id, [])
  for (const s of sources) {
    if (s.type !== 'keyword') continue
    const gid = effectiveGroupId(s.groupId)
    const bucket = buckets.get(gid) ?? buckets.get(DEFAULT_KEYWORD_GROUP_ID)
    bucket?.push(s)
  }
  return groups.map((group) => ({ group, sources: buckets.get(group.id) ?? [] }))
}

/** 移到另一組（跨組移動，與上移／下移的「組內排序」是兩回事）。 */
export function withSourceGroup(sources: NewsSource[], id: string, groupId: string): NewsSource[] {
  const effective = effectiveGroupId(groupId)
  return sources.map((s) =>
    s.id === id ? { ...s, groupId: effective === DEFAULT_KEYWORD_GROUP_ID ? undefined : effective } : s
  )
}

export function withSourceWeight(sources: NewsSource[], id: string, weight: NewsWeight): NewsSource[] {
  return sources.map((s) => (s.id === id ? { ...s, weight } : s))
}

export function withSourceLabel(sources: NewsSource[], id: string, label: string): NewsSource[] {
  const trimmed = label.trim()
  if (!trimmed) return sources
  return sources.map((s) => (s.id === id ? { ...s, label: trimmed } : s))
}

export function withSourceEnabled(sources: NewsSource[], id: string, enabled: boolean): NewsSource[] {
  return sources.map((s) => (s.id === id ? { ...s, enabled } : s))
}

export function withoutSource(sources: NewsSource[], id: string): NewsSource[] {
  return sources.filter((s) => s.id !== id)
}

/**
 * 新增一個關鍵字。**不帶 id**：由電腦端產生（`normalizeSource`）——手機上
 * `crypto.randomUUID()` 在非安全內容（`http://192.168.x.x`）不存在，
 * 計畫書 §4.10 第 3 點踩過同一個坑。
 */
export function withNewKeyword(sources: NewsSource[], label: string, groupId: string): NewsSource[] {
  const trimmed = label.trim()
  if (!trimmed) return sources
  const effective = effectiveGroupId(groupId)
  return sources.concat([
    {
      id: '',
      type: 'keyword',
      label: trimmed,
      weight: 'normal',
      enabled: true,
      origin: 'user',
      groupId: effective === DEFAULT_KEYWORD_GROUP_ID ? undefined : effective
    }
  ])
}
