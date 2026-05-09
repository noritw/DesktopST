import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore, selectCharacter, selectDesktopChar, selectCharacterLastMessage } from '../stores/useAppStore'
import CharacterSprite from '../components/CharacterSprite'
import SpeechBubble from '../components/SpeechBubble'
import HoverMenu from '../components/HoverMenu'

const BUBBLE_DURATION = 8000

interface Props {
  characterId: string
}

export default function CharacterWindow({ characterId }: Props) {
  const character = useAppStore(selectCharacter(characterId))
  const desktopState = useAppStore(selectDesktopChar(characterId))
  const lastMessage = useAppStore(selectCharacterLastMessage(characterId))
  const desktopCharacters = useAppStore(s => s.desktopCharacters)

  const [hovered, setHovered] = useState(false)
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [bubbleText, setBubbleText] = useState('')
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragStartRef = useRef<{ mx: number; my: number; wx: number; wy: number } | null>(null)
  const didDragRef = useRef(false)

  // Show bubble when new message arrives
  useEffect(() => {
    if (!lastMessage) return
    setBubbleText(lastMessage.content)
    setBubbleVisible(true)
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current)
    bubbleTimerRef.current = setTimeout(() => setBubbleVisible(false), BUBBLE_DURATION)
  }, [lastMessage?.id])

  // Drag: move window by dragging the character sprite
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    didDragRef.current = false
    dragStartRef.current = { mx: e.screenX, my: e.screenY, wx: window.screenX, wy: window.screenY }

    const onMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return
      const dx = ev.screenX - dragStartRef.current.mx
      const dy = ev.screenY - dragStartRef.current.my
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true
      const nx = dragStartRef.current.wx + dx
      const ny = dragStartRef.current.wy + dy
      window.api.invoke('desktop:update-position', characterId, { x: nx, y: ny })
    }

    const onUp = () => {
      dragStartRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    // Use window instead of document so events are captured even when mouse leaves the window
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [characterId])

  // Click (not drag) → toggle input window
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (didDragRef.current) return
    e.stopPropagation()
    window.api.invoke('window:toggle-input')
  }, [])

  if (!character) return null

  const size = desktopState?.size ?? 1
  const isMuted = desktopState?.muted ?? false
  const canRemove = desktopCharacters.length > 1

  const avatarSrc = character.avatar
    ? `local://${encodeURIComponent(character.avatar)}`
    : ''

  return (
    // The root div covers the full window but is pointer-events:none (click-through)
    // Only the interactive-zone div has pointer-events:auto
    <div className="w-full h-full flex flex-col select-none" style={{ background: 'transparent' }}>
      {/* Speech bubble area — no pointer events */}
      <div className="flex-1 flex items-end px-2 pb-1 pointer-events-none">
        <SpeechBubble text={bubbleText} visible={bubbleVisible} />
      </div>

      {/* Interactive zone: sprite + hover menu — pointer events enabled */}
      <div
        className="flex-shrink-0 relative self-start"
        style={{ pointerEvents: 'auto' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Draggable sprite */}
        <div
          className="cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onClick={handleClick}
          style={{ userSelect: 'none' }}
        >
          <CharacterSprite src={avatarSrc} name={character.name} size={size} />
        </div>

        <HoverMenu
          characterId={characterId}
          visible={hovered}
          canRemove={canRemove}
          isMuted={isMuted}
        />
      </div>
    </div>
  )
}
