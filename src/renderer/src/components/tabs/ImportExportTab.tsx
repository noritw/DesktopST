import { useRef } from 'react'
import type { Character } from '../../types'
import { useCharacterLibraryStore } from '../../stores/useCharacterLibraryStore'

interface Props {
  draft: Character
  onError: (msg: string) => void
  onNotify: (msg: string) => void
}

export default function ImportExportTab({ draft, onError, onNotify }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const openEditor = useCharacterLibraryStore(s => s.openEditor)
  const closeEditor = useCharacterLibraryStore(s => s.closeEditor)

  const exportJson = async () => {
    const res = await window.api.invoke('character:export-json', draft) as { json?: string; error?: string }
    if (res && 'error' in res && res.error) {
      onError(res.error)
      return
    }
    const json = (res as { json: string }).json
    const dlg = await window.api.invoke('file:save-dialog', {
      defaultPath: `${draft.name || 'character'}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }) as { filePath?: string; error?: string }
    if (dlg && 'error' in dlg && dlg.error) {
      onError(dlg.error)
      return
    }
    const fp = (dlg as { filePath?: string }).filePath
    if (!fp) return
    const wr = await window.api.invoke('file:write-file', { path: fp, data: json }) as { ok?: boolean; error?: string }
    if (wr && 'error' in wr && wr.error) onError(wr.error)
    else onNotify('已匯出 JSON')
  }

  const exportPng = async () => {
    const res = await window.api.invoke('character:export-png', draft) as { buffer?: ArrayBuffer; error?: string }
    if (res && 'error' in res && res.error) {
      onError(res.error)
      return
    }
    const buf = (res as { buffer: ArrayBuffer }).buffer
    const dlg = await window.api.invoke('file:save-dialog', {
      defaultPath: `${draft.name || 'character'}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    }) as { filePath?: string; error?: string }
    if (dlg && 'error' in dlg && dlg.error) {
      onError(dlg.error)
      return
    }
    const fp = (dlg as { filePath?: string }).filePath
    if (!fp) return
    const wr = await window.api.invoke('file:write-file', { path: fp, data: buf }) as { ok?: boolean; error?: string }
    if (wr && 'error' in wr && wr.error) onError(wr.error)
    else onNotify('已匯出 PNG 角色卡')
  }

  const pickImport = () => fileRef.current?.click()

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const lower = file.name.toLowerCase()
    const buf = await file.arrayBuffer()
    if (lower.endsWith('.json')) {
      const text = new TextDecoder().decode(buf)
      const res = await window.api.invoke('character:import-json', text) as Character | { error?: string }
      if (res && typeof res === 'object' && 'error' in res) {
        onError(res.error ?? '匯入失敗')
        return
      }
      const char = res as Character
      closeEditor()
      openEditor(char.id)
      onNotify('已匯入，請確認角色資料')
      return
    }
    if (lower.endsWith('.png')) {
      const res = await window.api.invoke('character:import-png', { buffer: buf }) as Character | { error?: string }
      if (res && typeof res === 'object' && 'error' in res) {
        onError(res.error ?? '匯入失敗')
        return
      }
      const char = res as Character
      closeEditor()
      openEditor(char.id)
      onNotify('已匯入，請確認角色資料')
      return
    }
    onError('請選擇 JSON 或 PNG 檔案')
  }

  return (
    <div className="space-y-4">
      <input ref={fileRef} type="file" accept=".json,.png" className="hidden" onChange={onFile} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="tab-btn text-sm px-4 py-2 rounded-full bg-mint text-primary font-semibold" onClick={exportJson}>
          匯出為 JSON
        </button>
        <button type="button" className="tab-btn text-sm px-4 py-2 rounded-full bg-mint text-primary font-semibold" onClick={exportPng}>
          匯出為 PNG 角色卡
        </button>
        <button type="button" className="tab-btn text-sm px-4 py-2 rounded-full border border-border text-primary" onClick={pickImport}>
          匯入 ST 角色卡
        </button>
      </div>
      <p className="text-xs text-secondary leading-relaxed">
        匯入成功後會改為編輯新匯入的角色。若匯入失敗請確認檔案格式。
      </p>
    </div>
  )
}
