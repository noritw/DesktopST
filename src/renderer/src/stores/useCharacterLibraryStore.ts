import { create } from 'zustand'

interface CharacterLibraryStore {
  editingCharacterId: string | null
  contextMenu: { characterId: string; x: number; y: number } | null
  exportMenuCharId: string | null

  openEditor: (id: string) => void
  closeEditor: () => void
  openContextMenu: (characterId: string, x: number, y: number) => void
  closeContextMenu: () => void
  openExportMenu: (id: string) => void
  closeExportMenu: () => void
}

export const useCharacterLibraryStore = create<CharacterLibraryStore>(set => ({
  editingCharacterId: null,
  contextMenu: null,
  exportMenuCharId: null,

  openEditor: (id: string) => set({ editingCharacterId: id }),
  closeEditor: () => set({ editingCharacterId: null }),
  openContextMenu: (characterId, x, y) => set({ contextMenu: { characterId, x, y } }),
  closeContextMenu: () => set({ contextMenu: null }),
  openExportMenu: id => set({ exportMenuCharId: id }),
  closeExportMenu: () => set({ exportMenuCharId: null })
}))
