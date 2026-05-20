import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Two-way: invoke and get response
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),

  // One-way from renderer to main
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),

  // Subscribe to events pushed from main process
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const sub = (_: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, sub)
    return () => ipcRenderer.removeListener(channel, sub)
  },

  // One-time listener
  once: (channel: string, callback: (...args: unknown[]) => void) => {
    ipcRenderer.once(channel, (_, ...args) => callback(...args))
  }
})

// Expose window location params
contextBridge.exposeInMainWorld('windowParams', {
  get: (key: string): string | null => new URLSearchParams(window.location.search).get(key)
})

// 暴露建置環境資訊（dev server URL 供音效等靜態資源使用）
contextBridge.exposeInMainWorld('electronBuild', {
  rendererUrl: process.env['ELECTRON_RENDERER_URL'] ?? null
})


