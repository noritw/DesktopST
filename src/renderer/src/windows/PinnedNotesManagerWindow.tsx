import { useEffect, useState } from 'react'
import type { PinnedNote } from '../types'
import MonoIcon from '../components/MonoIcon'

const COLOR_LABELS: Record<string, string> = {
  '#FFE8AA': '奶油黃',
  '#FFD6B8': '粉橘',
  '#CBFBC4': '薄荷綠',
  '#B8F4EA': '粉藍綠',
  '#AAEEFF': '天藍',
  '#FFBBBB': '粉紅',
  '#F0BBFF': '薰衣草',
  '#FFFFFF': '純白',
  '#1F2423': '黑底白字',
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

  const confirmNoteLimit = (level?: string, count?: number) => {
    const n = Number.isFinite(count) ? count : 0
    if (level === 'double') {
      return window.confirm(`目前已有 ${n} 張便利貼，繼續新增可能讓桌面變慢。確定還要新增嗎？`) &&
        window.confirm('再次確認：便利貼不會被自動清理，電腦撐不住就要自己收拾喔。')
    }
    return window.confirm(`目前已有 ${n} 張便利貼。可以繼續新增，但太多會影響效能。要繼續嗎？`)
  }

  const handleCreateBlank = async (force = false) => {
    const offset = (notes.length % 10) * 18
    const result = await window.api.invoke(
      'pinned-note:create',
      '',
      '便利貼',
      { x: 320 + offset, y: 120 + offset },
      '',
      force
    ) as { needsConfirm?: boolean; level?: string; count?: number; noteId?: string } | string
    if (typeof result !== 'string' && result?.needsConfirm) {
      if (confirmNoteLimit(result.level, result.count)) await handleCreateBlank(true)
      return
    }
    const noteId = typeof result === 'string' ? result : result?.noteId
    if (noteId) await window.api.invoke('pinned-note:focus', noteId)
    await reload()
  }

  const handleFocus = async (noteId: string) => {
    await window.api.invoke('pinned-note:focus', noteId)
  }

  const handleHide = async (noteId: string) => {
    await window.api.invoke('pinned-note:hide', noteId)
  }

  const handleRestore = async (noteId: string) => {
    await window.api.invoke('pinned-note:restore', noteId)
  }

  const handleDelete = async (noteId: string) => {
    await window.api.invoke('pinned-note:delete', noteId)
  }

  const handleHideAll = async () => {
    await window.api.invoke('pinned-note:hide-all')
  }

  const handleDeleteAll = async () => {
    if (!window.confirm(`確定要刪除全部 ${notes.length} 張便利貼嗎？\n\n這個動作無法復原。`)) return
    await window.api.invoke('pinned-note:delete-all')
  }

  const handleClose = () => {
    window.api.invoke('window:close-self').catch(console.error)
  }

  const visibleNotes = notes.filter(n => n.visible)
  const hiddenNotes = notes.filter(n => !n.visible)

  return (
    <div className="relative w-full h-full flex flex-col bg-[#F7FFFC] border border-border rounded-2xl overflow-hidden shadow-panel">
      <div className="drag-region absolute left-0 right-0 top-0 h-12" />

      <div className="drag-region relative flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MonoIcon name="pin" className="w-4 h-4 text-[#7BA898] shrink-0" />
          <span className="text-sm font-bold text-primary truncate">便利貼管理</span>
          {notes.length > 0 && (
            <span className="text-xs text-secondary bg-[#E8FBF4] rounded-full px-2 py-0.5 shrink-0">{notes.length} 張</span>
          )}
        </div>
        <button
          type="button"
          className="no-drag w-6 h-6 rounded-full border border-border bg-white text-secondary hover:text-primary hover:bg-mint transition-colors flex items-center justify-center"
          onClick={handleClose}
          title="關閉"
        >
          <MonoIcon name="close" className="w-3 h-3" />
        </button>
      </div>

      <div className="no-drag flex items-center gap-2 px-3 py-2 border-b border-border bg-white/45 shrink-0">
        <button
          type="button"
          className="rounded-full border border-border bg-white/85 px-3 py-1 text-xs font-semibold text-primary hover:bg-mint transition-colors"
          onClick={() => handleCreateBlank()}
          title="新增一張空白便利貼"
        >
          新增空白
        </button>
        {notes.length > 0 && (
          <>
            <button
              type="button"
              className="rounded-full border border-border bg-white/85 px-3 py-1 text-xs font-semibold text-primary hover:bg-mint transition-colors disabled:opacity-45"
              onClick={handleHideAll}
              disabled={visibleNotes.length === 0}
              title="收起目前桌面上的所有便利貼"
            >
              全部收起
            </button>
            <button
              type="button"
              className="ml-auto rounded-full border border-[#FF9E8A] bg-[#FFE2D8] px-3 py-1 text-xs font-semibold text-[#D9482F] hover:bg-[#FFBBBB] transition-colors"
              onClick={handleDeleteAll}
              title="刪除所有便利貼"
            >
              全部刪除
            </button>
          </>
        )}
      </div>

      <div className="no-drag flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
        {notes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-secondary">
            <MonoIcon name="pin" className="w-10 h-10 opacity-30" />
            <p className="text-sm">目前沒有便利貼</p>
            <p className="text-xs opacity-70">可以先新增空白便利貼，或從對話泡泡釘選。</p>
          </div>
        )}

        {visibleNotes.length > 0 && (
          <section>
            <div className="text-[11px] font-semibold text-secondary uppercase tracking-wide mb-2 px-1">
              桌面上 ({visibleNotes.length})
            </div>
            <div className="space-y-2">
              {visibleNotes.map(note => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onFocus={handleFocus}
                  onHide={handleHide}
                  onDelete={handleDelete}
                  showRestoreButton={false}
                />
              ))}
            </div>
          </section>
        )}

        {hiddenNotes.length > 0 && (
          <section>
            <div className="text-[11px] font-semibold text-secondary uppercase tracking-wide mb-2 px-1">
              已收起 ({hiddenNotes.length})
            </div>
            <div className="space-y-2">
              {hiddenNotes.map(note => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onFocus={handleFocus}
                  onRestore={handleRestore}
                  onDelete={handleDelete}
                  showRestoreButton
                />
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
  onFocus,
  onHide,
  onRestore,
  onDelete,
  showRestoreButton
}: {
  note: PinnedNote
  onFocus: (id: string) => void
  onHide?: (id: string) => void
  onRestore?: (id: string) => void
  onDelete: (id: string) => void
  showRestoreButton: boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const colorLabel = COLOR_LABELS[note.color] ?? note.color
  const preview = note.content || '空白便利貼'

  return (
    <div
      role="button"
      tabIndex={0}
      className="w-full text-left rounded-xl p-3 flex items-start gap-3 border transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-[#AAEEDD]"
      style={{ background: note.color, borderColor: note.color }}
      onClick={() => onFocus(note.id)}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onFocus(note.id)
        }
      }}
      title={note.visible ? '點選後將此便利貼推到最上層' : '點選後還原並推到最上層'}
    >
      <span className="shrink-0 w-3 h-3 mt-0.5 rounded-full border border-white/70" style={{ background: note.color }} title={colorLabel} />

      <span className="flex-1 min-w-0">
        <span className="block text-xs font-semibold text-primary truncate">{note.title || '便利貼'}</span>
        <span className="block text-xs text-secondary mt-0.5 line-clamp-2 break-words whitespace-pre-wrap">
          {preview}
        </span>
      </span>

      <span className="shrink-0 flex gap-1 items-center" onClick={event => event.stopPropagation()}>
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
            title="還原便利貼"
          >
            還原
          </button>
        )}
        {confirmDelete ? (
          <span className="flex gap-1">
            <button
              type="button"
              className="text-[11px] px-2 py-0.5 rounded-full bg-[#FFBBBB] border border-[#FF9E8A] text-[#D9482F] font-semibold"
              onClick={() => onDelete(note.id)}
            >
              確定刪除
            </button>
            <button
              type="button"
              className="text-[11px] px-2 py-0.5 rounded-full bg-white/80 border border-white/60 text-secondary"
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="w-5 h-5 rounded-full bg-white/60 border border-white/60 text-secondary hover:text-[#D9482F] hover:bg-[#FFE2D8] flex items-center justify-center transition-colors"
            onClick={() => setConfirmDelete(true)}
            title="刪除便利貼"
          >
            <MonoIcon name="trash" className="w-3 h-3" />
          </button>
        )}
      </span>
    </div>
  )
}
