import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('nutritionDesktop', {
  load: () => ipcRenderer.invoke('nutrition:load'),
  logMeal: (foodItemId: string, eatenAt: number) => ipcRenderer.invoke('nutrition:log-meal', foodItemId, eatenAt),
  removeMeal: (id: string) => ipcRenderer.invoke('nutrition:remove-meal', id),
  updateMeal: (id: string, patch: { servings: number; eatenAt: number; scope: 'meal' | 'food'; name: string; kcal: number; proteinG: number }) =>
    ipcRenderer.invoke('nutrition:update-meal', id, patch),
  saveFood: (foodItem: unknown) => ipcRenderer.invoke('nutrition:save-food', foodItem),
  removeFood: (id: string) => ipcRenderer.invoke('nutrition:remove-food', id),
  saveProfile: (profile: unknown) => ipcRenderer.invoke('nutrition:save-profile', profile),
  readPhoto: (key: string) => ipcRenderer.invoke('nutrition:read-photo', key),
  writePhoto: (key: string, bytes: Uint8Array) => ipcRenderer.invoke('nutrition:write-photo', key, bytes),
  removePhoto: (key: string) => ipcRenderer.invoke('nutrition:remove-photo', key),
  setMealPhoto: (id: string, photoKey: string | null) => ipcRenderer.invoke('nutrition:set-meal-photo', id, photoKey),
  exportPack: () => ipcRenderer.invoke('nutrition:export-pack'),
  importPack: (mode: 'fill-only' | 'overwrite') => ipcRenderer.invoke('nutrition:import-pack', mode)
})
