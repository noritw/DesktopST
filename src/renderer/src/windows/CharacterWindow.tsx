import { useEffect, useRef, useState, useCallback } from 'react'
import { useAppStore, selectCharacter, selectDesktopChar, selectCharacterLastMessage } from '../stores/useAppStore'
import CharacterSprite, { type CharacterSpriteHandle } from '../components/CharacterSprite'
import HoverMenu from '../components/HoverMenu'

interface Props {
  characterId: string
}

export default function CharacterWindow({ characterId }: Props) {
  const character = useAppStore(selectCharacter(characterId))
  const desktopState = useAppStore(selectDesktopChar(characterId))
  const desktopCharacters = useAppStore(s => s.desktopCharacters)
  const removeFromDesktop = useAppStore(s => s.removeFromDesktop)
  const isThinking = useAppStore(s => !!s.thinkingByCharacterId[characterId])
  const uiAppFocused = useAppStore(s => s.uiAppFocused)

  const urlSize = window.windowParams?.get('size') ?? new URLSearchParams(window.location.search).get('size')
  const initialSize = urlSize ? Number(urlSize) : NaN
  const size = desktopState?.size ?? (Number.isFinite(initialSize) && initialSize > 0 ? initialSize : 1)
  const isMuted = desktopState?.muted ?? false
  const canRemove = desktopCharacters.length > 1
  const maxVisibleScale = Math.max(
    0.25,
    Math.min(
      4,
      Math.floor(((window.screen.availWidth - 12) / 220) * 20) / 20,
      Math.floor(((window.screen.availHeight - 12) / 380) * 20) / 20
    )
  )

  const [hovered, setHovered] = useState(false)
  const [menuPinned, setMenuPinned] = useState(false)
  const [hoverSuppressed, setHoverSuppressed] = useState(false)
  const [scaleMode, setScaleMode] = useState(false)
  const [scaleDraft, setScaleDraft] = useState(size)
  const [scaleText, setScaleText] = useState(String(size))

  const interactiveRef = useRef<HTMLDivElement>(null)
  const menuPinnedRef = useRef(menuPinned)
  useEffect(() => { menuPinnedRef.current = menuPinned }, [menuPinned])
  const spriteRef = useRef<CharacterSpriteHandle>(null)
  const spriteDivRef = useRef<HTMLDivElement>(null)
  const hoverMenuButtonsRef = useRef<HTMLDivElement | null>(null)
  const scaleControlsRef = useRef<HTMLDivElement | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const didDragRef = useRef(false)
  // 追蹤游標是否在 sprite 的不透明區域上
  const [spriteOpaque, setSpriteOpaque] = useState(false)

  useEffect(() => {
    if (!uiAppFocused) setHovered(false)
  }, [uiAppFocused])

  // spriteOpaque=true 時觸發 hover；關閉 hover 由 mousemove 的容器邊界判斷
  useEffect(() => {
    if (spriteOpaque) {
      setHovered(true)
    }
  }, [spriteOpaque])
  useEffect(() => {
    if (!scaleMode) {
      setScaleDraft(size)
      setScaleText(String(size))
    }
  }, [scaleMode, size])

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
      const controlsEl = scaleMode ? scaleControlsRef.current : hoverMenuButtonsRef.current
      const buttons = controlsEl ? toScreenRect(controlsEl.getBoundingClientRect()) : null
      window.api.invoke('desktop:update-hit-rects', characterId, { sprite, buttons })
    }

    tick()
    const id = window.setInterval(tick, 50)
    return () => {
      window.clearInterval(id)
      window.api.invoke('desktop:update-hit-rects', characterId, null)
    }
  }, [characterId, scaleMode])

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0 || scaleMode) return
    event.preventDefault()
    window.api.invoke('ui:character-activated', characterId)
    window.api.invoke('desktop:drag-start', characterId)
    didDragRef.current = false
    dragStartRef.current = { x: event.screenX, y: event.screenY }

    const onMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return
      const dx = moveEvent.screenX - dragStartRef.current.x
      const dy = moveEvent.screenY - dragStartRef.current.y
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
  }, [characterId, scaleMode])

  const handleClick = useCallback((event: React.MouseEvent) => {
    if (scaleMode || didDragRef.current) return
    event.stopPropagation()
    window.api.invoke('ui:character-activated', characterId)
    window.api.invoke('window:toggle-input')
  }, [characterId, scaleMode])

  const menuVisible = menuPinned || (hovered && !hoverSuppressed)

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (scaleMode) return
    window.api.invoke('ui:character-activated', characterId)
    if (menuVisible) {
      setMenuPinned(false)
      setHoverSuppressed(true)
    } else {
      setMenuPinned(true)
      setHoverSuppressed(false)
    }
  }, [characterId, menuVisible, scaleMode])

  const handleCloseMenu = useCallback(() => {
    setMenuPinned(false)
    setHoverSuppressed(true)
  }, [])

  // 用 window-level mousemove 持續追蹤游標位置
  // - 游標在整個互動容器內（sprite + 按鈕列）→ hovered=true
  // - 游標在 sprite 框內且不透明 → spriteOpaque=true（用於初始觸發）
  // - 游標完全離開容器 → 重置
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const containerEl = interactiveRef.current
      const spriteEl = spriteDivRef.current
      if (!containerEl || !spriteEl) return

      const containerRect = containerEl.getBoundingClientRect()
      const inContainer = (
        event.clientX >= containerRect.left &&
        event.clientX <= containerRect.right &&
        event.clientY >= containerRect.top &&
        event.clientY <= containerRect.bottom
      )

      if (!inContainer) {
        // 游標完全離開整個容器
        setSpriteOpaque(false)
        if (!menuPinnedRef.current) {
          setHovered(false)
          setHoverSuppressed(false)
        }
        return
      }

      // 游標在容器內：檢查是否在 sprite 框的不透明區域
      const spriteRect = spriteEl.getBoundingClientRect()
      const localX = event.clientX - spriteRect.left
      const localY = event.clientY - spriteRect.top
      const inSpriteBox = localX >= 0 && localY >= 0 && localX <= spriteRect.width && localY <= spriteRect.height

      if (inSpriteBox) {
        const alpha = spriteRef.current?.getAlphaAt(localX, localY) ?? 255
        setSpriteOpaque(alpha >= 10)
      } else {
        // 游標在容器內但不在 sprite 框（例如在按鈕列）
        setSpriteOpaque(false)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  const applyScale = useCallback((next: number) => {
    const clamped = Math.min(maxVisibleScale, Math.max(0.25, next))
    setScaleDraft(clamped)
    setScaleText(clamped.toFixed(2).replace(/\.?0+$/, ''))
  }, [maxVisibleScale])

  const applyScaleText = useCallback(() => {
    const next = Number(scaleText)
    if (!Number.isFinite(next)) {
      setScaleText(scaleDraft.toFixed(2).replace(/\.?0+$/, ''))
      return
    }
    applyScale(next)
  }, [applyScale, scaleDraft, scaleText])

  const enterScaleMode = useCallback(() => {
    const clamped = Math.min(maxVisibleScale, Math.max(0.25, size))
    setScaleDraft(clamped)
    setScaleText(clamped.toFixed(2).replace(/\.?0+$/, ''))
    window.api.invoke('desktop:preview-size', characterId, maxVisibleScale)
    setScaleMode(true)
    setMenuPinned(true)
    setHoverSuppressed(false)
  }, [characterId, maxVisibleScale, size])

  const exitScaleMode = useCallback(() => {
    const next = Number(scaleText)
    const finalScale = Number.isFinite(next)
      ? Math.min(maxVisibleScale, Math.max(0.25, next))
      : scaleDraft
    setScaleDraft(finalScale)
    setScaleText(finalScale.toFixed(2).replace(/\.?0+$/, ''))
    window.api.invoke('desktop:update-size', characterId, finalScale)
    setScaleMode(false)
    setMenuPinned(true)
  }, [characterId, maxVisibleScale, scaleDraft, scaleText])

  const lastMsg = useAppStore(selectCharacterLastMessage(characterId))
  const emotionTag = lastMsg?.emotion

  if (!character) return null

  const renderedSize = scaleMode ? scaleDraft : Math.min(maxVisibleScale, Math.max(0.25, size))

  return (
    <div
      className="w-full h-full relative select-none"
      style={{ background: 'transparent', pointerEvents: 'none' }}
    >
      {/* Character sprite — lifts up in scale mode to leave room for the fixed control panel */}
      <div
        className={`absolute left-0 flex items-end ${scaleMode ? 'bottom-24' : 'bottom-0'}`}
        style={{ pointerEvents: 'auto' }}
        ref={interactiveRef}
      >
        {/* 左側垃圾桶：從桌面移除此角色 */}
        {!scaleMode && (
          <div
            className="flex items-end pb-1 pr-1 no-drag self-end"
            style={{
              opacity: canRemove && menuVisible ? 1 : 0,
              pointerEvents: canRemove && menuVisible ? 'auto' : 'none',
              transition: 'opacity 0.2s ease'
            }}
          >
            <button
              type="button"
              title="從桌面移除此角色"
              aria-label="從桌面移除此角色"
              onClick={() => removeFromDesktop(characterId)}
              className="btn-round btn-danger"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v4" />
                <path d="M14 11v4" />
              </svg>
            </button>
          </div>
        )}

        <div className="relative flex-shrink-0">
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

          <div
            ref={spriteDivRef}
            className={scaleMode ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}
            onMouseDown={(event) => {
              if (!spriteOpaque && !hovered && !scaleMode) return
              handleMouseDown(event)
            }}
            onClick={(event) => {
              if (!spriteOpaque && !hovered && !scaleMode) return
              handleClick(event)
            }}
            onContextMenu={(event) => {
              if (!spriteOpaque && !hovered && !scaleMode) return
              handleContextMenu(event)
            }}
            style={{
              userSelect: 'none',
              // hovered=true 時整個 sprite 框都感應（方便操作按鈕列時游標掃過透明區域）
              // hovered=false 時只有不透明像素感應
              pointerEvents: (spriteOpaque || hovered || scaleMode) ? 'auto' : 'none'
            }}
          >
            <CharacterSprite
              ref={spriteRef}
              avatarPath={character.avatar}
              emotion={emotionTag}
              emotions={character.emotions}
              name={character.name}
              size={renderedSize}
            />
          </div>
        </div>

        {!scaleMode && (
          <HoverMenu
            characterId={characterId}
            visible={menuVisible}
            canRemove={canRemove}
            isMuted={isMuted}
            onScale={enterScaleMode}
            onClose={handleCloseMenu}
            onButtonsEl={(el) => { hoverMenuButtonsRef.current = el }}
          />
        )}
      </div>

      {/* Scale control panel — fixed size, anchored to window bottom-left, independent of sprite scale */}
      {scaleMode && (
        <div
          ref={scaleControlsRef}
          className="absolute left-2 bottom-2 w-[260px] z-10"
          style={{ pointerEvents: 'auto' }}
          onMouseDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        >
          <div className="rounded-2xl border border-border bg-white/90 px-3 py-2 shadow-soft">
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                className="w-8 h-8 rounded-full border border-border bg-white/90 text-primary flex items-center justify-center hover:bg-mint"
                title="Reset"
                onClick={() => applyScale(1)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4">
                  <path d="M4 7v6h6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M5 13a7 7 0 1 0 2-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-semibold text-primary">
                <span className="shrink-0">{'縮放比例：'}</span>
                <input
                  type="number"
                  min={0.25}
                  max={maxVisibleScale}
                  step={0.05}
                  value={scaleText}
                  onChange={event => setScaleText(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') applyScaleText()
                  }}
                  onBlur={applyScaleText}
                  className="min-w-0 w-full rounded-full border border-border bg-white px-2 py-1 text-center text-primary outline-none focus:border-teal"
                  title="Scale"
                />
              </div>
              <button
                type="button"
                className="w-8 h-8 rounded-full border border-border bg-mint text-primary flex items-center justify-center hover:bg-teal"
                title="OK"
                onClick={exitScaleMode}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4">
                  <path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <input
              type="range"
              min={0.25}
              max={maxVisibleScale}
              step={0.05}
              value={scaleDraft}
              onChange={event => applyScale(Number(event.target.value))}
              className="w-full accent-teal"
              title={`縮放比例 ${scaleDraft.toFixed(2)}`}
            />
          </div>
        </div>
      )}
    </div>
  )
}
