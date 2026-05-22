import { app, BrowserWindow, type Input } from 'electron'

/** 僅開發／未打包版本允許 DevTools（正式版不註冊快捷鍵）。 */
export function isDevToolsAllowed(): boolean {
  return !app.isPackaged
}

function closeAllDevToolsExcept(keep?: BrowserWindow): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win === keep) continue
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools()
    }
  }
}

/** 切換指定視窗的 DevTools；開啟時關閉其他視窗已開的 DevTools。 */
export function toggleDevToolsForWindow(win: BrowserWindow): void {
  if (!isDevToolsAllowed() || win.isDestroyed()) return
  if (win.webContents.isDevToolsOpened()) {
    win.webContents.closeDevTools()
    return
  }
  closeAllDevToolsExcept(win)
  win.webContents.openDevTools({ mode: 'detach' })
}

function isDevToolsAccelerator(input: Input): boolean {
  if (input.type !== 'keyDown') return false
  if (input.key === 'F12') return true
  const key = input.key?.toLowerCase()
  return !!(input.control && input.shift && key === 'i')
}

/** 僅在該視窗有焦點時攔截 F12 / Ctrl+Shift+I，避免影響其他應用程式。 */
export function attachDevToolsShortcuts(win: BrowserWindow): void {
  if (!isDevToolsAllowed()) return
  win.webContents.on('before-input-event', (event, input) => {
    if (!isDevToolsAccelerator(input)) return
    event.preventDefault()
    toggleDevToolsForWindow(win)
  })
}
