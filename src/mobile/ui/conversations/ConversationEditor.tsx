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
