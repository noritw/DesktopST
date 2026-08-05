import { useCallback, useEffect, useState } from 'react'
import type { ConversationListItem } from '@core/data'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from '../settings/settingsErrors'

/**
 * 對話清單（B3 階段 8，E1–E2）。
 *
 * 桌面切換對話時，手機端現在會靠 `state-invalidated` 重抓 `/api/state` 跟著換
 * （見 `src/main/index.ts` 的 `setMobileConversationHook`）；這裡管的是**手機主動
 * 切換／新增／改名／刪除**，跟桌面端 `SettingsWindow` 沒有專屬對話管理視窗不同——
 * 手機把它當成一個獨立畫面，用清單 + 進場即切換的形式做。
 */
export function ConversationsView(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const prompt = useUiStore((s) => s.prompt)
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

  const rename = async (item: ConversationListItem): Promise<void> => {
    const next = await prompt({
      title: '重新命名',
      message: '這個對話要叫什麼名字？',
      defaultValue: item.title,
      confirmLabel: '儲存'
    })
    if (next === null) return
    setBusyId(item.id)
    try {
      await getData().conversations.rename(item.id, next)
      await load()
    } catch (e) {
      toast(describeSettingsError(e, '重新命名'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (item: ConversationListItem): Promise<void> => {
    // 電腦端沒有「至少保留一個」的限制——刪光最後一個對話會自動生一個新的空對話，
    // 跟角色／預設組那種「刪到剩 0 個」會壞掉的情況不一樣，這裡不用擋。
    const ok = await confirm({
      title: `刪除「${item.title}」`,
      message: '這個對話裡的訊息會一起刪掉，而且不能復原。',
      confirmLabel: '刪除',
      destructive: true
    })
    if (!ok) return
    setBusyId(item.id)
    try {
      await getData().conversations.remove(item.id)
      // 刪的如果是目前使用中的那個，電腦端會自動換到另一個，訊息串要跟著換。
      if (item.active) await refresh()
      await load()
      toast('已刪除')
    } catch (e) {
      toast(describeSettingsError(e, '刪除'), 'error')
    } finally {
      setBusyId(null)
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
                <p className={`mt-0.5 text-[11px] ${item.active ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-sub)]'}`}>
                  {item.active ? '✓ 目前對話' : formatUpdatedAt(item.updatedAt)}
                </p>
              </button>
              <button
                type="button"
                aria-label={`重新命名${item.title}`}
                disabled={busyId === item.id}
                onClick={() => void rename(item)}
                className="shrink-0 rounded-full px-2 py-1 text-sm active:bg-[var(--border)] disabled:opacity-50"
              >
                ✏️
              </button>
              <button
                type="button"
                aria-label={`刪除${item.title}`}
                disabled={busyId === item.id}
                onClick={() => void remove(item)}
                className="shrink-0 rounded-full px-2 py-1 text-sm text-[var(--danger)] active:bg-[var(--border)] disabled:opacity-50"
              >
                🗑️
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
