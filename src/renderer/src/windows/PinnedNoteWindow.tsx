import { useEffect, useRef, useState, type MouseEvent } from 'react'
import MonoIcon from '../components/MonoIcon'

const DARK_NOTE_COLOR = '#1F2423'

function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, ((n >> 16) & 0xff) - 30)
  const g = Math.max(0, ((n >> 8) & 0xff) - 30)
  const b = Math.max(0, (n & 0xff) - 30)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function isDarkNote(color: string): boolean {
  return color.toUpperCase() === DARK_NOTE_COLOR
}

function getParam(key: string): string {
  return window.windowParams?.get(key) ?? new URLSearchParams(window.location.search).get(key) ?? ''
}

export default function PinnedNoteWindow() {
  const [noteId] = useState(() => getParam('noteId'))
  const [title, setTitle] = useState(() => getParam('title') || '便利貼')
  const [content, setContent] = useState(() => getParam('content'))
  const [color, setColor] = useState(() => getParam('color') || '#FFE8AA')
  const [fontSize, setFontSize] = useState<number | null>(() => {
    const fs = getParam('fontSize')
    return fs ? Number(fs) : null
  })
  const [isEditingContent, setIsEditingContent] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const colorButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const unsubUpdateContent = window.api.on('pinned-note:update-content', (payload) => {
      const p = payload as { noteId: string; content: string }
      if (p.noteId === noteId || !noteId) setContent(p.content)
    })

    const unsubUpdateColor = window.api.on('pinned-note:update-color', (payload) => {
      const p = payload as { noteId: string; color: string }
      if (p.noteId === noteId || !noteId) setColor(p.color)
    })

    return () => { unsubUpdateContent(); unsubUpdateColor() }
  }, [noteId])

  const saveFontSize = async (val: number | null) => {
    setFontSize(val)
    await window.api.invoke('pinned-note:update-font-size', noteId, val)
  }

  const saveContent = async (val: string) => {
    await window.api.invoke('pinned-note:update-content', noteId, val)
    setIsEditingContent(false)
  }

  const saveTitle = async (val: string) => {
    const trimmed = val.trim()
    setTitle(trimmed)
    await window.api.invoke('pinned-note:update-title', noteId, trimmed)
    setIsEditingTitle(false)
  }

  const openColorMenu = () => {
    const r = colorButtonRef.current?.getBoundingClientRect()
    const anchor = r
      ? {
          x: Math.round(window.screenX + r.left),
          y: Math.round(window.screenY + r.top),
          width: Math.round(r.width),
          height: Math.round(r.height)
        }
      : undefined
    window.api.invoke('pinned-note:show-color-menu', noteId, anchor).catch(console.error)
  }

  const handleHide = () => {
    window.api.invoke('pinned-note:hide', noteId).catch(console.error)
  }

  const handleDelete = () => {
    if (!noteId) return
    const confirmed = window.confirm('確定要直接刪除這張便利貼嗎？\n\n這個動作無法復原。')
    if (!confirmed) return
    window.api.invoke('pinned-note:delete', noteId).catch(console.error)
  }

  const bringToFront = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('.no-drag')) return
    if (noteId) window.api.invoke('pinned-note:focus', noteId).catch(console.error)
  }

  const effectiveFontSize = fontSize ?? 14
  const dark = isDarkNote(color)
  const borderColor = color.toUpperCase() === '#FFFFFF' ? '#A9DED2' : darken(color)
  const textColor = dark ? '#F7FFFC' : '#3D5A52'
  const secondaryTextColor = dark ? '#A9DED2' : '#5F857A'
  const controlBg = dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.45)'
  const controlHoverBg = dark ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)'

  return (
    <div
      className="w-full h-full flex flex-col rounded-2xl overflow-hidden shadow-panel"
      style={{ background: color, border: `1.5px solid ${borderColor}` }}
      onMouseDownCapture={(e) => bringToFront(e)}
    >
      <div
        className="drag-region flex items-center gap-1 px-2 py-1.5 shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        <button
          ref={colorButtonRef}
          type="button"
          className="no-drag w-5 h-5 flex items-center justify-center rounded-full transition-colors"
          style={{ color: textColor, background: 'transparent' }}
          onMouseEnter={event => { event.currentTarget.style.background = controlHoverBg }}
          onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
          onClick={openColorMenu}
          title="更換便利貼顏色"
        >
          <MonoIcon name="pin" className="w-3.5 h-3.5" />
        </button>

        {isEditingTitle || title ? (
          isEditingTitle ? (
            <input
              ref={titleInputRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  if (e.nativeEvent.isComposing) return
                  e.preventDefault()
                  void saveTitle(title)
                }
                if (e.key === 'Escape') setIsEditingTitle(false)
              }}
              className="no-drag flex-1 min-w-0 text-xs font-semibold rounded px-1 outline-none border"
              style={{
                color: textColor,
                background: dark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.65)',
                borderColor
              }}
              autoFocus
            />
          ) : (
            <span className="flex-1 min-w-0 text-xs font-semibold truncate" style={{ color: textColor }}>
              {title}
            </span>
          )
        ) : (
          <div className="flex-1" />
        )}

        <button
          type="button"
          className="no-drag w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors"
          style={{ borderColor, background: controlBg, color: textColor }}
          onClick={() => {
            if (isEditingTitle) {
              saveTitle(title)
            } else {
              setIsEditingTitle(true)
              setTimeout(() => titleInputRef.current?.focus(), 0)
            }
          }}
          title={isEditingTitle ? '儲存標題 (Enter)' : title ? '編輯標題' : '新增標題'}
        >
          <MonoIcon name={isEditingTitle ? 'check' : 'edit'} className="w-2.5 h-2.5" />
        </button>

        <button
          type="button"
          className="no-drag w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors"
          style={{ borderColor, background: controlBg, color: textColor }}
          onClick={handleHide}
          title="收起便利貼"
        >
          <MonoIcon name="close" className="w-2.5 h-2.5" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 p-2 no-drag overflow-hidden">
        {isEditingContent ? (
          <div className="w-full h-full flex flex-col gap-1.5">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setIsEditingContent(false)
                  return
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (e.nativeEvent.isComposing) return
                  e.preventDefault()
                  void saveContent(content)
                }
              }}
              className="flex-1 min-h-0 w-full p-1.5 rounded-lg resize-none outline-none"
              style={{
                fontSize: effectiveFontSize,
                lineHeight: 1.5,
                color: textColor,
                background: dark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.7)',
                border: `1px solid ${borderColor}`
              }}
              autoFocus
            />
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] shrink-0" style={{ color: secondaryTextColor }}>A</span>
              <input
                type="range"
                min={11}
                max={48}
                step={1}
                value={effectiveFontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                onPointerUp={e => saveFontSize(Number((e.target as HTMLInputElement).value))}
                className="flex-1 h-3 cursor-pointer accent-teal"
                style={{ accentColor: dark ? '#AAEEDD' : undefined }}
              />
              <span className="text-[13px] shrink-0 font-bold" style={{ color: secondaryTextColor }}>A</span>
              <span className="text-[10px] w-6 text-right shrink-0" style={{ color: secondaryTextColor }}>{effectiveFontSize}</span>
            </div>
            <div className="flex gap-1 justify-end shrink-0">
              <button
                type="button"
                className="px-2 py-0.5 text-xs rounded-full border transition-colors"
                style={{ borderColor, background: controlBg, color: textColor }}
                onClick={() => setIsEditingContent(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-2 py-0.5 text-xs rounded-full font-semibold transition-colors"
                style={{ background: dark ? '#F7FFFC' : darken(borderColor), color: dark ? '#1F2423' : '#FFFFFF' }}
                onClick={() => saveContent(content)}
              >
                儲存
              </button>
            </div>
          </div>
        ) : (
          <div
            className="w-full h-full p-1 pb-7 leading-relaxed overflow-y-auto whitespace-pre-wrap break-words select-text"
            style={{ fontSize: effectiveFontSize, color: content ? textColor : secondaryTextColor, cursor: 'default' }}
            onDoubleClick={() => { setIsEditingContent(true); setTimeout(() => textareaRef.current?.focus(), 0) }}
            onContextMenu={e => { e.preventDefault(); setIsEditingContent(true); setTimeout(() => textareaRef.current?.focus(), 0) }}
            title="雙擊或右鍵編輯內容（編輯時 Enter 儲存，Shift+Enter 換行）"
          >
            {content || <span className="opacity-70 italic">空白便利貼，雙擊開始編輯</span>}
          </div>
        )}
        {!isEditingContent && (
          <button
            type="button"
            className="absolute right-2 bottom-2 w-6 h-6 rounded-full border flex items-center justify-center shrink-0 shadow-soft"
            style={dark
              ? { borderColor: '#A33A3A', background: '#7A1F1F', color: '#FFFFFF' }
              : { borderColor: '#FFB59F', background: '#FFE2D8', color: '#E85D3F' }}
            onClick={handleDelete}
            title="刪除便利貼"
          >
            <MonoIcon name="trash" className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}
