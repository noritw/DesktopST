import { useCallback, useEffect, useState } from 'react'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from '../settings/settingsErrors'

/**
 * 對話的重新命名／刪除（B3 階段 8 統一 UI 操作邏輯）。
 *
 * 刪除故意不放在 `ConversationsView` 的清單列上，要先點進編輯才找得到——
 * 跟角色卡編輯器、預設組編輯器同一套邏輯：危險操作多一層，減少誤按
 * （owner 2026-08-05 回報對話／情境／世界觀／角色庫四處的操作位置不統一）。
 */
export function ConversationEditor({ conversationId }: { conversationId: string }): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const pop = useUiStore((s) => s.pop)
  const refresh = useAppStore((s) => s.refresh)

  const [title, setTitle] = useState<string | null>(null)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)

  const [memoryOpen, setMemoryOpen] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [summaryDirty, setSummaryDirty] = useState(false)
  const [coveredCount, setCoveredCount] = useState(0)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryNotice, setSummaryNotice] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const list = await getData().conversations.list()
      const item = list.find((c) => c.id === conversationId)
      if (!item) {
        toast('找不到這個對話，可能已經被刪掉了', 'error')
        pop()
        return
      }
      setTitle(item.title)
      setActive(item.active)
      const mem = await getData().conversations.getMemory(conversationId)
      setSummaryDraft(mem.summary)
      setCoveredCount(mem.coveredCount)
      setSummaryDirty(false)
      setSummaryNotice(null)
    } catch (e) {
      toast(describeSettingsError(e, '載入對話'), 'error')
    }
  }, [conversationId, toast, pop])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (): Promise<void> => {
    if (title === null) return
    setBusy(true)
    try {
      await getData().conversations.rename(conversationId, title)
      toast('已儲存')
      pop()
    } catch (e) {
      toast(describeSettingsError(e, '儲存'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    const ok = await confirm({
      title: `刪除「${title ?? ''}」`,
      message: '這個對話裡的訊息會一起刪掉，而且不能復原。',
      confirmLabel: '刪除',
      destructive: true
    })
    if (!ok) return
    setBusy(true)
    try {
      await getData().conversations.remove(conversationId)
      // 刪的如果是目前使用中的那個，電腦端會自動換到另一個，訊息串要跟著換。
      if (active) await refresh()
      toast('已刪除')
      pop()
    } catch (e) {
      toast(describeSettingsError(e, '刪除'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const runSummarizeNow = async (): Promise<void> => {
    setSummarizing(true)
    setSummaryNotice(null)
    try {
      const r = await getData().conversations.summarizeMemoryNow(conversationId)
      if (!r.ok) setSummaryNotice(r.error ?? '摘要失敗')
      else if (r.noNew) setSummaryNotice('目前沒有需要摘要的舊訊息')
      else {
        setSummaryDraft(r.summary ?? '')
        setCoveredCount(r.coveredCount ?? 0)
        setSummaryDirty(false)
        setSummaryNotice('摘要已更新')
      }
    } catch (e) {
      setSummaryNotice(describeSettingsError(e, '摘要'))
    } finally {
      setSummarizing(false)
    }
  }

  const saveSummary = async (): Promise<void> => {
    try {
      await getData().conversations.updateMemory(conversationId, summaryDraft)
      setSummaryDirty(false)
      setSummaryNotice('已儲存')
    } catch (e) {
      setSummaryNotice(describeSettingsError(e, '儲存'))
    }
  }

  const clearSummary = async (): Promise<void> => {
    const ok = await confirm({
      title: '清除記憶摘要',
      message: '角色將不再記得已被濃縮的舊對話內容，這個動作不能復原。',
      confirmLabel: '清除',
      destructive: true
    })
    if (!ok) return
    try {
      await getData().conversations.clearMemory(conversationId)
      setSummaryDraft('')
      setCoveredCount(0)
      setSummaryDirty(false)
      setSummaryNotice(null)
    } catch (e) {
      setSummaryNotice(describeSettingsError(e, '清除'))
    }
  }

  if (title === null) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>

  return (
    <div className="space-y-4 pb-2">
      <label className="block text-sm text-[var(--text)]">
        <span className="mb-1 block font-medium">標題</span>
        <input
          className="field"
          maxLength={60}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)]">
        <button
          type="button"
          onClick={() => setMemoryOpen((o) => !o)}
          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm text-[var(--text)]"
        >
          <span>
            🧠 記憶摘要
            {summaryDraft.trim() && (
              <span className="text-[var(--text-sub)]">
                {coveredCount > 0 ? ` · 已涵蓋 ${coveredCount} 則舊訊息` : ' · 手動筆記'}
              </span>
            )}
          </span>
          <span className="text-[var(--text-sub)]">{memoryOpen ? '▾' : '▸'}</span>
        </button>
        {memoryOpen && (
          <div className="space-y-2 border-t border-[var(--border)] px-3 py-3">
            <textarea
              className="field min-h-[96px]"
              value={summaryDraft}
              placeholder="還沒有摘要。按「立即摘要」讓 AI 整理超出近期記憶的舊訊息，或直接手寫想讓角色記住的事。"
              onChange={(e) => {
                setSummaryDraft(e.target.value)
                setSummaryDirty(true)
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={summarizing}
                onClick={() => void runSummarizeNow()}
                title="把超出近期記憶範圍、尚未涵蓋的舊訊息濃縮進摘要"
                className="rounded-full bg-[var(--mint)] px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-50"
              >
                {summarizing ? '摘要中…' : '立即摘要'}
              </button>
              <button
                type="button"
                disabled={!summaryDirty}
                onClick={() => void saveSummary()}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text)] disabled:opacity-50"
              >
                儲存編輯
              </button>
              <button
                type="button"
                onClick={() => void clearSummary()}
                className="rounded-full border border-[var(--danger)] px-3 py-1.5 text-xs text-[var(--danger)]"
              >
                清除
              </button>
              {summaryNotice && <span className="text-xs text-[var(--text-sub)]">{summaryNotice}</span>}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="w-full rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)] disabled:opacity-50"
      >
        儲存
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void remove()}
        className="w-full rounded-full border border-[var(--danger)] py-2.5 text-sm text-[var(--danger)] disabled:opacity-50"
      >
        刪除這個對話
      </button>
    </div>
  )
}
