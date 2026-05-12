import { useState, useEffect, useRef } from 'react'
import MonoIcon from '../components/MonoIcon'

const NOTE_COLORS = [
  { label: '奶油黃', value: '#FFE8AA' },
  { label: '薄荷綠', value: '#CBFBC4' },
  { label: '天藍', value: '#AAEEFF' },
  { label: '粉紅', value: '#FFBBBB' },
  { label: '薰衣草', value: '#F0BBFF' },
]

function darken(hex: string): string {
  // 輕微加深，用於邊框
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, ((n >> 16) & 0xff) - 30)
  const g = Math.max(0, ((n >> 8) & 0xff) - 30)
  const b = Math.max(0, (n & 0xff) - 30)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

export default function PinnedNoteWindow() {
  const [noteId, setNoteId] = useState('')
  const [title, setTitle] = useState('便利貼')
  const [content, setContent] = useState('')
  const [color, setColor] = useState('#FFE8AA')
  const [isEditingContent, setIsEditingContent] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const nid = query.get('noteId')
    if (nid) setNoteId(nid)
  }, [])

  useEffect(() => {
    const unsubInit = window.api.on('pinned-note:init', (payload) => {
      const p = payload as { noteId: string; content: string; title: string; color: string }
      setNoteId(p.noteId)
      setContent(p.content || '')
      setTitle(p.title || '便利貼')
      setColor(p.color || '#FFE8AA')
    })

    const unsubUpdateContent = window.api.on('pinned-note:update-content', (payload) => {
      const p = payload as { noteId: string; content: string }
      if (p.noteId === noteId || !noteId) setContent(p.content)
    })

    const unsubUpdateColor = window.api.on('pinned-note:update-color', (payload) => {
      const p = payload as { noteId: string; color: string }
      if (p.noteId === noteId || !noteId) setColor(p.color)
    })

    return () => { unsubInit(); unsubUpdateContent(); unsubUpdateColor() }
  }, [noteId])

  const saveContent = async (val: string) => {
    const pos = await window.api.invoke('pinned-note:get-position', noteId) as { x: number; y: number } | null
    if (pos) await window.api.invoke('pinned-note:update-position', noteId, pos)
    await window.api.invoke('pinned-note:update-content', noteId, val)
    setIsEditingContent(false)
  }

  const saveTitle = async (val: string) => {
    const trimmed = val.trim() || '便利貼'
    setTitle(trimmed)
    await window.api.invoke('pinned-note:update-title', noteId, trimmed)
    setIsEditingTitle(false)
  }

  const handleColorChange = async (newColor: string) => {
    setColor(newColor)
    setShowColorPicker(false)
    await window.api.invoke('pinned-note:update-color', noteId, newColor)
  }

  // 點 X → 收起（不刪除）
  const handleHide = () => {
    window.api.invoke('pinned-note:hide', noteId).catch(console.error)
  }

  const borderColor = darken(color)

  return (
    <div
      className="w-full h-full flex flex-col rounded-2xl overflow-hidden shadow-panel"
      style={{ background: color, border: `1.5px solid ${borderColor}` }}
    >
      {/* 標題列 — 可拖曳 */}
      <div
        className="drag-region flex items-center gap-1 px-2 py-1.5 shrink-0"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        {/* 圖釘 icon = 顏色選擇觸發 */}
        <div className="relative no-drag shrink-0">
          <button
            type="button"
            className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/50 transition-colors"
            style={{ color: darken(borderColor) }}
            onClick={() => setShowColorPicker(v => !v)}
            title="更換便利貼顏色"
          >
            <MonoIcon name="pin" className="w-3.5 h-3.5" />
          </button>
          {showColorPicker && (
            <div
              className="absolute left-0 top-6 z-50 flex flex-col gap-1 bg-white rounded-xl p-2 shadow-panel border border-border"
              style={{ minWidth: 120 }}
            >
              {NOTE_COLORS.map(c => (
                <button
                  key={c.value}
                  type="button"
                  className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[#F0F9F5] text-xs font-medium text-primary transition-colors"
                  onClick={() => handleColorChange(c.value)}
                >
                  <span className="w-3.5 h-3.5 rounded-full border border-border shrink-0" style={{ background: c.value }} />
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 標題文字 or 編輯輸入框 */}
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveTitle(title)
              if (e.key === 'Escape') setIsEditingTitle(false)
            }}
            className="no-drag flex-1 min-w-0 text-xs font-semibold bg-white/60 rounded px-1 outline-none border border-white/80"
            style={{ color: '#3D5A52' }}
            autoFocus
          />
        ) : (
          <span className="flex-1 min-w-0 text-xs font-semibold truncate" style={{ color: '#3D5A52' }}>
            {title}
          </span>
        )}

        {/* 編輯 / 確認 標題按鈕 */}
        <button
          type="button"
          className="no-drag w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors hover:bg-white/50"
          style={{ borderColor, background: 'rgba(255,255,255,0.4)', color: '#3D5A52' }}
          onClick={() => {
            if (isEditingTitle) {
              saveTitle(title)
            } else {
              setIsEditingTitle(true)
              setTimeout(() => titleInputRef.current?.focus(), 0)
            }
          }}
          title={isEditingTitle ? '儲存標題 (Enter)' : '編輯標題'}
        >
          <MonoIcon name={isEditingTitle ? 'check' : 'edit'} className="w-2.5 h-2.5" />
        </button>

        {/* 收起按鈕 */}
        <button
          type="button"
          className="no-drag w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors hover:bg-white/50"
          style={{ borderColor, background: 'rgba(255,255,255,0.4)', color: '#3D5A52' }}
          onClick={handleHide}
          title="收起便利貼（可從管理介面還原）"
        >
          <MonoIcon name="close" className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* 內容區 */}
      <div className="flex-1 min-h-0 p-2 no-drag overflow-hidden">
        {isEditingContent ? (
          <div className="w-full h-full flex flex-col gap-1.5">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setIsEditingContent(false) }}
              className="flex-1 min-h-0 w-full p-1.5 rounded-lg text-sm text-primary resize-none outline-none"
              style={{ background: 'rgba(255,255,255,0.7)', border: `1px solid ${borderColor}` }}
              autoFocus
            />
            <div className="flex gap-1 justify-end shrink-0">
              <button
                type="button"
                className="px-2 py-0.5 text-xs rounded-full border text-primary transition-colors"
                style={{ borderColor, background: 'rgba(255,255,255,0.6)' }}
                onClick={() => setIsEditingContent(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-2 py-0.5 text-xs rounded-full font-semibold text-white transition-colors"
                style={{ background: darken(borderColor) }}
                onClick={() => saveContent(content)}
              >
                保存
              </button>
            </div>
          </div>
        ) : (
          <div
            className="w-full h-full p-1 text-sm leading-relaxed overflow-y-auto whitespace-pre-wrap break-words select-text"
            style={{ color: '#3D5A52', cursor: 'default' }}
            onDoubleClick={() => { setIsEditingContent(true); setTimeout(() => textareaRef.current?.focus(), 0) }}
            onContextMenu={e => { e.preventDefault(); setIsEditingContent(true); setTimeout(() => textareaRef.current?.focus(), 0) }}
            title="雙擊或右鍵編輯內容"
          >
            {content || <span className="opacity-50 italic">（空白便利貼，點擊編輯）</span>}
          </div>
        )}
      </div>
    </div>
  )
}
