import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore, selectCharacter, selectDesktopChar } from '../stores/useAppStore'
import CharacterSprite from '../components/CharacterSprite'
import HoverMenu from '../components/HoverMenu'

interface Props {
  characterId: string
}

export default function CharacterWindow({ characterId }: Props) {
  const character = useAppStore(selectCharacter(characterId))
  const desktopState = useAppStore(selectDesktopChar(characterId))
  const desktopCharacters = useAppStore(s => s.desktopCharacters)
  const isThinking = useAppStore(s => !!s.thinkingByCharacterId[characterId])
  const uiAppFocused = useAppStore(s => s.uiAppFocused)

  const urlSize = window.windowParams?.get('size') ?? new URLSearchParams(window.location.search).get('size')
  const initialSize = urlSize ? Number(urlSize) : NaN

  const [hovered, setHovered] = useState(false)
  const [menuPinned, setMenuPinned] = useState(false)
  const [hoverSuppressed, setHoverSuppressed] = useState(false)
  const interactiveRef = useRef<HTMLDivElement>(null)
  const hoverMenuButtonsRef = useRef<HTMLDivElement | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const didDragRef = useRef(false)

  useEffect(() => {
    if (!uiAppFocused) setHovered(false)
  }, [uiAppFocused])

  // Report interactive hit rects to main so it can decide click-through reliably on Windows.
  useEffect(() => {
    const toScreenRect = (r: DOMRect) => ({
      x: Math.round(window.screenX + r.left),
      y: Math.round(window.screenY + r.top),
      w: Math.round(r.width),
      h: Math.round(r.height)
    })

    const tick = () => {
      const spriteEl = interactiveRef.current
      if (!spriteEl) return
      const sprite = toScreenRect(spriteEl.getBoundingClientRect())
      const btnEl = hoverMenuButtonsRef.current
      const buttons = btnEl ? toScreenRect(btnEl.getBoundingClientRect()) : null
      window.api.invoke('desktop:update-hit-rects', characterId, { sprite, buttons })
    }

    tick()
    const id = window.setInterval(tick, 50)
    return () => {
      window.clearInterval(id)
      window.api.invoke('desktop:update-hit-rects', characterId, null)
    }
  }, [characterId])

  // Drag: move window by dragging the character sprite
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    window.api.invoke('ui:character-activated', characterId)
    window.api.invoke('desktop:drag-start', characterId)
    didDragRef.current = false
    dragStartRef.current = { x: e.screenX, y: e.screenY }

    const onMove = (ev: MouseEvent) => {
      if (!dragStartRef.current) return
      const dx = ev.screenX - dragStartRef.current.x
      const dy = ev.screenY - dragStartRef.current.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true
    }

    const onUp = () => {
      dragStartRef.current = null
      window.api.invoke('desktop:drag-end', characterId)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [characterId])

  // Click (not drag) → toggle input window
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (didDragRef.current) return
    e.stopPropagation()
    window.api.invoke('ui:character-activated', characterId)
    window.api.invoke('window:toggle-input')
  }, [characterId])

  const menuVisible = menuPinned || (hovered && !hoverSuppressed)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    window.api.invoke('ui:character-activated', characterId)
    if (menuVisible) {
      setMenuPinned(false)
      setHoverSuppressed(true)
    } else {
      setMenuPinned(true)
      setHoverSuppressed(false)
    }
  }, [characterId, menuVisible])

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
      className="w-full h-full relative select-none"
      style={{ background: 'transparent', pointerEvents: 'none' }}
    >
      {/* Interactive zone: flex row — sprite left, buttons right.
          Both are inside the same container so mouseleave only fires
          when the cursor leaves the entire combined area. */}
      <div
        className="absolute bottom-0 left-0 flex items-start"
        style={{ pointerEvents: 'auto' }}
        ref={interactiveRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false)
          setHoverSuppressed(false)
        }}
      >
        {/* Sprite column */}
        <div className="relative flex-shrink-0">
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
            onContextMenu={handleContextMenu}
            style={{ userSelect: 'none' }}
          >
            <CharacterSprite src={avatarSrc} name={character.name} size={size} />
          </div>
        </div>

        <HoverMenu
          characterId={characterId}
          visible={menuVisible}
          canRemove={canRemove}
          isMuted={isMuted}
          onButtonsEl={(el) => { hoverMenuButtonsRef.current = el }}
        />
      </div>
    </div>
  )
}
