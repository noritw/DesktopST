import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { MenuItem } from '../characters/CharacterMenu'

/**
 * 訊息的操作選單（清單 A6：重新發送／編輯／刪除）。
 *
 * ⚠️ 三支端點做完**都要自己 `refresh()`** ——
 * `mobileServer` 的 `/api/messages/*` 不推 WebSocket 事件
 * （對照 `/api/characters/*` 有 `pushDesktopUpdate`）。
 * 不重抓的話畫面會停在舊內容，看起來像沒生效。
 */
export function MessageMenu({ messageId }: { messageId: string }): JSX.Element {
  const message = useAppStore((s) => s.messages.find((m) => m.id === messageId))
  const refresh = useAppStore((s) => s.refresh)
  const ui = useUiStore()

  if (!message) {
    return <div className="py-8 text-center text-sm text-[var(--text-sub)]">這則訊息已經不在了</div>
  }

  const run = async (fn: () => Promise<void>, failText: string): Promise<void> => {
    ui.pop()
    try {
      await fn()
      await refresh()
    } catch {
      ui.toast(failText, 'error')
    }
  }

  const edit = async (): Promise<void> => {
    const next = await ui.prompt({
      title: '編輯訊息',
      defaultValue: message.content,
      multiline: true,
      confirmLabel: '儲存'
    })
    if (next == null || next === message.content) return
    await run(() => getData().messages.edit(messageId, next), '編輯失敗')
  }

  const remove = async (): Promise<void> => {
    const ok = await ui.confirm({
      title: '刪除這則訊息？',
      message: '刪掉之後就找不回來了。',
      confirmLabel: '刪除',
      destructive: true
    })
    if (!ok) return
    await run(() => getData().messages.remove(messageId), '刪除失敗')
  }

  const resend = async (): Promise<void> => {
    const ok = await ui.confirm({
      title: '重新發送？',
      // 這句一定要講清楚：resend 會砍掉後面的內容，按下去才發現就來不及了。
      message: '這則之後的訊息會被刪掉，然後重新產生一次回覆。',
      confirmLabel: '重新發送',
      destructive: true
    })
    if (!ok) return
    await run(() => getData().messages.resend(messageId), '重新發送失敗')
  }

  return (
    <div className="pb-2">
      <p className="mb-3 line-clamp-3 rounded-[12px] bg-[var(--bg)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--text-sub)]">
        {message.content || '（沒有文字內容）'}
      </p>

      {/* ⚠️ **只有使用者訊息能重送。**
          電腦端明文擋著（`ipcHandlers.ts:639`「只能重新發送使用者訊息」），
          對角色訊息顯示這一項等於給一顆必定失敗的按鈕 ——
          與 D5 那顆移出鈕同一種錯。 */}
      {message.role === 'user' && (
        <MenuItem icon="🔄" label="重新發送" hint="刪掉這則之後的內容並重新產生回覆" onClick={() => void resend()} />
      )}
      <MenuItem icon="✏️" label="編輯" hint="改內容，不會重新產生回覆" onClick={() => void edit()} />
      <MenuItem icon="🗑" label="刪除" destructive onClick={() => void remove()} />
    </div>
  )
}
