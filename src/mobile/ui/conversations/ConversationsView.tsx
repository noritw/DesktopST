import { useCallback, useEffect, useState } from 'react'
import type { ConversationListItem } from '@core/data'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from '../settings/settingsErrors'
import { StatusChip } from '../shell/StatusChip'

/**
 * 對話清單（B3 階段 8，E1–E2）。
 *
 * 桌面切換對話時，手機端現在會靠 `state-invalidated` 重抓 `/api/state` 跟著換
 * （見 `src/main/index.ts` 的 `setMobileConversationHook`）；這裡管的是**手機主動
 * 切換／新增**。改名與刪除都收進 `ConversationEditor`（點 ✏️ 才進得去）——
 * 跟情境／世界觀／使用者設定（`PresetsView`）、角色庫同一套操作邏輯：
 * 每列左邊大按鈕＝「套用／切換」這組動作，右邊固定一顆 ✏️ 進編輯，
 * 危險的刪除不放在清單列上，避免手滑（owner 2026-08-05 回報四處操作位置不統一）。
 */
export function ConversationsView(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const push = useUiStore((s) => s.push)
  const pop = useUiStore((s) => s.pop)
  const refresh = useAppStore((s) => s.refresh)

  const [list, setList] = useState<ConversationListItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setFailed(false)
    try {
      setList(await getData().conversations.list())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const switchTo = async (item: ConversationListItem): Promise<void> => {
    if (item.active) {
      pop()
      return
    }
    setBusyId(item.id)
    try {
      await getData().conversations.load(item.id)
      await refresh()
      pop()
    } catch (e) {
      toast(describeSettingsError(e, '切換對話'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const create = async (): Promise<void> => {
    setCreating(true)
    try {
      await getData().conversations.create()
      await refresh()
      pop()
    } catch (e) {
      toast(describeSettingsError(e, '新增對話'), 'error')
    } finally {
      setCreating(false)
    }
  }

  if (failed) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--text-sub)]">載入對話清單失敗</p>
        <button type="button" onClick={() => void load()} className="mt-3 rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]">
          重試
        </button>
      </div>
    )
  }

  if (!list) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>

  return (
    <div className="pb-2">
      <button
        type="button"
        disabled={creating}
        onClick={() => void create()}
        className="mb-3 w-full rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)] disabled:opacity-50"
      >
        ＋ 新對話
      </button>

      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--text-sub)]">還沒有任何對話。</p>
      ) : (
        <div className="space-y-2">
          {list.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-2 rounded-[14px] border px-3 py-2.5 ${
                item.active ? 'border-[var(--mint)] bg-[var(--mint)]/25' : 'border-[var(--border)] bg-[var(--bg)]'
              }`}
            >
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => void switchTo(item)}
                className="min-w-0 flex-1 text-left disabled:opacity-50"
              >
                <p className="truncate text-sm text-[var(--text)]">{item.title || '（未命名）'}</p>
                {item.active ? (
                  <StatusChip active>✓ 目前對話</StatusChip>
                ) : (
                  <p className="mt-1 text-[11px] text-[var(--text-sub)]">{formatUpdatedAt(item.updatedAt)}</p>
                )}
              </button>
              <button
                type="button"
                aria-label={`編輯${item.title}`}
                onClick={() => push('conversation-editor', item.id)}
                className="shrink-0 rounded-full px-2 py-1 text-sm active:bg-[var(--border)]"
              >
                ✏️
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function formatUpdatedAt(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
