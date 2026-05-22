import { useRef } from 'react'
import type { Character } from '../../types'
import { useCharacterLibraryStore } from '../../stores/useCharacterLibraryStore'

interface Props {
  draft: Character
  onError: (msg: string) => void
  onNotify: (msg: string) => void
}

export default function ImportExportTab({ draft, onError, onNotify }: Props) {
  const dstpackFileRef = useRef<HTMLInputElement>(null)
  const stFileRef = useRef<HTMLInputElement>(null)
  const overwriteJsonFileRef = useRef<HTMLInputElement>(null)
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

  const exportDstPack = async () => {
    const res = await window.api.invoke('character:build-dstpack', {
      characterIds: [draft.id],
      includeGlobalSettings: false
    }) as { buffer?: ArrayBuffer; error?: string }
    if (res && 'error' in res && res.error) {
      onError(res.error)
      return
    }
    const buf = (res as { buffer: ArrayBuffer }).buffer
    const dlg = await window.api.invoke('file:save-dialog', {
      defaultPath: `${draft.name || 'character'}.dstpack`,
      filters: [{ name: 'DesktopST 角色包', extensions: ['dstpack'] }]
    }) as { filePath?: string; error?: string }
    if (dlg && 'error' in dlg && dlg.error) {
      onError(dlg.error)
      return
    }
    const fp = (dlg as { filePath?: string }).filePath
    if (!fp) return
    const wr = await window.api.invoke('file:write-file', { path: fp, data: buf }) as { ok?: boolean; error?: string }
    if (wr && 'error' in wr && wr.error) onError(wr.error)
    else onNotify('已匯出角色包')
  }

  const onDstpackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const buf = await file.arrayBuffer()
    const res = await window.api.invoke('character:import-dstpack', { buffer: buf }) as {
      ok?: boolean
      imported?: number
      skipped?: number
      error?: string
    }
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      onError(res.error ?? '匯入失敗')
      return
    }
    const imp = typeof res.imported === 'number' ? res.imported : 0
    const sk = typeof res.skipped === 'number' ? res.skipped : 0
    onNotify(`已匯入角色包：${imp} 個角色，略過 ${sk} 個`)
  }

  const onStFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const lower = file.name.toLowerCase()
    const buf = await file.arrayBuffer()
    if (lower.endsWith('.json')) {
      const text = new TextDecoder().decode(buf)
      const sourcePath = (file as File & { path?: string }).path
      const res = await window.api.invoke('character:import-json', {
        json: text,
        sourcePath
      }) as Character | { error?: string }
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
    onError('請選擇 JSON 或 PNG 格式的 SillyTavern 角色卡')
  }

  const onOverwriteJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.json')) {
      onError('請選擇 JSON 檔案')
      return
    }

    const confirmed = window.confirm(
      `確定要用「${file.name}」覆蓋目前角色「${draft.name}」嗎？\n\n` +
      '此操作會覆蓋角色文字資料。\n若匯入 JSON 沒有主圖/情緒圖片，會保留目前圖片設定。'
    )
    if (!confirmed) return

    try {
      const text = await file.text()
      const sourcePath = (file as File & { path?: string }).path
      const res = await window.api.invoke('character:import-json', {
        json: text,
        sourcePath,
        replaceCharacterId: draft.id
      }) as Character | { error?: string }

      if (res && typeof res === 'object' && 'error' in res) {
        onError(res.error ?? '覆蓋失敗')
        return
      }

      closeEditor()
      openEditor(draft.id)
      onNotify('已以 JSON 覆蓋目前角色')
    } catch (err) {
      onError(err instanceof Error ? err.message : '覆蓋失敗')
    }
  }

  return (
    <div className="space-y-5">
      {/* DesktopST 角色包 */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-1">DesktopST 角色包</h3>
        <p className="text-xs text-secondary leading-relaxed mb-3">
          在不同電腦之間轉移角色，包含角色設定與所有情緒圖片。
        </p>
        <input ref={dstpackFileRef} type="file" accept=".dstpack" className="hidden" onChange={onDstpackFile} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tab-btn text-sm px-4 py-2 rounded-full bg-[#AAEEDD] text-primary font-semibold" onClick={exportDstPack}>
            匯出 DesktopST 角色包
          </button>
          <button type="button" className="tab-btn text-sm px-4 py-2 rounded-full border border-border text-primary" onClick={() => dstpackFileRef.current?.click()}>
            匯入 DesktopST 角色包
          </button>
        </div>
      </section>

      <hr className="border-border/50" />

      {/* SillyTavern 角色卡 */}
      <section>
        <h3 className="text-sm font-semibold text-primary mb-1">SillyTavern 角色卡</h3>
        <p className="text-xs text-secondary leading-relaxed mb-3">
          匯入或匯出 SillyTavern 相容格式（JSON / PNG），適合與 ST 使用者交換角色。
        </p>
        <input ref={stFileRef} type="file" accept=".json,.png" className="hidden" onChange={onStFile} />
        <input ref={overwriteJsonFileRef} type="file" accept=".json" className="hidden" onChange={onOverwriteJsonFile} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tab-btn text-sm px-4 py-2 rounded-full bg-mint text-primary font-semibold" onClick={exportJson}>
            匯出 ST JSON
          </button>
          <button type="button" className="tab-btn text-sm px-4 py-2 rounded-full bg-mint text-primary font-semibold" onClick={exportPng}>
            匯出 ST PNG
          </button>
          <button type="button" className="tab-btn text-sm px-4 py-2 rounded-full border border-border text-primary" onClick={() => stFileRef.current?.click()}>
            匯入 ST 角色卡
          </button>
          <button
            type="button"
            className="tab-btn text-sm px-4 py-2 rounded-full border border-border text-primary"
            onClick={() => overwriteJsonFileRef.current?.click()}
          >
            匯入 JSON（覆蓋此角色）
          </button>
        </div>
        <p className="text-xs text-secondary leading-relaxed mt-2">
          「匯入 ST 角色卡」會建立新角色；「匯入 JSON（覆蓋此角色）」會直接覆蓋目前角色（有確認視窗）。
        </p>
      </section>
    </div>
  )
}
