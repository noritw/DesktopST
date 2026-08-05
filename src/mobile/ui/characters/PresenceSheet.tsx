import { useCallback, useEffect, useState } from 'react'
import type { CharacterListItem } from '@core/data'
import { DataError } from '@core/data'
import MonoIcon from '@shared/MonoIcon'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'
import { StatusChip } from '../shell/StatusChip'

/**
 * 「這次對話有誰在場」（清單 D4、D5）。
 *
 * ⚠️ **用語是決議①**：手機沒有桌面，講「桌面角色」使用者看不懂。
 * 資料上它就是桌面版的桌面角色清單（同一組角色 id），
 * 座標由電腦端自行補（`spreadDesktopCharacters`），手機完全不必知道有座標這回事。
 *
 * D5「至少保留一個」**兩邊都要擋**：
 * 只剩一位時這裡不顯示「移出」，而電腦端仍會拒絕（回 `ok: false`）——
 * UI 那層是為了不讓使用者按到必定失敗的按鈕，
 * 電腦端那層才是真的規則（別台裝置同時操作時只有它擋得住）。
 *
 * 跟角色庫、對話清單、情境／世界觀／使用者設定同一套位置慣例（2026-08-05）：
 * 左邊大按鈕做「加入／移出」，右邊固定一顆 ✏️ 進角色卡編輯，刪除留在編輯器裡。
 */
export function PresenceSheet(): JSX.Element {
  const present = useAppStore((s) => s.snapshot?.presentCharacters ?? [])
  const refresh = useAppStore((s) => s.refresh)
  const toast = useUiStore((s) => s.toast)

  const [library, setLibrary] = useState<CharacterListItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setFailed(false)
    try {
      setLibrary(await getData().characters.list())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const presentIds = new Set(present.map((c) => c.id))
  const onlyOneLeft = presentIds.size <= 1

  const toggle = async (item: CharacterListItem): Promise<void> => {
    const willBePresent = !presentIds.has(item.id)
    setBusyId(item.id)
    try {
      await getData().characters.setPresent(item.id, willBePresent)
      // 清單的 `present` 欄位是伺服器算的，自己改一份會跟真相分岔。
      await Promise.all([refresh(), load()])
    } catch (e) {
      toast(
        e instanceof DataError && e.code === 'conflict'
          ? '至少要留一個角色在對話裡'
          : '操作失敗',
        'error'
      )
    } finally {
      setBusyId(null)
    }
  }

  if (failed) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--text-sub)]">載入角色清單失敗</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]"
        >
          重試
        </button>
      </div>
    )
  }

  if (!library) {
    return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>
  }

  if (library.length === 0) {
    return <div className="py-8 text-center text-sm text-[var(--text-sub)]">還沒有任何角色</div>
  }

  return (
    <div className="pb-2">
      {library.map((item) => {
        const isPresent = presentIds.has(item.id)
        // 只剩一位時不給移出按鈕（D5）。留著會是一顆必定失敗的按鈕。
        const canRemove = !(isPresent && onlyOneLeft)
        return (
          <div
            key={item.id}
            className={`mb-2 flex items-center gap-2 rounded-[14px] border px-3 py-2.5 ${
              isPresent ? 'border-[var(--mint)] bg-[var(--mint)]/25' : 'border-[var(--border)] bg-[var(--bg)]'
            }`}
          >
            <button
              type="button"
              disabled={busyId === item.id || !canRemove}
              onClick={() => void toggle(item)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50"
            >
              <Avatar characterId={item.id} size={38} />
              <span className="min-w-0 flex-1">
                <p className="truncate text-[15px] text-[var(--text)]">{item.name}</p>
                <StatusChip active={isPresent}>{isPresent ? '在場' : '加入對話'}</StatusChip>
              </span>
            </button>
            <button
              type="button"
              aria-label={`編輯${item.name}`}
              onClick={() => useUiStore.getState().push('character-editor', item.id)}
              className="shrink-0 rounded-full p-2 text-[var(--text-sub)] active:bg-[var(--border)]"
            >
              <MonoIcon name="edit" className="h-4 w-4" />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => useUiStore.getState().push('characters')}
        className="mt-1 w-full rounded-full border border-[var(--border)] py-2.5 text-sm text-[var(--text-sub)]"
      >
        管理角色庫（新增／編輯／匯入）
      </button>

      {onlyOneLeft && (
        <p className="mt-1 px-1 text-xs leading-relaxed text-[var(--text-sub)]">
          至少要留一個角色在對話裡，所以最後一位不能移出。
        </p>
      )}
    </div>
  )
}
