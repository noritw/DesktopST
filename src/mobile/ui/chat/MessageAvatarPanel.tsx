import { useAppStore } from '../stores/appStore'
import { emotionLabel } from '@core/character/emotionCatalog'
import { useCharacterDisplayImage } from '../characters/useAvatarUrl'
import { CharacterMenuActions } from '../characters/CharacterMenu'

/**
 * 點聊天泡泡頭像開啟的角色面板（`docs/mobile-character-expression-plan.md` 追加需求，
 * owner 2026-08-23）：對話記錄的頭像很小，看不清楚選了哪張表情圖，所以放大顯示
 * **這則訊息實際用的那張表情圖**（`emotionOverride ?? emotion`），角色一般操作
 * （提及／說點什麼／禁言…）維持不變，重用 `CharacterMenuActions`。
 */
export function MessageAvatarPanel({ messageId }: { messageId: string }): JSX.Element {
  const message = useAppStore((s) => s.messages.find((m) => m.id === messageId))

  if (!message || !message.characterId) {
    return <div className="py-8 text-center text-sm text-[var(--text-sub)]">這則訊息已經不在了</div>
  }

  const emotion = message.emotionOverride ?? message.emotion

  return (
    <div className="pb-2">
      <MessageAvatarPreview characterId={message.characterId} emotion={emotion} />
      <CharacterMenuActions characterId={message.characterId} />
    </div>
  )
}

function MessageAvatarPreview({ characterId, emotion }: { characterId: string; emotion?: string }): JSX.Element {
  const characterName = useAppStore(
    (s) => s.snapshot?.presentCharacters.find((c) => c.id === characterId)?.name ?? ''
  )
  const url = useCharacterDisplayImage(characterId, emotion)

  return (
    <div className="mb-3 flex flex-col items-center gap-2">
      <div className="h-32 w-32 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--bg)]">
        {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="text-[15px] font-medium text-[var(--text)]">{characterName}</div>
      {emotion && <div className="text-xs text-[var(--text-sub)]">這則的表情：{emotionLabel(emotion)}</div>}
    </div>
  )
}
