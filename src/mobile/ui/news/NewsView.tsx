import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import MonoIcon from '@shared/MonoIcon'
import { sectionQuota, sortPinnedFirst } from '@core/news/reader'
import type { ReaderSection } from '@core/news/reader'
import type { NewsItem } from '@core/news/types'
import type { NewsLinkInfo } from '@core/types'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { useComposerStore } from '../stores/composerStore'
import { useNewsStore, selectSections } from './newsStore'
import { NewsCard } from './NewsCard'
import { NewsKeywordsPanel } from './NewsKeywordsPanel'

/**
 * 個人新聞報（清單 F1–F13，B3 階段 6）。
 *
 * 桌面是報紙式多欄並排；375px 寬放不下，所以把桌面的欄位篩選升格為
 * **分頁 chips** 當主要導覽（規劃書 §4.2）。抓取仍然在電腦上做
 * （不吃手機流量、也不必在手機重寫一份抓取邏輯）。
 */

/** 固定欄的標題。UI 文案不進 core，core 只回 `kind`（見 `@core/news/reader`）。 */
const FIXED_SECTION_LABELS: Record<string, string> = {
  breakout: '🔥 熱門話題',
  local: '📍 地方新聞',
  other: '其他'
}

function sectionLabel(sec: ReaderSection): string {
  return sec.label || FIXED_SECTION_LABELS[sec.kind] || sec.groupId
}

export function NewsView(): JSX.Element {
  const state = useNewsStore()
  const push = useUiStore((s) => s.push)
  // ⚠️ 用 useMemo 而不是 zustand selector：回傳新陣列的 selector 會讓
  // `useSyncExternalStore` 每次比對都不相等 → 無限重繪（見 newsStore 檔尾註解）。
  const sections = useMemo(() => selectSections(state.items, state.sources), [state.items, state.sources])

  useEffect(() => {
    void useNewsStore.getState().open()
  }, [])

  // 目前分頁所屬的欄已經沒東西了 → 退回「全部」，否則會看到空畫面卻不知道為什麼。
  // deps 用欄位 id 串起來的字串：`sections` 每次 render 都是新陣列，直接當 deps
  // 等於沒有 deps（每次都跑）。
  const sectionKey = sections.map((s) => s.groupId).join('|')
  useEffect(() => {
    if (state.activeTab !== 'all' && sections.length > 0 && !sections.some((s) => s.groupId === state.activeTab)) {
      useNewsStore.getState().setActiveTab('all')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeTab, sectionKey])

  const shown = state.activeTab === 'all' ? sections : sections.filter((s) => s.groupId === state.activeTab)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── 工具列 ─────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1.5 pb-2">
        <ToolButton
          label={state.displayMode === 'title' ? '顯示：標題' : '顯示：標題＋摘要'}
          onClick={state.toggleDisplayMode}
        />
        <ToolButton
          icon="sliders"
          label="管理關鍵字"
          active={state.optionsOpen}
          onClick={state.toggleOptions}
        />
        <button
          type="button"
          aria-label="新聞設定"
          onClick={() => push('news-settings')}
          className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-sub)]"
        >
          <MonoIcon name="settings" className="h-4 w-4" />
        </button>
      </div>

      {/* ── 分頁 chips（管理面板開著時先不占位置——它自己已經有一排「要抓
          哪些組」的 chips，兩排疊在一起只會擠壓管理面板能捲動的空間） ── */}
      {!state.optionsOpen && sections.length > 0 && (
        <div className="scroll-x -mx-1 flex shrink-0 gap-1.5 px-1 pb-2">
          <TabChip label="全部" on={state.activeTab === 'all'} onClick={() => state.setActiveTab('all')} />
          {sections.map((sec) => (
            <TabChip
              key={sec.groupId}
              label={sectionLabel(sec)}
              on={state.activeTab === sec.groupId}
              onClick={() => state.setActiveTab(sec.groupId)}
            />
          ))}
        </div>
      )}

      {/* ── 內容／管理關鍵字：同一個捲動區 ──────────────────
          管理面板原本是這個捲動區外面的一個 flex 子項，Sheet 本身
          `scrollable=false`（新聞報自己管捲動），面板長度一多就會被
          `85dvh` 的 Sheet 高度切掉、完全捲不到——「切不了組、看不到其他
          關鍵字」正是這樣來的。面板現在移進同一個 `.scroll-y` 容器，
          開著的時候整段取代新聞清單，關掉再切回去。 ── */}
      <div className="scroll-y min-h-[38dvh] flex-1">
        {state.optionsOpen ? <NewsKeywordsPanel /> : <NewsBody sections={shown} />}
      </div>

      {/* ── 底部：換一批 ───────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] pt-2.5">
        <button
          type="button"
          disabled={state.loading || !state.enabled}
          onClick={() => void state.fetchBatch(true)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)] disabled:opacity-50"
        >
          <MonoIcon name="refresh" className="h-4 w-4" />
          {state.loading ? '抓取中⋯⋯' : '換一批'}
        </button>
        <span className="shrink-0 text-[11px] text-[var(--text-sub)]">
          {state.fetchedAt ? `更新於 ${formatClock(state.fetchedAt)}` : ''}
        </span>
      </div>
    </div>
  )
}

function NewsBody({ sections }: { sections: ReaderSection[] }): JSX.Element {
  const state = useNewsStore()
  const toast = useUiStore((s) => s.toast)
  const popAll = useUiStore((s) => s.popAll)
  const insert = useComposerStore((s) => s.insert)
  const setPendingNewsLink = useComposerStore((s) => s.setPendingNewsLink)
  const pinnedIds = state.pinnedItems.map((p) => p.id)
  const [ctxItem, setCtxItem] = useState<NewsItem | null>(null)
  const [ctxDraft, setCtxDraft] = useState('')
  const [ctxLoading, setCtxLoading] = useState(false)

  const chatAbout = (item: NewsItem): void => {
    setCtxItem(item)
    setCtxDraft(item.summary || '')
    setCtxLoading(true)
    void getData().news.enrichForChat(item)
      .then((r) => {
        if (r.ok) setCtxDraft(r.promptContext || item.summary || '')
      })
      .catch(() => {
        setCtxDraft(item.summary || '')
      })
      .finally(() => setCtxLoading(false))
  }

  const confirmChatAbout = (): void => {
    if (!ctxItem) return
    const link: NewsLinkInfo = {
      id: ctxItem.id,
      sourceId: ctxItem.sourceId,
      title: ctxItem.title,
      url: ctxItem.url,
      summary: ctxItem.summary,
      source: ctxItem.source,
      keyword: ctxItem.keyword,
      promptContext: ctxDraft.trim()
    }
    setPendingNewsLink(link)
    insert(`${ctxItem.title}\n`)
    setCtxItem(null)
    popAll()
    toast('已放進輸入框（標題）')
  }

  // 模組沒開：說明怎麼開，不要只丟一句「未啟用」讓人不知道去哪找
  if (!state.enabled) {
    return (
      <Empty>
        新聞模組尚未啟用。
        <br />
        到「設定 → 模組開關」把新聞打開，就能在這裡看個人新聞報。
      </Empty>
    )
  }

  // 骨架：一批要抓 10–30 秒（規劃書 §5.2），只給一個轉圈看起來像當掉
  if (state.loading && state.items.length === 0) {
    return (
      <div className="space-y-2 py-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="anim-breathe h-[76px] rounded-[14px] bg-[var(--border)]" />
        ))}
      </div>
    )
  }

  if (state.error) {
    return (
      <Empty>
        {state.error}
        <br />
        <button
          type="button"
          onClick={() => void (state.loaded ? state.fetchBatch(false) : state.reload())}
          className="mt-3 rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]"
        >
          重試
        </button>
      </Empty>
    )
  }

  if (sections.length === 0) {
    return (
      <Empty>
        目前沒有新聞。
        <br />
        可以按下面的「換一批」，或到「新聞設定」調整關鍵字。
      </Empty>
    )
  }

  return (
    <div className="space-y-4 py-1">
      {ctxItem && (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/30" onClick={() => setCtxItem(null)}>
          <div
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-[var(--text)]">{ctxItem.title}</p>
            <p className="mt-1 text-[12px] text-[var(--text-sub)]">
              這段會寫進角色看到的背景，不會整段出現在聊天泡泡裡。
            </p>
            {ctxLoading ? (
              <p className="py-8 text-center text-sm text-[var(--text-sub)]">整理中…</p>
            ) : (
              <textarea
                className="mt-2 min-h-[140px] w-full rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
                value={ctxDraft}
                onChange={(e) => setCtxDraft(e.target.value)}
              />
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-full border border-[var(--border)] py-2.5 text-sm"
                onClick={() => setCtxItem(null)}
              >
                取消
              </button>
              <button
                type="button"
                disabled={ctxLoading}
                className="flex-1 rounded-full bg-[var(--mint)] py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
                onClick={confirmChatAbout}
              >
                確認放入輸入框
              </button>
            </div>
          </div>
        </div>
      )}
      {sections.map((sec) => (
        <div key={sec.groupId} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text)]">
              {sectionLabel(sec)}（{sec.items.length}）
            </span>
            {/* 熱門／關鍵字欄有獨立配額；地方／訂閱改的是全域每關鍵字預設（與桌面同行為） */}
            <QuotaInput
              label={sectionLabel(sec)}
              value={sectionQuota(sec.groupId, state.sources, {
                readerPerKeyword: state.readerPerKeyword,
                readerBreakoutQuota: state.readerBreakoutQuota
              })}
              onCommit={(n) => void state.setQuota(sec.groupId, n)}
            />
            <button
              type="button"
              disabled={state.refreshingSection != null}
              onClick={() => void state.refreshSection(sec.groupId)}
              className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-[var(--border)] px-3 text-[12px] text-[var(--text-sub)] disabled:opacity-40"
            >
              <MonoIcon name="refresh" className="h-3.5 w-3.5" />
              {state.refreshingSection === sec.groupId ? '重抓中⋯⋯' : '重抓'}
            </button>
          </div>

          {sortPinnedFirst(sec.items, pinnedIds).map((item) => (
            <NewsCard
              key={item.id}
              item={item}
              pinned={pinnedIds.includes(item.id)}
              displayMode={state.displayMode}
              onOpen={() => void state.openOriginal(item)}
              onTogglePin={() => void state.togglePin(item)}
              onChat={() => chatAbout(item)}
              onDismiss={() => void state.dismiss(item)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * 每欄則數（清單 F4）。
 *
 * ⚠️ **uncontrolled ＋ onBlur，不是 controlled**：打字打到一半就送出去會在
 * 每一次按鍵都重抓一整欄，而且組字中的輸入法會被回灌的值蓋掉。
 * `key` 帶上電腦端的現值，設定成功後才換掉畫面上的數字。
 * 沒改就不送——不必要的送出會白白重抓一欄（要 10 秒起跳）。
 */
function QuotaInput({
  label, value, onCommit
}: {
  label: string
  value: number
  onCommit: (n: number) => void
}): JSX.Element {
  return (
    <input
      key={value}
      type="number"
      inputMode="numeric"
      min={0}
      max={20}
      aria-label={`${label} 抓取則數`}
      defaultValue={value}
      onBlur={(e) => {
        const raw = Number(e.target.value)
        if (!Number.isFinite(raw)) { e.target.value = String(value); return }
        const n = Math.max(0, Math.min(20, Math.floor(raw)))
        if (n === value) { e.target.value = String(value); return }
        onCommit(n)
      }}
      className="h-9 w-14 shrink-0 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] text-center text-[16px] text-[var(--text)]"
    />
  )
}

function Empty({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="whitespace-pre-line py-10 text-center text-sm leading-relaxed text-[var(--text-sub)]">
      {children}
    </p>
  )
}

function ToolButton({
  icon, label, active, onClick
}: {
  icon?: 'sliders'
  label: string
  active?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center gap-1 rounded-full border px-3 text-[12px] ${
        active
          ? 'border-[var(--mint2)] bg-[var(--mint)] text-[var(--text)]'
          : 'border-[var(--border)] text-[var(--text-sub)]'
      }`}
    >
      {icon && <MonoIcon name={icon} className="h-3.5 w-3.5" />}
      {label}
    </button>
  )
}

function TabChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px] ${
        on
          ? 'border-[var(--mint2)] bg-[var(--mint)] text-[var(--text)]'
          : 'border-[var(--border)] text-[var(--text-sub)]'
      }`}
    >
      {label}
    </button>
  )
}

function formatClock(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
