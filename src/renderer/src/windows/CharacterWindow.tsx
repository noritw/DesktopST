import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useAppStore, selectCharacter, selectDesktopChar, selectCharacterLastMessage } from '../stores/useAppStore'
import CharacterSprite, { type CharacterSpriteHandle } from '../components/CharacterSprite'
import HoverMenu, { HoverMenuIcon } from '../components/HoverMenu'
import MonoIcon from '../components/MonoIcon'

/** CharacterSprite 框高為 260×scale；object-fit:contain 時腳常在框內偏上，左右欄需上移才能與視覺腳底對齊 */
const SIDE_TOOLBAR_FOOT_LIFT_RATIO = 0.072

function mergeScreenRectsFromElements(elements: (HTMLElement | null)[]): { x: number; y: number; w: number; h: number } | null {
  let minL = Infinity
  let minT = Infinity
  let maxR = -Infinity
  let maxB = -Infinity
  let any = false
  for (const el of elements) {
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    any = true
    minL = Math.min(minL, r.left)
    minT = Math.min(minT, r.top)
    maxR = Math.max(maxR, r.right)
    maxB = Math.max(maxB, r.bottom)
  }
  if (!any) return null
  return {
    x: Math.round(window.screenX + minL),
    y: Math.round(window.screenY + minT),
    w: Math.round(maxR - minL),
    h: Math.round(maxB - minT)
  }
}

interface Props {
  characterId: string
}

export default function CharacterWindow({ characterId }: Props) {
  const character = useAppStore(selectCharacter(characterId))
  const desktopState = useAppStore(selectDesktopChar(characterId))
  const desktopCharacters = useAppStore(s => s.desktopCharacters)
  const removeFromDesktop = useAppStore(s => s.removeFromDesktop)
  const forceSpeak = useAppStore(s => s.forceSpeak)
  const toggleMute = useAppStore(s => s.toggleMute)
  const addToDesktop = useAppStore(s => s.addToDesktop)
  const characters = useAppStore(s => s.characters)
  const isThinking = useAppStore(s => !!s.thinkingByCharacterId[characterId])
  const uiAppFocused = useAppStore(s => s.uiAppFocused)
  const hoverMenuOnHover = useAppStore(s => s.settings?.ui.hoverMenuOnHover ?? true)

  const urlSize = window.windowParams?.get('size') ?? new URLSearchParams(window.location.search).get('size')
  const initialSize = urlSize ? Number(urlSize) : NaN
  const size = desktopState?.size ?? (Number.isFinite(initialSize) && initialSize > 0 ? initialSize : 1)
  const flipped = desktopState?.flipped ?? false
  const isMuted = desktopState?.muted ?? false
  const canRemove = desktopCharacters.length > 1

  const availableChars = useMemo(
    () => characters.filter(c => !desktopCharacters.some(d => d.characterId === c.id)),
    [characters, desktopCharacters]
  )
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
  const [flipDraft, setFlipDraft] = useState(flipped)
  const [overrideEmotion, setOverrideEmotion] = useState<string | null>(null)

  const interactiveRef = useRef<HTMLDivElement>(null)
  const menuPinnedRef = useRef(menuPinned)
  useEffect(() => { menuPinnedRef.current = menuPinned }, [menuPinned])
  const spriteRef = useRef<CharacterSpriteHandle>(null)
  const spriteDivRef = useRef<HTMLDivElement>(null)
  const hoverMenuButtonsRef = useRef<HTMLDivElement | null>(null)
  const leftStackRef = useRef<HTMLDivElement | null>(null)
  const headActionsRef = useRef<HTMLDivElement | null>(null)
  const closeMenuRef = useRef<HTMLDivElement | null>(null)
  const scaleControlsRef = useRef<HTMLDivElement | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const didDragRef = useRef(false)
  const lastMsgIdRef = useRef<string | undefined>(undefined)
  // 追蹤游標是否在 sprite 的不透明區域上
  const [spriteOpaque, setSpriteOpaque] = useState(false)

  useEffect(() => {
    if (!uiAppFocused) setHovered(false)
  }, [uiAppFocused])

  // 監聽表情切換事件（來自對話記錄點擊）— 保持顯示直到新訊息到來或新的選擇
  useEffect(() => {
    const unsubscribe = window.api.on('character:display-emotion', (payload) => {
      const { emotion } = payload as { emotion: string }
      setOverrideEmotion(emotion)
    })
    return () => unsubscribe()
  }, [])

  // 追蹤最後訊息 ID 變化，當新訊息到來時清除 override
  useEffect(() => {
    const lastMsg = useAppStore.getState().conversation?.messages
      .filter(m => m.characterId === characterId)
      .pop()
    if (lastMsg?.id && lastMsg.id !== lastMsgIdRef.current) {
      lastMsgIdRef.current = lastMsg.id
      setOverrideEmotion(null)
    }
  })

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
      setFlipDraft(flipped)
    }
  }, [flipped, scaleMode, size])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    window.api.invoke('ui:character-activated', characterId)
    window.api.invoke('desktop:drag-start', characterId, event.screenX, event.screenY)
    didDragRef.current = false
    dragStartRef.current = { x: event.screenX, y: event.screenY }

    const target = event.currentTarget
    const onMove = (moveEvent: PointerEvent) => {
      if (!dragStartRef.current) return
      const dx = moveEvent.screenX - dragStartRef.current.x
      const dy = moveEvent.screenY - dragStartRef.current.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true
      window.api.send('desktop:drag-move', characterId, moveEvent.screenX, moveEvent.screenY)
    }

    const onUp = () => {
      dragStartRef.current = null
      window.api.invoke('desktop:drag-end', characterId)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
    }

    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
  }, [characterId])

  const handleClick = useCallback((event: React.MouseEvent) => {
    if (scaleMode || didDragRef.current) return
    event.stopPropagation()
    window.api.invoke('ui:character-activated', characterId)
    window.api.invoke('window:toggle-input')
  }, [characterId, scaleMode])

  const menuVisible = menuPinned || (hoverMenuOnHover && hovered && !hoverSuppressed)

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
      if (scaleMode) {
        window.api.send('desktop:update-hit-rects', characterId, {
          sprite: toScreenRect(document.documentElement.getBoundingClientRect()),
          buttons: null
        })
        return
      }
      const sprite = toScreenRect(spriteEl.getBoundingClientRect())
      let buttons: ReturnType<typeof toScreenRect> | null = null
      if (menuVisible) {
        buttons = mergeScreenRectsFromElements([
          hoverMenuButtonsRef.current,
          leftStackRef.current,
          headActionsRef.current,
          closeMenuRef.current
        ])
      }
      window.api.send('desktop:update-hit-rects', characterId, { sprite, buttons })
    }

    tick()
    const id = window.setInterval(tick, 80)
    return () => {
      window.clearInterval(id)
      window.api.send('desktop:update-hit-rects', characterId, null)
    }
  }, [characterId, scaleMode, menuVisible])

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
    setFlipDraft(flipped)
    window.api.invoke('desktop:preview-size', characterId, maxVisibleScale)
    setScaleMode(true)
    setMenuPinned(true)
    setHoverSuppressed(false)
  }, [characterId, flipped, maxVisibleScale, size])

  const exitScaleMode = useCallback(() => {
    const next = Number(scaleText)
    const finalScale = Number.isFinite(next)
      ? Math.min(maxVisibleScale, Math.max(0.25, next))
      : scaleDraft
    setScaleDraft(finalScale)
    setScaleText(finalScale.toFixed(2).replace(/\.?0+$/, ''))
    window.api.invoke('desktop:update-size', characterId, finalScale)
    window.api.invoke('desktop:update-flipped', characterId, flipDraft)
    setScaleMode(false)
    setMenuPinned(true)
  }, [characterId, flipDraft, maxVisibleScale, scaleDraft, scaleText])

  const lastMsg = useAppStore(selectCharacterLastMessage(characterId))
  const emotionTag = overrideEmotion ?? lastMsg?.emotion

  if (!character) return null

  const renderedSize = scaleMode ? scaleDraft : Math.min(maxVisibleScale, Math.max(0.25, size))
  const renderedFlipped = scaleMode ? flipDraft : flipped
  const sideToolbarLiftPx = Math.round(260 * renderedSize * SIDE_TOOLBAR_FOOT_LIFT_RATIO)

  return (
    <div
      className="w-full h-full relative select-none"
      style={{ background: 'transparent', pointerEvents: 'none' }}
    >
      {/* Character sprite — lifts up in scale mode to leave room for the fixed control panel */}
      <div
        className={`absolute left-0 flex items-end ${scaleMode ? 'bottom-24' : 'bottom-[52px]'}`}
        style={{ pointerEvents: 'auto' }}
        ref={interactiveRef}
      >
        {/* 左側：加入角色（在垃圾桶上方）、從桌面移除 */}
        {!scaleMode && (
          <div
            ref={leftStackRef}
            className="flex flex-col items-center gap-2 pr-1 no-drag self-end"
            style={{
              opacity: menuVisible ? 1 : 0,
              pointerEvents: menuVisible ? 'auto' : 'none',
              transition: 'opacity 0.2s ease',
              transform: `translateY(-${sideToolbarLiftPx}px)`
            }}
          >
            {availableChars.length > 0 && (
              <button
                type="button"
                title={`加入角色：${availableChars[0].name}`}
                aria-label={`加入角色：${availableChars[0].name}`}
                onClick={() => addToDesktop(availableChars[0].id)}
                className="btn-round text-primary"
              >
                <span className="text-2xl leading-none font-light">+</span>
              </button>
            )}
            <button
              type="button"
              title="開啟角色庫首頁"
              aria-label="開啟角色庫首頁"
              onClick={() => window.api.invoke('character-library:open', { mode: 'home' })}
              className="btn-round text-primary"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
              </svg>
            </button>
            {canRemove && (
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
            )}
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
                border: '1px solid var(--color-teal)',
                color: 'var(--color-text-primary)'
              }}
            >
              <span className="dst-thinking-dots" aria-label="thinking">
                <span>.</span><span>.</span><span>.</span>
              </span>
            </div>
          )}

          {!scaleMode && menuVisible && (
            <div
              ref={headActionsRef}
              className="absolute left-0 right-0 z-[11] flex justify-center gap-2 no-drag"
              style={{ bottom: '100%', marginBottom: 4, pointerEvents: 'auto' }}
            >
              <button
                type="button"
                title={isMuted ? '角色目前禁言，恢復說話後才能說點什麼' : '說點什麼'}
                aria-label={isMuted ? '角色目前禁言，恢復說話後才能說點什麼' : '說點什麼'}
                disabled={isMuted}
                onClick={() => forceSpeak(characterId)}
                className={`btn-round text-primary ${isMuted ? 'opacity-45 cursor-not-allowed pointer-events-none' : ''}`}
              >
                <HoverMenuIcon name="speak" />
              </button>
              <button
                type="button"
                title={isMuted ? '目前禁言，點一下恢復說話' : '目前會說話，點一下禁言'}
                aria-label={isMuted ? '目前禁言，點一下恢復說話' : '目前會說話，點一下禁言'}
                aria-pressed={isMuted}
                onClick={() => toggleMute(characterId)}
                className={`btn-round ${isMuted ? 'btn-danger opacity-85 ring-1 ring-[#FFB59F]' : 'text-primary'}`}
              >
                <HoverMenuIcon name={isMuted ? 'muted' : 'volume'} />
              </button>
            </div>
          )}

          <div
            ref={spriteDivRef}
            className="cursor-grab active:cursor-grabbing"
            title={scaleMode ? undefined : '點擊角色可開啟發話視窗'}
            onPointerDown={(event) => {
              if (!spriteOpaque && !hovered && !scaleMode) return
              handlePointerDown(event)
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
              spriteIds={character.spriteIds}
              name={character.name}
              size={renderedSize}
              flipped={renderedFlipped}
            />
          </div>

          <div
            ref={closeMenuRef}
            className="absolute left-0 right-0 z-[12] flex justify-center gap-3 no-drag"
            style={{
              top: '100%',
              marginTop: 6,
              opacity: menuVisible ? 1 : 0,
              transition: 'opacity 0.2s ease',
              pointerEvents: menuVisible ? 'auto' : 'none'
            }}
          >
            <button
              type="button"
              title="便利貼管理"
              onClick={() => window.api.invoke('pinned-note:open-manager')}
              className="btn-round text-primary !bg-mint hover:!bg-white hover:!text-black"
            >
              <MonoIcon name="notes" className="w-5 h-5" />
            </button>
            <button
              type="button"
              title="提醒管理"
              onClick={() => window.api.invoke('reminder:open-manager')}
              className="btn-round text-primary !bg-mint hover:!bg-white hover:!text-black"
            >
              <MonoIcon name="alarm" className="w-5 h-5" />
            </button>
          </div>
        </div>

        {!scaleMode && (
          <div className="self-end" style={{ transform: `translateY(-${sideToolbarLiftPx}px)` }}>
            <HoverMenu
              visible={menuVisible}
              onSettings={() => window.api.invoke('character-library:open', { mode: 'edit', characterId })}
              onScale={enterScaleMode}
              onButtonsEl={(el) => { hoverMenuButtonsRef.current = el }}
            />
          </div>
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
          <div className="rounded-2xl border border-border bg-surface-90 px-3 py-2 shadow-soft">
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                className="w-8 h-8 rounded-full border border-border bg-surface-90 text-primary flex items-center justify-center hover:bg-mint"
                title="Reset"
                onClick={() => applyScale(1)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="w-5 h-5">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M3 3v5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
                  className="min-w-0 w-full rounded-full border border-border bg-surface px-2 py-1 text-center text-primary outline-none focus:border-teal"
                  title="Scale"
                />
              </div>
              <button
                type="button"
                className="w-8 h-8 rounded-full border border-border bg-mint text-primary flex items-center justify-center hover:bg-teal"
                title="OK"
                onMouseDown={event => {
                  event.preventDefault()
                  event.stopPropagation()
                  exitScaleMode()
                }}
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
            <label className="mt-2 flex items-center gap-2 text-xs text-primary select-none cursor-pointer">
              <input
                type="checkbox"
                checked={flipDraft}
                onChange={event => setFlipDraft(event.target.checked)}
                className="accent-teal w-4 h-4"
              />
              <span>水平翻轉角色圖片</span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
