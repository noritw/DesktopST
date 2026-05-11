import { useEffect, useState } from 'react'

interface Props {
  characterId: string
  isOnDesktop: boolean
  position: { x: number; y: number }
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onExportJson: () => void
  onExportPng: () => void
  onExportDstPack: () => void
  onToggleDesktop: () => void
}

export default function ContextMenu({
  characterId,
  isOnDesktop,
  position,
  onClose,
  onEdit,
  onDelete,
  onExportJson,
  onExportPng,
  onExportDstPack,
  onToggleDesktop
}: Props) {
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      const t = e.target as Node
      const menu = document.getElementById(`ctx-${characterId}`)
      if (menu && menu.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', handle, true)
    return () => document.removeEventListener('mousedown', handle, true)
  }, [characterId, onClose])

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x, typeof window !== 'undefined' ? window.innerWidth - 200 : position.x),
    top: Math.min(position.y, typeof window !== 'undefined' ? window.innerHeight - 300 : position.y),
    zIndex: 80
  }

  if (deleteConfirm) {
    return (
      <div id={`ctx-${characterId}`} style={style} className="rounded-2xl border border-border bg-white shadow-soft p-3 w-[220px] space-y-2">
        <p className="text-xs text-primary leading-relaxed">確定要刪除此角色？此操作無法復原。</p>
        <div className="flex gap-2 justify-end">
          <button type="button" className="text-xs px-3 py-1 rounded-full border border-border text-primary hover:bg-mint/40" onClick={() => setDeleteConfirm(false)}>
            取消
          </button>
          <button
            type="button"
            className="text-xs px-3 py-1 rounded-full bg-[#FFE2D8] text-[#C44B34] font-semibold hover:bg-[#FFD0C4]"
            onClick={() => {
              setDeleteConfirm(false)
              onDelete()
              onClose()
            }}
          >
            確認刪除
          </button>
        </div>
      </div>
    )
  }

  return (
    <div id={`ctx-${characterId}`} style={style} className="rounded-2xl border border-border bg-white shadow-soft overflow-hidden min-w-[184px]">
      <button
        type="button"
        className={`w-full text-left text-sm px-3 py-3 font-semibold ${isOnDesktop ? 'text-[#C44B34] bg-[#FFEAE5] hover:bg-[#FFE2D8]' : 'text-primary bg-mint/55 hover:bg-mint/80 active:bg-mint'}`}
        onClick={() => {
          onToggleDesktop()
          onClose()
        }}
      >
        {isOnDesktop ? '從桌面收回' : '召喚到桌面'}
      </button>
      <div className="border-t border-border" />
      <div className="py-1">
        <button type="button" className="w-full text-left text-sm px-3 py-2 text-primary hover:bg-mint/40" onClick={() => { onEdit(); onClose() }}>
          編輯
        </button>
      </div>
      <div className="border-t border-border my-0" />
      <div className="py-1">
        <div className="px-3 py-1 text-[10px] text-secondary font-medium">匯出（SillyTavern）</div>
        <button type="button" className="w-full text-left text-sm px-3 py-1.5 pl-5 text-primary hover:bg-mint/40" onClick={() => { onExportJson(); onClose() }}>
          匯出 ST JSON
        </button>
        <button type="button" className="w-full text-left text-sm px-3 py-1.5 pl-5 text-primary hover:bg-mint/40" onClick={() => { onExportPng(); onClose() }}>
          匯出 ST PNG
        </button>
      </div>
      <div className="border-t border-border my-0" />
      <div className="py-1">
        <div className="px-3 py-1 text-[10px] text-secondary font-medium">匯出（DesktopST）</div>
        <button type="button" className="w-full text-left text-sm px-3 py-1.5 pl-5 text-primary hover:bg-mint/40" onClick={() => { onExportDstPack(); onClose() }}>
          匯出搬家包（.dstpack）
        </button>
      </div>
      <div className="border-t border-border my-0" />
      <div className="py-1">
        <button type="button" className="w-full text-left text-sm px-3 py-2 text-[#C44B34] hover:bg-[#FFEAE5] flex items-center gap-1.5" onClick={() => setDeleteConfirm(true)}>
          <span className="text-base leading-none">⚠️</span> 刪除角色
        </button>
      </div>
    </div>
  )
}
