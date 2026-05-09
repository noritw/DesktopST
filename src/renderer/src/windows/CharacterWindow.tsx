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
  const isThinking = useAppStore(s => !!s.thinkingByCharacterId[characterId])

  const urlSize = window.windowParams?.get('size') ?? new URLSearchParams(window.location.search).get('size')
  const initialSize = urlSize ? Number(urlSize) : NaN

  const [hovered, setHovered] = useState(false)
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [bubbleText, setBubbleText] = useState('')
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const interactiveRef = useRef<HTMLDivElement>(null)
  const hoverMenuButtonsRef = useRef<HTMLDivElement | null>(null)
  const clickThroughRef = useRef<boolean | null>(null)
  const isDraggingRef = useRef(false)
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

  // Make the transparent area click-through so overlapped characters can still be clicked.
  useEffect(() => {
    let raf = 0
    const update = (e: MouseEvent) => {
      if (!interactiveRef.current) return
      if (isDraggingRef.current) return
      const r = interactiveRef.current.getBoundingClientRect()
      const mr = hoverMenuButtonsRef.current?.getBoundingClientRect() ?? null
      const inside =
        (e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top && e.clientY <= r.bottom) ||
        (!!mr && e.clientX >= mr.left && e.clientX <= mr.right &&
          e.clientY >= mr.top && e.clientY <= mr.bottom)
      const nextClickThrough = !inside
      if (clickThroughRef.current === nextClickThrough) return
      clickThroughRef.current = nextClickThrough
      window.api.invoke('desktop:set-click-through', characterId, nextClickThrough)
    }
    const onMove = (e: MouseEvent) => {
      if (raf) return
      raf = window.requestAnimationFrame(() => {
        raf = 0
        update(e)
      })
    }
    window.addEventListener('mousemove', onMove)
    // Initial state: keep interactive so first click/drag always works.
    window.api.invoke('desktop:set-click-through', characterId, false)
    clickThroughRef.current = false
    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      window.removeEventListener('mousemove', onMove)
      window.api.invoke('desktop:set-click-through', characterId, false)
    }
  }, [characterId])

  // Drag: move window by dragging the character sprite
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    didDragRef.current = false
    isDraggingRef.current = true
    // Ensure the window is not click-through while dragging
    if (clickThroughRef.current !== false) {
      clickThroughRef.current = false
      window.api.invoke('desktop:set-click-through', characterId, false)
    }
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
      isDraggingRef.current = false
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

  const size = desktopState?.size ?? (Number.isFinite(initialSize) && initialSize > 0 ? initialSize : 1)
  const isMuted = desktopState?.muted ?? false
  const canRemove = desktopCharacters.length > 1

  const avatarSrc = character.avatar
    ? `local://${encodeURIComponent(character.avatar)}`
    : ''

  return (
    // The root div covers the full window but is pointer-events:none (click-through)
    // Only the interactive-zone div has pointer-events:auto
    <div
      className="w-full h-full flex flex-col select-none"
      style={{ background: 'transparent', pointerEvents: 'none' }}
    >
      {/* Speech bubble area — no pointer events */}
      <div className="flex-1 flex items-end px-2 pb-1 pointer-events-none">
        <SpeechBubble text={bubbleText} visible={bubbleVisible} />
      </div>

      {/* Interactive zone: sprite + hover menu — pointer events enabled */}
      <div
        className="flex-shrink-0 relative self-start"
        style={{ pointerEvents: 'auto' }}
        ref={interactiveRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Thinking bubble */}
        {isThinking && (
          <div
            className="absolute -top-8 left-2 pointer-events-none"
            style={{
              padding: '6px 10px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.92)',
              border: '1px solid rgba(216,245,236,1)',
              color: '#3D5A52'
            }}
          >
            <span className="dst-thinking-dots" aria-label="thinking">
              <span>.</span><span>.</span><span>.</span>
            </span>
          </div>
        )}

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
          onButtonsEl={(el) => { hoverMenuButtonsRef.current = el }}
        />
      </div>
    </div>
  )
}
