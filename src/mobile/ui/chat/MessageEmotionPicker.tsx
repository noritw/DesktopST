import { useEffect, useState } from 'react'
import type { Character } from '@core/types'
import { emotionLabel } from '@core/character/emotionCatalog'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { useCharacterDisplayImage } from '../characters/useAvatarUrl'

/**
 * 手動指定這則訊息要顯示的表情，覆蓋 AI 判斷的 `emotion`
 * （`docs/mobile-character-expression-plan.md` §3.2／§6.2）。
 *
 * 從 `MessageMenu` 的「換表情」進來，已經確認過 `message.role === 'character'`
 * 且該角色有表情圖才會顯示入口，這裡不必再處理「沒有表情圖」的空狀態。
 */
export function MessageEmotionPicker({ messageId }: { messageId: string }): JSX.Element {
  const message = useAppStore((s) => s.messages.find((m) => m.id === messageId))
  const refresh = useAppStore((s) => s.refresh)
  const ui = useUiStore()
  const [character, setCharacter] = useState<Character | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!message?.characterId) return
    let alive = true
    void getData()
      .characters.get(message.characterId)
      .then((c) => { if (alive) setCharacter(c) })
      .catch(() => {})
    return () => { alive = false }
  }, [message?.characterId])

  if (!message || !message.characterId) {
    return <div className="py-8 text-center text-sm text-[var(--text-sub)]">這則訊息已經不在了</div>
  }
  if (!character) {
    return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>
  }

  const keys = Array.from(
    new Set([...Object.keys(character.emotions ?? {}), ...Object.keys(character.spriteIds ?? {})])
  )
  const current = message.emotionOverride ?? null

  const choose = async (emotion: string | null): Promise<void> => {
    setBusy(true)
    try {
      await getData().messages.setEmotionOverride(messageId, emotion)
      await refresh()
      ui.pop()
    } catch {
      ui.toast('設定失敗，請再試一次', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pb-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => void choose(null)}
        className={`mb-3 flex w-full items-center justify-between rounded-[14px] border px-3.5 py-2.5 text-sm disabled:opacity-50 ${
          current === null ? 'border-[var(--mint2)] bg-[var(--mint)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-sub)]'
        }`}
      >
        跟隨 AI 判斷{message.emotion ? `（目前：${emotionLabel(message.emotion)}）` : ''}
        {current === null && <span>✓</span>}
      </button>

      <div className="grid grid-cols-3 gap-2">
        {keys.map((key) => (
          <EmotionThumb
            key={key}
            characterId={character.id}
            emotionKey={key}
            selected={current === key}
            disabled={busy}
            onClick={() => void choose(key)}
          />
        ))}
      </div>
    </div>
  )
}

function EmotionThumb({
  characterId,
  emotionKey,
  selected,
  disabled,
  onClick
}: {
  characterId: string
  emotionKey: string
  selected: boolean
  disabled: boolean
  onClick: () => void
}): JSX.Element {
  const url = useCharacterDisplayImage(characterId, emotionKey)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-[14px] border p-2 disabled:opacity-50 ${
        selected ? 'border-[var(--mint2)] bg-[var(--mint)]' : 'border-[var(--border)]'
      }`}
    >
      <div className="h-14 w-14 overflow-hidden rounded-full bg-[var(--bg)]">
        {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      </div>
      <span className="line-clamp-1 text-center text-[11px] text-[var(--text)]">{emotionLabel(emotionKey)}</span>
    </button>
  )
}
