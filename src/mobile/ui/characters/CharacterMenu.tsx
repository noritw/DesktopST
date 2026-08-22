import { DataError } from '@core/data'
import MonoIcon, { type MonoIconName } from '@shared/MonoIcon'
import { getData, useAppStore } from '../stores/appStore'
import { useComposerStore } from '../stores/composerStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'

/**
 * 單一角色的選單（清單 D2 說點什麼、D3 禁言）。
 *
 * 「說點什麼」是叫角色主動發話（遙控模式叫電腦上的角色，獨立模式本機生成）——
 * 送出後**要立刻關掉選單**，因為回應是以訊息形式推回聊天串的，停在選單上會什麼都看不到。
 * 走 `appStore.speak()` 而不是直接呼叫 `DataSource`，是為了共用 `sending` 鎖，
 * 讓輸入框的送出鈕在生成中途變成「停止」——不然點了就卡著等，看起來像沒反應。
 *
 * ⚠️ **「移出對話」原本只放在 `PresenceSheet`**（點「誰在場」再點一次「在場 ✓」）。
 * owner 2026-08-05 實機回報「從角色庫加了角色進來，卻找不到收回去的地方」——
 * 從頭像點進來的這個選單才是使用者對著「這個角色」動作時最直覺會找的地方，
 * 這裡沒有的話等於這條路徑走不通。兩處都能移出，邏輯共用同一支 `setPresent`。
 */
export function CharacterMenu({ characterId }: { characterId: string }): JSX.Element {
  const character = useAppStore((s) => s.snapshot?.presentCharacters.find((c) => c.id === characterId))

  // 角色被移出（在別台裝置上）時選單會空掉。給一句話比留一片空白好。
  if (!character) {
    return <div className="py-8 text-center text-sm text-[var(--text-sub)]">這個角色已經不在對話裡了</div>
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
      <CharacterMenuActions characterId={characterId} />
    </div>
  )
}

/**
 * 選單動作列表（提及／說點什麼／禁言／編輯角色／移出對話）。
 *
 * 從 `CharacterMenu` 抽出來，是因為 `MessageAvatarPanel.tsx`（訊息頭像的大圖預覽）
 * 要重用同一組動作，但自己的頭像/名字那段版面不一樣（要放這則訊息用的表情大圖，
 * 不是角色目前的一般頭像）——動作邏輯只寫一份，不要複製。
 */
export function CharacterMenuActions({ characterId }: { characterId: string }): JSX.Element | null {
  const character = useAppStore((s) => s.snapshot?.presentCharacters.find((c) => c.id === characterId))
  const presentCount = useAppStore((s) => s.snapshot?.presentCharacters.length ?? 0)
  const refresh = useAppStore((s) => s.refresh)
  const speakAction = useAppStore((s) => s.speak)
  const pop = useUiStore((s) => s.pop)
  const push = useUiStore((s) => s.push)
  const toast = useUiStore((s) => s.toast)

  if (!character) return null

  const speak = async (): Promise<void> => {
    pop()
    try {
      await speakAction(characterId)
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

  /**
   * 把角色名字插進輸入框（owner 2026-08-08：群組聊天時不想每次都手打名字）。
   *
   * 插的是**純名字沒有 `@`**：`isAddressed()` 直接比對別名，加了 `@` 也只是多一個字元，
   * 而名字會原樣出現在送出的訊息裡 —— 多一個符號在對話記錄裡看起來很怪。
   * 前後各補一個空白，但只在真的黏著別的字時補，避免一路點出「小明  小華 」。
   */
  const mention = (): void => {
    const composer = useComposerStore.getState()
    const at = composer.caret ?? composer.text.length
    const before = composer.text.slice(0, at)
    const after = composer.text.slice(at)
    const lead = before && !/\s$/.test(before) ? ' ' : ''
    const tail = after.startsWith(' ') ? '' : ' '
    composer.insert(`${lead}${character.name}${tail}`)
    pop()
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
    <>
      <MenuItem icon="at" label="提及" hint="把名字插進輸入框，這則就會點名到他" onClick={mention} />
      <MenuItem icon="chat" label="說點什麼" hint="讓這個角色主動開口" onClick={() => void speak()} />
      <MenuItem
        icon={character.muted ? 'volume' : 'mute'}
        label={character.muted ? '解除禁言' : '禁言'}
        hint={character.muted ? '恢復後會照常參與對話' : '禁言後不會回話，但仍留在對話裡'}
        onClick={() => void toggleMute()}
      />
      {/* 從聊天畫面點頭像進來就能直接改人格，是手機上最短的那條路徑；
          角色庫那個入口是給「還沒在對話裡的角色」用的。 */}
      <MenuItem
        icon="edit"
        label="編輯角色"
        hint="名稱、人格、招呼語、主圖"
        onClick={() => push('character-editor', characterId)}
      />
      {canRemove && (
        <MenuItem
          icon="exit"
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
    </>
  )
}

function MenuItem({
  icon,
  label,
  hint,
  onClick,
  destructive = false
}: {
  icon: MonoIconName
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
      <span className={`shrink-0 ${destructive ? 'text-[var(--danger-text)]' : 'text-[var(--text-sub)]'}`}>
        <MonoIcon name={icon} className="h-[18px] w-[18px]" />
      </span>
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
