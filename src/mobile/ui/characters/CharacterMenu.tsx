import { DataError } from '@core/data'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'

/**
 * 單一角色的選單（清單 D2 說點什麼、D3 禁言）。
 *
 * 「說點什麼」在遙控模式下是叫電腦上的角色主動發話 —— 送出後**要立刻關掉選單**，
 * 因為回應是以訊息形式推回聊天串的，停在選單上會什麼都看不到。
 *
 * ⚠️ **「移出對話」原本只放在 `PresenceSheet`**（點「誰在場」再點一次「在場 ✓」）。
 * owner 2026-08-05 實機回報「從角色庫加了角色進來，卻找不到收回去的地方」——
 * 從頭像點進來的這個選單才是使用者對著「這個角色」動作時最直覺會找的地方，
 * 這裡沒有的話等於這條路徑走不通。兩處都能移出，邏輯共用同一支 `setPresent`。
 */
export function CharacterMenu({ characterId }: { characterId: string }): JSX.Element {
  const character = useAppStore((s) => s.snapshot?.presentCharacters.find((c) => c.id === characterId))
  const presentCount = useAppStore((s) => s.snapshot?.presentCharacters.length ?? 0)
  const refresh = useAppStore((s) => s.refresh)
  const pop = useUiStore((s) => s.pop)
  const push = useUiStore((s) => s.push)
  const toast = useUiStore((s) => s.toast)

  // 角色被移出（在別台裝置上）時選單會空掉。給一句話比留一片空白好。
  if (!character) {
    return <div className="py-8 text-center text-sm text-[var(--text-sub)]">這個角色已經不在對話裡了</div>
  }

  const speak = async (): Promise<void> => {
    pop()
    try {
      await getData().characters.speak(characterId)
    } catch {
      toast(`${character.name} 現在沒辦法發話`, 'error')
    }
  }

  const toggleMute = async (): Promise<void> => {
    try {
      const muted = await getData().characters.toggleMute(characterId)
      // 電腦端會推 desktop-updated → state-invalidated 重抓，
      // 但那要一個來回；先用回傳值報一句，按下去才有反應。
      toast(muted ? `已將 ${character.name} 禁言` : `${character.name} 可以說話了`)
      pop()
    } catch {
      toast('操作失敗', 'error')
    }
  }

  // D5「至少保留一個」：只剩一位時不給這顆按鈕，同 `PresenceSheet` 的判斷。
  const canRemove = presentCount > 1

  const remove = async (): Promise<void> => {
    pop()
    try {
      await getData().characters.setPresent(characterId, false)
      await refresh()
      toast(`已將 ${character.name} 移出對話`)
    } catch (e) {
      toast(
        e instanceof DataError && e.code === 'conflict' ? '至少要留一個角色在對話裡' : '操作失敗',
        'error'
      )
    }
  }

  return (
    <div className="pb-2">
      <div className="mb-3 flex items-center gap-3">
        <Avatar characterId={characterId} muted={character.muted} size={52} />
        <div className="min-w-0">
          <div className="truncate text-[16px] font-medium text-[var(--text)]">{character.name}</div>
          {character.muted && <div className="text-xs text-[var(--text-sub)]">目前禁言中</div>}
        </div>
      </div>

      <MenuItem icon="💬" label="說點什麼" hint="讓這個角色主動開口" onClick={() => void speak()} />
      <MenuItem
        icon={character.muted ? '🔊' : '🔇'}
        label={character.muted ? '解除禁言' : '禁言'}
        hint={character.muted ? '恢復後會照常參與對話' : '禁言後不會回話，但仍留在對話裡'}
        onClick={() => void toggleMute()}
      />
      {/* 從聊天畫面點頭像進來就能直接改人格，是手機上最短的那條路徑；
          角色庫那個入口是給「還沒在對話裡的角色」用的。 */}
      <MenuItem
        icon="✏️"
        label="編輯角色"
        hint="名稱、人格、招呼語、主圖"
        onClick={() => push('character-editor', characterId)}
      />
      {canRemove && (
        <MenuItem
          icon="🚪"
          label="移出對話"
          hint="角色卡不會被刪，之後可以再從角色庫加回來"
          destructive
          onClick={() => void remove()}
        />
      )}
      {!canRemove && (
        <p className="mt-1 px-1 text-xs leading-relaxed text-[var(--text-sub)]">
          至少要留一個角色在對話裡，所以最後一位不能移出。
        </p>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
  destructive = false
}: {
  icon: string
  label: string
  hint?: string
  onClick: () => void
  destructive?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex w-full items-center gap-3 rounded-[14px] bg-[var(--bg)] px-4 py-3 text-left active:opacity-70"
    >
      <span className="text-lg">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] ${destructive ? 'text-[var(--danger-text)]' : 'text-[var(--text)]'}`}>
          {label}
        </span>
        {hint && <span className="block text-xs text-[var(--text-sub)]">{hint}</span>}
      </span>
    </button>
  )
}

export { MenuItem }
