import { useState, useEffect } from 'react'
import type { PinnedNote } from '../types'
import MonoIcon from '../components/MonoIcon'

const COLOR_LABELS: Record<string, string> = {
  '#FFE8AA': '奶油黃',
  '#CBFBC4': '薄荷綠',
  '#AAEEFF': '天藍',
  '#FFBBBB': '粉紅',
  '#F0BBFF': '薰衣草',
}

export default function PinnedNotesManagerWindow() {
  const [notes, setNotes] = useState<PinnedNote[]>([])

  const reload = async () => {
    const list = await window.api.invoke('pinned-note:list') as PinnedNote[]
    setNotes(list ?? [])
  }

  useEffect(() => {
    reload()
    const unsub = window.api.on('settings:updated', () => reload())
    return unsub
  }, [])

  const handleHide = async (noteId: string) => {
    await window.api.invoke('pinned-note:hide', noteId)
  }

  const handleRestore = async (noteId: string) => {
    await window.api.invoke('pinned-note:restore', noteId)
  }

  const handleDelete = async (noteId: string) => {
    await window.api.invoke('pinned-note:delete', noteId)
  }

  const handleClose = () => {
    window.api.invoke('window:close-self').catch(console.error)
  }

  const visibleNotes = notes.filter(n => n.visible)
  const hiddenNotes = notes.filter(n => !n.visible)

  return (
    <div className="w-full h-full flex flex-col bg-[#F7FFFC] border border-[#D8F5EC] rounded-2xl overflow-hidden shadow-panel">
      {/* 標題列 */}
      <div className="drag-region flex items-center justify-between px-4 py-3 border-b border-[#D8F5EC] shrink-0">
        <div className="flex items-center gap-2">
          <MonoIcon name="pin" className="w-4 h-4 text-[#7BA898]" />
          <span className="text-sm font-bold text-primary">便利貼管理</span>
          {notes.length > 0 && (
            <span className="text-xs text-secondary bg-[#E8FBF4] rounded-full px-2 py-0.5">{notes.length} 張</span>
          )}
        </div>
        <button
          type="button"
          className="no-drag w-6 h-6 rounded-full border border-border bg-white text-secondary hover:text-primary hover:bg-mint transition-colors flex items-center justify-center"
          onClick={handleClose}
          title="關閉管理介面"
        >
          <MonoIcon name="close" className="w-3 h-3" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
        {notes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-secondary">
            <MonoIcon name="pin" className="w-10 h-10 opacity-30" />
            <p className="text-sm">還沒有便利貼</p>
            <p className="text-xs opacity-70">從對話泡泡點 📌 或輸入框的圖釘按鈕新增</p>
          </div>
        )}

        {/* 桌面上的便利貼 */}
        {visibleNotes.length > 0 && (
          <section>
            <div className="text-[11px] font-semibold text-secondary uppercase tracking-wide mb-2 px-1">
              桌面上 ({visibleNotes.length})
            </div>
            <div className="space-y-2">
              {visibleNotes.map(note => (
                <NoteCard key={note.id} note={note} onHide={handleHide} onDelete={handleDelete} showRestoreButton={false} />
              ))}
            </div>
          </section>
        )}

        {/* 收起的便利貼 */}
        {hiddenNotes.length > 0 && (
          <section>
            <div className="text-[11px] font-semibold text-secondary uppercase tracking-wide mb-2 px-1">
              已收起 ({hiddenNotes.length})
            </div>
            <div className="space-y-2">
              {hiddenNotes.map(note => (
                <NoteCard key={note.id} note={note} onRestore={handleRestore} onDelete={handleDelete} showRestoreButton />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function NoteCard({
  note,
  onHide,
  onRestore,
  onDelete,
  showRestoreButton
}: {
  note: PinnedNote
  onHide?: (id: string) => void
  onRestore?: (id: string) => void
  onDelete: (id: string) => void
  showRestoreButton: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const colorLabel = COLOR_LABELS[note.color] ?? note.color

  return (
    <div
      className="rounded-xl p-3 flex items-start gap-3 border"
      style={{ background: note.color, borderColor: note.color }}
    >
      {/* 顏色小圓 */}
      <div className="shrink-0 w-3 h-3 mt-0.5 rounded-full border border-white/60" style={{ background: note.color }} title={colorLabel} />

      {/* 內容 */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-primary truncate">{note.title}</div>
        <div className="text-xs text-secondary mt-0.5 line-clamp-2 break-words whitespace-pre-wrap">
          {note.content || <span className="italic opacity-60">（空白便利貼）</span>}
        </div>
      </div>

      {/* 操作按鈕 */}
      <div className="shrink-0 flex gap-1 items-center">
        {!showRestoreButton && onHide && (
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 rounded-full bg-white/80 border border-white/60 text-primary font-semibold hover:bg-mint transition-colors"
            onClick={() => onHide(note.id)}
            title="收起便利貼"
          >
            收起
          </button>
        )}
        {showRestoreButton && onRestore && (
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 rounded-full bg-white/80 border border-white/60 text-primary font-semibold hover:bg-mint transition-colors"
            onClick={() => onRestore(note.id)}
            title="貼回桌面"
          >
            貼回
          </button>
        )}
        {confirmDelete ? (
          <div className="flex gap-1">
            <button
              type="button"
              className="text-[11px] px-2 py-0.5 rounded-full bg-[#FFBBBB] border border-[#FFB59F] text-[#E85D3F] font-semibold"
              onClick={() => onDelete(note.id)}
            >
              確認刪除
            </button>
            <button
              type="button"
              className="text-[11px] px-2 py-0.5 rounded-full bg-white/80 border border-white/60 text-secondary"
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="w-5 h-5 rounded-full bg-white/60 border border-white/60 text-secondary hover:text-[#E85D3F] hover:bg-[#FFE2D8] flex items-center justify-center transition-colors"
            onClick={() => setConfirmDelete(true)}
            title="刪除便利貼"
          >
            <MonoIcon name="trash" className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  )
}
