import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Two-way: invoke and get response
  //
  // Supported invoke channels (non-exhaustive):
  //   news:fetch-batch        — Request { maxItems?: number }, Response { ok, items, fetchedAt } | { ok: false, error }
  //   news:open-reader        — Open / focus NewsReaderWindow
  //   news:insert-to-input    — Params { title, summary, newsId, sourceId }; main relays to InputWindow
  //   news:open-settings-tab  — Open SettingsWindow and navigate to the news tab
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),

  // One-way from renderer to main
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),

  // Subscribe to events pushed from main process.
  // Returns an unsubscribe function — call it to remove the listener (off semantics).
  //
  // Supported event channels (non-exhaustive):
  //   input:insert-news-topic — Payload { text: string, meta: { newsId, sourceId, title } }
  //                             Sent by main when user inserts a news item into the chat input.
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


