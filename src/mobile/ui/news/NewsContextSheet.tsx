import { useEffect, useState } from 'react'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { openNewsOriginal } from './newsStore'

/**
 * 新聞上下文面板（手機）。
 *
 * 兩個地方共用，比照桌面的 `NewsContextPanel`（`NewsReaderWindow` ＋ `LogWindow`
 * 也是共用一份）：
 *   1. 新聞報的「聊這個」——送出前確認（`mode='confirm'`）
 *   2. 聊天紀錄點 📰 標題——改已送出訊息的上下文（`mode='edit'`）
 *
 * ⚠️ **版面：外層 flex column ＋ 只有中段捲**，不要整塊 `overflow-y-auto`。
 * 整塊捲會把按鈕推到捲動內容的最下面，加上 Android 手勢列吃掉畫面下緣，
 * 「確認帶去聊」就按不到了（owner 2026-08-12 回報）。
 * 高度用 `dvh` 不用 `vh`：`vh` 不含網址列／手勢列的動態高度。
 */

/** 「聊這個」需要的最小欄位；`NewsItem` 與 `NewsLinkInfo` 都餵得進來。 */
export interface NewsContextTarget {
  id: string
  title: string
  summary?: string
  url?: string
  source?: string
  sourceId?: string
  keyword?: string
}

export interface NewsContextSheetProps {
  target: NewsContextTarget | null
  mode: 'confirm' | 'edit'
  /**
   * 開啟當下 textarea 的內容。
   *
   * ⚠️ **空字串與 `undefined` 意義不同**：`''` 是使用者按過「清除摘要」，
   * 不可以拿 `summary` 補回去（補回去就等於清除鈕沒作用）。呼叫端請用 `??`。
   */
  initialDraft: string
  /** 開啟當下就整理一次（「聊這個」要，聊天紀錄不要——那邊已經有存好的值）。 */
  autoEnrich?: boolean
  onClose: () => void
  /** 確認前是「確認帶去聊」，已送出是「儲存」。 */
  onSave: (promptContext: string) => void | Promise<void>
  /** 只有 `mode='edit'` 給：清成空字串，之後 Prompt 只留標題。 */
  onClear?: () => void | Promise<void>
}

/**
 * enrich 的 `warning`／`source` 翻成給使用者看的一句話。
 *
 * 與桌面 `NewsReaderWindow.hintFromWarning` **逐字對齊**（只有末句改成手機的
 * 按鈕名「重新摘要」）。文案不進 core，所以兩邊各留一份；改一邊要改兩邊。
 */
export function hintFromWarning(warning?: string, source?: string): string {
  if (source === 'article-excerpt' || source === 'utility-summary' || source === 'rss-adequate') return ''
  if (!warning) return ''
  if (warning.startsWith('google-news') || warning.includes('interstitial')) {
    return '無法解析 Google 新聞原文連結，目前先用 RSS 摘要（可能只是相關標題串）。可手動改，或按「重新摘要」再試。'
  }
  // 403／401 是「這家網站擋掉自動抓取」（付費牆或防爬），重試永遠不會過——
  // 叫使用者「再試一次」是誤導（owner 2026-08-12 對天下雜誌連按三次都是 403）。
  if (/\b(401|403)\b/.test(warning)) {
    return '這家網站擋住了自動抓取，重試也不會過。可以按「原文 ↗」自己看，再手動補幾句。'
  }
  if (warning.startsWith('fetch-failed') || warning === 'empty-article') {
    return '抓原文失敗，目前先用 RSS 摘要。可手動改，或按「重新摘要」再試。'
  }
  return '自動整理未完成，目前先用 RSS 摘要。可手動改正。'
}

const FAIL_HINT = '自動整理失敗，目前先用 RSS 摘要。可手動改，或按「重新摘要」再試。'

export function NewsContextSheet({
  target, mode, initialDraft, autoEnrich, onClose, onSave, onClear
}: NewsContextSheetProps): JSX.Element | null {
  const confirmDialog = useUiStore((s) => s.confirm)
  const [draft, setDraft] = useState(initialDraft)
  const [hint, setHint] = useState('')
  const [loading, setLoading] = useState(false)

  /**
   * 整理 promptContext（與桌面 `NewsReaderWindow.runEnrich` 同語意）。
   *
   * ⚠️ 失敗時**兩邊都回 `ok: true` ＋ `warning`**（獨立版見
   * `session.enrichNewsForChat`），所以不能只看 `ok`——只看 `ok` 會把
   * 「抓原文失敗、退回 RSS 摘要」悄悄畫成正常結果，使用者只看到一段沒總結過的字，
   * 不知道發生什麼事，也不知道可以重試（owner 2026-08-12 回報「無法總結」）。
   *
   * ⚠️ 定義在早退（`if (!target)`）**之前**：下面那個 effect 要用到它，
   * 而 hooks 不能寫在條件式 return 後面。
   */
  const runEnrich = (forceRefresh: boolean): void => {
    if (!target) return
    setLoading(true)
    setHint('')
    void getData().news.enrichForChat(target as never, forceRefresh)
      .then((r) => {
        if (r.ok && typeof r.promptContext === 'string') {
          setDraft(r.promptContext || target.summary || '')
          setHint(hintFromWarning(r.warning, r.source))
        } else {
          setDraft(target.summary || '')
          setHint(FAIL_HINT)
        }
      })
      .catch(() => {
        setDraft(target.summary || '')
        setHint(FAIL_HINT)
      })
      .finally(() => setLoading(false))
  }

  // deps 用 `target?.id` 而不是 `target`：呼叫端每次 render 都可能傳新物件進來，
  // 拿整個物件當 deps 等於每次 render 都重跑（「聊這個」會變成無限重抓）。
  const targetId = target?.id
  useEffect(() => {
    if (!targetId) return
    setDraft(initialDraft)
    setHint('')
    setLoading(false)
    if (autoEnrich) runEnrich(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId])

  if (!target) return null

  /** 重新摘要：`forceRefresh` 會跳過 enrich 快取，真的重抓原文再叫輔助模型。 */
  const reEnrich = async (): Promise<void> => {
    if (loading) return
    const edited = draft.trim()
    // 清空之後按「重新摘要」是**反悔**，不必問——沒有東西會被蓋掉。
    if (edited && edited !== (target.summary || '').trim()) {
      const ok = await confirmDialog({
        title: '重新摘要？',
        message: '目前這段有手動修改過，重新摘要會覆蓋掉。',
        confirmLabel: '重新摘要'
      })
      if (!ok) return
    }
    runEnrich(true)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-black/30" onClick={onClose}>
      <div
        className="flex max-h-[85dvh] w-full flex-col rounded-t-2xl border border-[var(--border)] bg-[var(--surface)]"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 pb-2 pt-4">
          <p className="text-sm font-semibold leading-snug text-[var(--text)]">{target.title}</p>
          {target.source && <p className="mt-0.5 text-[11px] text-[var(--text-sub)]">來源：{target.source}</p>}
          <p className="mt-1 text-[12px] text-[var(--text-sub)]">
            這段會寫進角色看到的背景，不會整段出現在聊天泡泡裡。
          </p>
          {hint && !loading && (
            <p className="mt-2 rounded-[12px] bg-[var(--mint)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--text)]">
              {hint}
            </p>
          )}
        </div>

        <div className="scroll-y min-h-0 flex-1 px-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-[var(--text-sub)]">整理中…</p>
          ) : (
            <textarea
              className="min-h-[140px] w-full rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[16px] leading-relaxed text-[var(--text)]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="（僅標題，尚無可用摘要）"
            />
          )}
        </div>

        {/* 與桌面 NewsContextPanel 同一排功能 */}
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 pt-2.5">
          {target.url && (
            <SmallButton label="原文 ↗" onClick={() => void openNewsOriginal(target.url, target.sourceId)} />
          )}
          <SmallButton
            label={loading ? '整理中⋯⋯' : '重新摘要'}
            disabled={loading}
            onClick={() => void reEnrich()}
          />
          {onClear && (
            <SmallButton label="清除摘要" disabled={loading} onClick={() => void onClear()} />
          )}
        </div>

        <div className="flex shrink-0 gap-2 px-4 pt-2">
          <button
            type="button"
            className="flex-1 rounded-full border border-[var(--border)] py-2.5 text-sm"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            disabled={loading}
            className="flex-1 rounded-full bg-[var(--mint)] py-2.5 text-sm font-semibold text-[var(--text)] disabled:opacity-50"
            onClick={() => void onSave(draft.trim())}
          >
            {mode === 'confirm' ? '確認帶去聊' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SmallButton({
  label, onClick, disabled
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-full border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-sub)] disabled:opacity-40"
    >
      {label}
    </button>
  )
}
