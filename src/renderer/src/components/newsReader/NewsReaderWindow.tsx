import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react'
import MonoIcon from '../MonoIcon'
import { groupNewsItems, groupNewsItemsByKeyword } from './groupNewsItems'
import { useNewsReaderStore } from './useNewsReaderStore'
import type { NewsItem } from '../../modules/news/types'

function formatPublishedAt(iso: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const diffMs = Date.now() - t
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return '剛剛'
  if (mins < 60) return `${mins} 分鐘前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小時前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  try {
    return new Date(iso).toLocaleString('zh-TW', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return iso
  }
}

/** 報紙欄標題：關鍵字名 + 可直接改的抓取則數 + 單欄重抓 */
function KeywordSectionHeader({
  sectionGroupId,
  label,
  shownCount,
  dragHandleProps
}: {
  sectionGroupId: string
  label: string
  shownCount: number
  dragHandleProps?: {
    draggable: boolean
    onDragStart: (e: DragEvent) => void
    onDragEnd: () => void
  }
}) {
  const getSectionQuota = useNewsReaderStore(s => s.getSectionQuota)
  const setSectionQuota = useNewsReaderStore(s => s.setSectionQuota)
  const refreshSection = useNewsReaderStore(s => s.refreshSection)
  const isLoading = useNewsReaderStore(s => s.isLoading)
  const refreshingSectionId = useNewsReaderStore(s => s.refreshingSectionId)
  const quota = getSectionQuota(sectionGroupId)
  const [draft, setDraft] = useState(String(quota))
  const sectionBusy = refreshingSectionId === sectionGroupId

  useEffect(() => {
    setDraft(String(quota))
  }, [quota])

  const commit = () => {
    const n = Math.floor(Number(draft))
    if (!Number.isFinite(n)) {
      setDraft(String(quota))
      return
    }
    const clamped = Math.max(0, Math.min(20, n))
    setDraft(String(clamped))
    if (clamped === quota) return
    void setSectionQuota(sectionGroupId, clamped)
  }

  return (
    <header className="flex items-center gap-1.5 px-2.5 py-2 border-b border-border bg-mint-20 shrink-0">
      {dragHandleProps?.draggable && (
        <span
          className="cursor-grab active:cursor-grabbing text-secondary/70 text-xs px-0.5 select-none shrink-0"
          title="拖曳調整欄位順序"
          {...dragHandleProps}
        >
          ⋮⋮
        </span>
      )}
      <h2 className="text-xs font-bold text-primary truncate flex-1 min-w-0">{label}</h2>
      <button
        type="button"
        className="shrink-0 w-6 h-6 rounded-full border border-border bg-surface text-[11px] text-primary hover:bg-mint transition-colors disabled:opacity-50"
        title="只重抓這一欄"
        disabled={isLoading || !!refreshingSectionId}
        onMouseDown={e => {
          // 避免點按鈕時旁邊「則」輸入框 blur → 誤觸整頁重抓
          e.preventDefault()
        }}
        onClick={e => {
          e.stopPropagation()
          void refreshSection(sectionGroupId)
        }}
      >
        {sectionBusy ? '…' : '↻'}
      </button>
      <label className="flex items-center gap-1 shrink-0" title="此欄抓取則數（改完按 Enter 或點外面）">
        <input
          type="number"
          min={0}
          max={20}
          disabled={isLoading || sectionBusy}
          value={draft}
          className="w-10 text-center text-[11px] font-semibold text-primary rounded-full border border-border bg-surface px-1 py-0.5 outline-none focus:border-teal disabled:opacity-50"
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
            if (e.key === 'Escape') {
              setDraft(String(quota))
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          onClick={e => e.stopPropagation()}
        />
        <span className="text-[10px] text-secondary">則</span>
      </label>
      {shownCount !== quota && (
        <span className="text-[10px] text-secondary/70 shrink-0" title="實際顯示則數（可能因釘選而多於目標）">
          現{shownCount}
        </span>
      )}
    </header>
  )
}

/** 報紙格內的緊湊標題卡 */
function NewsHeadlineCell({
  item,
  showSummary
}: {
  item: NewsItem
  showSummary: boolean
}) {
  const insertToInput = useNewsReaderStore(s => s.insertToInput)
  const togglePin = useNewsReaderStore(s => s.togglePin)
  const dismissItem = useNewsReaderStore(s => s.dismissItem)
  const pinned = useNewsReaderStore(s => s.pinnedItems.some(p => p.id === item.id))
  const [inserted, setInserted] = useState(false)

  const openOriginal = () => {
    if (!item.url) return
    void window.api.invoke('shell:open-external', item.url)
    if (item.sourceId) void window.api.invoke('news:mark-opened', item.sourceId)
  }

  const handleInsert = (e: MouseEvent) => {
    e.stopPropagation()
    insertToInput(item)
    setInserted(true)
    window.setTimeout(() => setInserted(false), 1500)
  }

  const handlePin = (e: MouseEvent) => {
    e.stopPropagation()
    togglePin(item)
  }

  const handleDismiss = (e: MouseEvent) => {
    e.stopPropagation()
    dismissItem(item.id)
  }

  return (
    <article
      className={`group/cell relative rounded-xl border px-2.5 py-2 transition-colors ${
        pinned
          ? 'border-teal bg-mint-20'
          : 'border-border/70 bg-surface-85/80 hover:border-teal hover:bg-mint-20'
      }`}
    >
      <div className="flex gap-1 items-start">
        <button
          type="button"
          className="text-left flex-1 min-w-0 text-[12px] font-semibold text-primary leading-snug line-clamp-3 hover:text-teal transition-colors"
          onClick={openOriginal}
          title={item.title}
        >
          {item.title}
        </button>
        <button
          type="button"
          className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${
            pinned
              ? 'border-teal bg-mint text-primary'
              : 'border-border bg-surface text-secondary opacity-60 group-hover/cell:opacity-100 hover:bg-mint hover:text-primary'
          }`}
          onClick={handlePin}
          title={pinned ? '取消釘選' : '釘選（換一批時保留）'}
        >
          <MonoIcon name="pin" className="w-3 h-3" />
        </button>
        <button
          type="button"
          className="shrink-0 w-6 h-6 rounded-full border border-border bg-surface text-secondary opacity-60 group-hover/cell:opacity-100 hover:bg-[#FFE2D8] hover:text-[#E85D3F] hover:border-[#FFB59F] transition-colors flex items-center justify-center"
          onClick={handleDismiss}
          title="這則不要看了"
        >
          <MonoIcon name="close" className="w-3 h-3" />
        </button>
      </div>
      {showSummary && item.summary.trim() && (
        <p className="mt-1 text-[10px] text-secondary leading-relaxed line-clamp-2">
          {item.summary}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-1.5 min-w-0">
        <span className="text-[10px] text-secondary truncate min-w-0">
          {item.source || '未知'}
        </span>
        {item.publishedAt && (
          <span className="text-[10px] text-secondary/70 shrink-0">
            {formatPublishedAt(item.publishedAt)}
          </span>
        )}
        <button
          type="button"
          className="ml-auto shrink-0 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-primary opacity-70 group-hover/cell:opacity-100 hover:bg-mint transition-all"
          onClick={handleInsert}
          title="把這則新聞放進輸入框當話題"
        >
          {inserted ? '✓' : '聊這個'}
        </button>
      </div>
    </article>
  )
}

export default function NewsReaderWindow() {
  const items = useNewsReaderStore(s => s.items)
  const sources = useNewsReaderStore(s => s.sources)
  const keywordGroups = useNewsReaderStore(s => s.keywordGroups)
  const readerKeywordGroupIds = useNewsReaderStore(s => s.readerKeywordGroupIds)
  const isLoading = useNewsReaderStore(s => s.isLoading)
  const error = useNewsReaderStore(s => s.error)
  const displayMode = useNewsReaderStore(s => s.displayMode)
  const activeTab = useNewsReaderStore(s => s.activeTab)
  const fetchedAt = useNewsReaderStore(s => s.fetchedAt)
  const fetchNews = useNewsReaderStore(s => s.fetchNews)
  const setDisplayMode = useNewsReaderStore(s => s.setDisplayMode)
  const setActiveTab = useNewsReaderStore(s => s.setActiveTab)
  const setReaderKeywordGroups = useNewsReaderStore(s => s.setReaderKeywordGroups)
  const reorderSources = useNewsReaderStore(s => s.reorderSources)
  const [dragSectionId, setDragSectionId] = useState<string | null>(null)

  useEffect(() => {
    void fetchNews()
  }, [fetchNews])

  // 頂部篩選：依關鍵字「組」
  const filterTabs = useMemo(
    () => groupNewsItems(items, sources, keywordGroups),
    [items, sources, keywordGroups]
  )

  const scopedItems = useMemo(() => {
    if (activeTab === 'all') return items
    const tab = filterTabs.find(g => g.groupId === activeTab)
    return tab?.items ?? []
  }, [items, filterTabs, activeTab])

  // 報紙牆：依單一關鍵字分框
  const keywordSections = useMemo(
    () => groupNewsItemsByKeyword(scopedItems, sources),
    [scopedItems, sources]
  )

  const allGroupsMode = readerKeywordGroupIds.length === 0

  const toggleReaderGroup = (groupId: string) => {
    if (allGroupsMode) {
      void setReaderKeywordGroups([groupId])
      return
    }
    const selected = readerKeywordGroupIds.includes(groupId)
    const next = selected
      ? readerKeywordGroupIds.filter(id => id !== groupId)
      : [...readerKeywordGroupIds, groupId]
    void setReaderKeywordGroups(next)
  }

  useEffect(() => {
    if (activeTab === 'all') return
    if (filterTabs.length === 0) return
    if (!filterTabs.some(g => g.groupId === activeTab)) {
      setActiveTab('all')
    }
  }, [filterTabs, activeTab, setActiveTab])

  const handleClose = () => window.api.invoke('window:close-self').catch(console.error)
  const handleOpenSettings = () => void window.api.invoke('news:open-settings-tab')
  const handleRefresh = () => void fetchNews()

  const sectionSourceId = (groupId: string): string | null => {
    if (groupId.startsWith('kw:')) return groupId.slice(3)
    if (groupId.startsWith('feed:')) return groupId.slice(5)
    return null
  }

  const handleSectionDrop = (targetGroupId: string) => {
    if (!dragSectionId || dragSectionId === targetGroupId) {
      setDragSectionId(null)
      return
    }
    const fromId = sectionSourceId(dragSectionId)
    const toId = sectionSourceId(targetGroupId)
    if (!fromId || !toId) {
      setDragSectionId(null)
      return
    }
    const order = sources.map(s => s.id)
    const from = order.indexOf(fromId)
    const to = order.indexOf(toId)
    if (from < 0 || to < 0) {
      setDragSectionId(null)
      return
    }
    const next = [...order]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    void reorderSources(next)
    setDragSectionId(null)
  }

  const fetchedLabel = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
    : null

  const totalCount = items.length

  return (
    <div className="relative w-full h-full flex flex-col bg-bg border border-border rounded-2xl overflow-hidden shadow-panel">
      <div className="drag-region absolute left-0 right-0 top-0 h-12" />

      <div className="drag-region relative flex items-center justify-between px-4 py-3 border-b border-border shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0" aria-hidden>📰</span>
          <span className="text-sm font-bold text-primary truncate">個人新聞報</span>
          {totalCount > 0 && !isLoading && (
            <span className="text-[11px] text-secondary bg-mint-20 rounded-full px-2 py-0.5 shrink-0">
              {totalCount} 則
            </span>
          )}
          {fetchedLabel && !isLoading && (
            <span className="text-[11px] text-secondary shrink-0">{fetchedLabel}</span>
          )}
        </div>
        <div className="no-drag flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            className="rounded-full border border-border bg-surface-85 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-mint transition-colors disabled:opacity-50"
            onClick={handleRefresh}
            disabled={isLoading}
            title="重新向來源抓取"
          >
            {isLoading ? '載入中…' : '重新整理'}
          </button>
          <button
            type="button"
            className="rounded-full border border-border bg-surface-85 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-mint transition-colors disabled:opacity-50"
            onClick={() => void fetchNews({ excludeCurrent: true })}
            disabled={isLoading || items.length === 0}
            title="把目前標題換掉，優先抽還沒看過的"
          >
            換一批
          </button>
          <button
            type="button"
            className="rounded-full border border-border bg-surface-85 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-mint transition-colors"
            onClick={() => setDisplayMode(displayMode === 'title' ? 'title-summary' : 'title')}
            title="切換顯示模式"
          >
            {displayMode === 'title' ? '標題' : '標題＋摘要'}
          </button>
          <button
            type="button"
            className="w-6 h-6 rounded-full border border-border bg-surface text-secondary hover:text-primary hover:bg-mint transition-colors flex items-center justify-center"
            onClick={handleOpenSettings}
            title="新聞設定"
          >
            <MonoIcon name="settings" className="w-3 h-3" />
          </button>
          <button
            type="button"
            className="w-6 h-6 rounded-full border border-border bg-surface text-secondary hover:text-primary hover:bg-mint transition-colors flex items-center justify-center"
            onClick={handleClose}
            title="關閉"
          >
            <MonoIcon name="close" className="w-3 h-3" />
          </button>
        </div>
      </div>

      {keywordGroups.length > 0 && (
        <div className="no-drag shrink-0 border-b border-border px-3 py-2 space-y-1.5">
          <p className="text-[10px] text-secondary">抓取範圍（可多選；與聊天用的情境組分開）</p>
          <div className="flex gap-1.5 overflow-x-auto min-w-min pb-0.5">
            <button
              type="button"
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                allGroupsMode
                  ? 'bg-teal border-teal text-primary'
                  : 'bg-surface-85 border-border text-secondary hover:bg-mint'
              }`}
              onClick={() => void setReaderKeywordGroups([])}
              disabled={isLoading}
            >
              全部組
            </button>
            {keywordGroups.map(g => {
              const selected = !allGroupsMode && readerKeywordGroupIds.includes(g.id)
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                    selected
                      ? 'bg-mint border-teal text-primary'
                      : 'bg-surface-85 border-border text-secondary hover:bg-mint'
                  }`}
                  onClick={() => toggleReaderGroup(g.id)}
                  disabled={isLoading}
                >
                  {selected ? '✓ ' : ''}{g.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {filterTabs.length > 1 && (
        <div className="no-drag shrink-0 border-b border-border bg-surface-45 px-3 py-2 overflow-x-auto">
          <div className="flex gap-1.5 min-w-min">
            <button
              type="button"
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                activeTab === 'all'
                  ? 'bg-mint border-teal text-primary'
                  : 'bg-surface-85 border-border text-secondary hover:bg-mint'
              }`}
              onClick={() => setActiveTab('all')}
            >
              全部
            </button>
            {filterTabs.map(g => (
              <button
                key={g.groupId}
                type="button"
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                  activeTab === g.groupId
                    ? 'bg-mint border-teal text-primary'
                    : 'bg-surface-85 border-border text-secondary hover:bg-mint'
                }`}
                onClick={() => setActiveTab(g.groupId)}
              >
                {g.label}
                <span className="ml-1 opacity-70">{g.items.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="no-drag flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-secondary text-sm">
            <span className="animate-pulse">正在抓取各組新聞…</span>
          </div>
        )}

        {!isLoading && error && items.length === 0 && (
          <div className="rounded-2xl border border-[#FFB59F] bg-[#FFE2D8] px-4 py-3 text-sm text-[#9B3535]">
            <p className="font-semibold">抓取失敗</p>
            <p className="mt-1 text-xs opacity-90">{error}</p>
            <button
              type="button"
              className="mt-3 rounded-full border border-[#FFB59F] bg-surface px-3 py-1 text-xs font-semibold text-primary hover:bg-mint transition-colors"
              onClick={handleRefresh}
            >
              重試
            </button>
          </div>
        )}

        {!isLoading && error && items.length > 0 && (
          <div className="mb-2 rounded-2xl border border-border bg-mint-20 px-3 py-2 text-xs text-primary">
            {error}
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center px-4">
            <p className="text-sm text-secondary">目前沒有符合條件的新聞</p>
            <p className="text-xs text-secondary/80">
              可先確認新聞模組已啟用，並在各關鍵字組設定興趣標籤。
            </p>
            <button
              type="button"
              className="rounded-full border border-border bg-surface-85 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-mint transition-colors"
              onClick={handleOpenSettings}
            >
              開啟新聞設定
            </button>
          </div>
        )}

        {/* 報紙牆：關鍵字分框 × 格子排版 */}
        {keywordSections.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {keywordSections.map(section => {
              const canDrag = !!sectionSourceId(section.groupId)
              return (
              <section
                key={section.groupId}
                className={`rounded-2xl border-2 bg-surface overflow-hidden flex flex-col min-h-0 transition-colors ${
                  dragSectionId === section.groupId
                    ? 'border-teal opacity-70'
                    : dragSectionId && canDrag
                      ? 'border-border border-dashed'
                      : 'border-border'
                }`}
                onDragOver={e => {
                  if (!canDrag || !dragSectionId) return
                  e.preventDefault()
                }}
                onDrop={e => {
                  e.preventDefault()
                  if (canDrag) handleSectionDrop(section.groupId)
                }}
              >
                <KeywordSectionHeader
                  sectionGroupId={section.groupId}
                  label={section.label}
                  shownCount={section.items.length}
                  dragHandleProps={canDrag ? {
                    draggable: true,
                    onDragStart: (e) => {
                      setDragSectionId(section.groupId)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', section.groupId)
                    },
                    onDragEnd: () => setDragSectionId(null)
                  } : undefined}
                />
                <div className="p-2 grid grid-cols-1 gap-1.5">
                  {section.items.map(item => (
                    <NewsHeadlineCell
                      key={item.id}
                      item={item}
                      showSummary={displayMode === 'title-summary'}
                    />
                  ))}
                </div>
              </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
