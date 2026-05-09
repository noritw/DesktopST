import { useEffect, useRef, useState } from 'react'
import type { Character } from '../types'
import { useAppStore } from '../stores/useAppStore'
import { useCharacterLibraryStore } from '../stores/useCharacterLibraryStore'
import CharacterCard from '../components/CharacterCard'
import ContextMenu from '../components/ContextMenu'
import CharacterEditor from '../components/CharacterEditor'

export default function CharacterLibraryWindow() {
  const characters = useAppStore(s => s.characters)
  const desktopCharacters = useAppStore(s => s.desktopCharacters)
  const saveCharacter = useAppStore(s => s.saveCharacter)
  const addToDesktop = useAppStore(s => s.addToDesktop)
  const deleteCharacter = useAppStore(s => s.deleteCharacter)

  const editingCharacterId = useCharacterLibraryStore(s => s.editingCharacterId)
  const openEditor = useCharacterLibraryStore(s => s.openEditor)
  const closeEditor = useCharacterLibraryStore(s => s.closeEditor)
  const contextMenu = useCharacterLibraryStore(s => s.contextMenu)
  const openContextMenu = useCharacterLibraryStore(s => s.openContextMenu)
  const closeContextMenu = useCharacterLibraryStore(s => s.closeContextMenu)

  const importRef = useRef<HTMLInputElement>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const onDown = () => window.api.invoke('ui:aux-activated')
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('focus', onDown, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('focus', onDown, true)
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3000)
    return () => window.clearTimeout(t)
  }, [toast])

  const handleNew = async () => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const newChar: Character = {
      id,
      name: '新角色',
      nicknames: [],
      avatar: '',
      description: '',
      personality: '',
      firstMessage: '',
      exampleDialogue: '',
      emotions: {},
      scenario: '',
      systemPromptOverride: '',
      creatorNotes: '',
      createdAt: now,
      updatedAt: now
    }
    try {
      await saveCharacter(newChar)
      openEditor(id)
    } catch (e) {
      setToast(e instanceof Error ? e.message : '無法建立角色')
    }
  }

  const pickImport = () => importRef.current?.click()

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const lower = file.name.toLowerCase()
    const buf = await file.arrayBuffer()
    try {
      if (lower.endsWith('.json')) {
        const text = new TextDecoder().decode(buf)
        const res = await window.api.invoke('character:import-json', text) as Character | { error?: string }
        if (res && typeof res === 'object' && 'error' in res) {
          setToast(res.error ?? '匯入失敗')
          return
        }
        const char = res as Character
        openEditor(char.id)
        setToast('已匯入 JSON 角色卡')
        return
      }
      if (lower.endsWith('.png')) {
        const res = await window.api.invoke('character:import-png', { buffer: buf }) as Character | { error?: string }
        if (res && typeof res === 'object' && 'error' in res) {
          setToast(res.error ?? '匯入失敗')
          return
        }
        const char = res as Character
        openEditor(char.id)
        setToast('已匯入 PNG 角色卡')
        return
      }
      setToast('請選擇 .json 或 .png')
    } catch (err) {
      setToast(err instanceof Error ? err.message : '匯入失敗')
    }
  }

  const openMenuFromEvent = (characterId: string, e: React.MouseEvent) => {
    e.preventDefault()
    openContextMenu(characterId, e.clientX, e.clientY)
  }

  const ctxChar = contextMenu ? characters.find(c => c.id === contextMenu.characterId) : undefined

  const exportJson = async (char: Character) => {
    const res = (await window.api.invoke('character:export-json', char)) as { json?: string; error?: string }
    if (res && 'error' in res && res.error) {
      setToast(res.error)
      return
    }
    const json = (res as { json: string }).json
    const dlg = (await window.api.invoke('file:save-dialog', {
      defaultPath: `${char.name || 'character'}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })) as { filePath?: string; error?: string }
    if (dlg && 'error' in dlg && dlg.error) {
      setToast(dlg.error)
      return
    }
    const fp = (dlg as { filePath?: string }).filePath
    if (!fp) return
    const wr = (await window.api.invoke('file:write-file', { path: fp, data: json })) as { ok?: boolean; error?: string }
    if (wr && 'error' in wr && wr.error) setToast(wr.error)
  }

  const exportPng = async (char: Character) => {
    const res = (await window.api.invoke('character:export-png', char)) as { buffer?: ArrayBuffer; error?: string }
    if (res && 'error' in res && res.error) {
      setToast(res.error)
      return
    }
    const buf = (res as { buffer: ArrayBuffer }).buffer
    const dlg = (await window.api.invoke('file:save-dialog', {
      defaultPath: `${char.name || 'character'}.png`,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    })) as { filePath?: string; error?: string }
    if (dlg && 'error' in dlg && dlg.error) {
      setToast(dlg.error)
      return
    }
    const fp = (dlg as { filePath?: string }).filePath
    if (!fp) return
    const wr = (await window.api.invoke('file:write-file', { path: fp, data: buf })) as { ok?: boolean; error?: string }
    if (wr && 'error' in wr && wr.error) setToast(wr.error)
  }

  return (
    <div className="h-screen flex flex-col bg-bg text-primary overflow-hidden">
      <input ref={importRef} type="file" accept=".json,.png" className="hidden" onChange={onImportFile} />

      <header className="drag-region flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0 bg-[#F7FFFC]">
        <span className="text-sm font-semibold text-primary">角色庫</span>
        <div className="flex items-center gap-2 no-drag">
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded-full bg-mint font-semibold text-primary hover:bg-teal"
            onClick={() => void handleNew()}
          >
            ＋ 新增
          </button>
          <button type="button" className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-mint/40" onClick={pickImport}>
            匯入 ST 角色卡
          </button>
          <button
            type="button"
            className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-mint/40"
            title="關閉"
            onClick={() => window.api.invoke('window:close-self')}
          >
            ×
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {characters.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3 text-secondary text-sm">
            <p>尚無角色。你可以按「＋ 新增」建立空白角色，或使用「匯入 ST 角色卡」載入 JSON／PNG。</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4">
            {characters.map(char => {
              const onDesktop = desktopCharacters.some(d => d.characterId === char.id)
              return (
                <CharacterCard
                  key={char.id}
                  character={char}
                  isOnDesktop={onDesktop}
                  onClick={e => openMenuFromEvent(char.id, e)}
                  onContextMenu={e => openMenuFromEvent(char.id, e)}
                />
              )
            })}
          </div>
        )}
      </main>

      {contextMenu && ctxChar && (
        <ContextMenu
          characterId={contextMenu.characterId}
          isOnDesktop={desktopCharacters.some(d => d.characterId === contextMenu.characterId)}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={closeContextMenu}
          onEdit={() => openEditor(contextMenu.characterId)}
          onDelete={() => void deleteCharacter(contextMenu.characterId)}
          onExportJson={() => void exportJson(ctxChar)}
          onExportPng={() => void exportPng(ctxChar)}
          onSummon={async () => {
            try {
              await addToDesktop(contextMenu.characterId)
            } catch {
              setToast('召喚到桌面失敗')
            }
          }}
        />
      )}

      {editingCharacterId && (
        <CharacterEditor characterId={editingCharacterId} onClose={closeEditor} />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[70] max-w-xs rounded-2xl border border-border bg-white px-4 py-3 text-sm shadow-soft">
          {toast}
        </div>
      )}
    </div>
  )
}
