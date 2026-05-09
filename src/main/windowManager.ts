import { BrowserWindow, screen } from 'electron'
import * as path from 'path'

const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']
const DEVTOOLS_ENABLED = process.env['DESKTOPST_DEVTOOLS'] === '1'

function makeURL(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  if (VITE_DEV_SERVER_URL) return `${VITE_DEV_SERVER_URL}?${query}`
  return `file://${path.join(__dirname, '../renderer/index.html')}?${query}`
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function normalizeWindowPosition(
  position: { x: number; y: number },
  size: { width: number; height: number }
): { x: number; y: number } {
  const px = Number.isFinite(position.x) ? position.x : 80
  const py = Number.isFinite(position.y) ? position.y : 80

  const display = screen.getDisplayNearestPoint({ x: px, y: py })
  const wa = display.workArea

  const maxX = wa.x + Math.max(0, wa.width - size.width)
  const maxY = wa.y + Math.max(0, wa.height - size.height)

  return {
    x: clamp(Math.round(px), wa.x, maxX),
    y: clamp(Math.round(py), wa.y, maxY)
  }
}

// ── Character windows ─────────────────────────────────────

const characterWindows = new Map<string, BrowserWindow>()

export function createCharacterWindow(
  characterId: string,
  position: { x: number; y: number },
  size: number
): BrowserWindow {
  const scale = Number.isFinite(size) && size > 0 ? size : 1
  const winSize = {
    width: Math.round(220 * scale),
    height: Math.round(380 * scale)
  }
  const pos = normalizeWindowPosition(position, winSize)

  const win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: winSize.width,
    height: winSize.height,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setIgnoreMouseEvents(false)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(makeURL({ w: 'character', id: characterId, size: String(scale) }))
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'character', id: characterId, size: String(scale) }
    })
  }

  characterWindows.set(characterId, win)
  win.on('closed', () => characterWindows.delete(characterId))
  // DevTools is opt-in to avoid UI overlays (inspect/rulers) interfering with the pet window.
  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    win.webContents.openDevTools({ mode: 'detach' })
  }
  return win
}

export function getCharacterWindow(characterId: string): BrowserWindow | undefined {
  return characterWindows.get(characterId)
}

export function setCharacterWindowClickThrough(characterId: string, clickThrough: boolean): boolean {
  const win = getCharacterWindow(characterId)
  if (!win || win.isDestroyed()) return false
  // forward: even when ignoring, still forward mouse move for hover effects where supported
  win.setIgnoreMouseEvents(clickThrough, { forward: true })
  return true
}

export function getAllCharacterWindows(): BrowserWindow[] {
  return [...characterWindows.values()]
}

export function closeCharacterWindow(characterId: string): void {
  const win = characterWindows.get(characterId)
  if (win && !win.isDestroyed()) win.close()
}

// ── Input window ──────────────────────────────────────────

let inputWindow: BrowserWindow | null = null

export function createInputWindow(position: { x: number; y: number }): BrowserWindow {
  if (inputWindow && !inputWindow.isDestroyed()) {
    inputWindow.focus()
    return inputWindow
  }

  inputWindow = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: 400,
    height: 160,
    frame: false,
    transparent: false,
    backgroundColor: '#F7FFFC',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // Higher than character alwaysOnTop windows
  inputWindow.setAlwaysOnTop(true, 'pop-up-menu')

  if (VITE_DEV_SERVER_URL) {
    inputWindow.loadURL(makeURL({ w: 'input' }))
  } else {
    inputWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'input' }
    })
  }

  inputWindow.on('closed', () => { inputWindow = null })
  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    inputWindow.webContents.openDevTools({ mode: 'detach' })
  }
  inputWindow.show()
  inputWindow.focus()
  return inputWindow
}

export function toggleInputWindow(position?: { x: number; y: number }): void {
  if (!inputWindow || inputWindow.isDestroyed()) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    createInputWindow(position ?? { x: Math.round(width / 2 - 200), y: Math.round(height - 200) })
    return
  }
  if (inputWindow.isVisible()) {
    inputWindow.hide()
  } else {
    inputWindow.show()
    inputWindow.focus()
  }
}

export function getInputWindow(): BrowserWindow | null {
  return inputWindow && !inputWindow.isDestroyed() ? inputWindow : null
}

// ── Log window ────────────────────────────────────────────

let logWindow: BrowserWindow | null = null

export function toggleLogWindow(): void {
  if (!logWindow || logWindow.isDestroyed()) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    logWindow = new BrowserWindow({
      x: Math.round(width / 2 - 280),
      y: 80,
      width: 560,
      height: Math.round(height * 0.7),
      frame: false,
      transparent: false,
      backgroundColor: '#F7FFFC',
      skipTaskbar: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    logWindow.setAlwaysOnTop(true, 'pop-up-menu')
    if (VITE_DEV_SERVER_URL) {
      logWindow.loadURL(makeURL({ w: 'log' }))
    } else {
      logWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
        query: { w: 'log' }
      })
    }
    logWindow.on('closed', () => { logWindow = null })
    logWindow.show()
    logWindow.focus()
    return
  }
  if (logWindow.isVisible()) logWindow.hide()
  else {
    logWindow.show()
    logWindow.focus()
    logWindow.setAlwaysOnTop(true, 'pop-up-menu')
  }
}

export function getLogWindow(): BrowserWindow | null {
  return logWindow && !logWindow.isDestroyed() ? logWindow : null
}

// ── Settings window ───────────────────────────────────────

let settingsWindow: BrowserWindow | null = null

export function openSettingsWindow(tab?: string): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isVisible()) {
      settingsWindow.hide()
    } else {
      settingsWindow.show()
      settingsWindow.focus()
    }
    return
  }
  const { width } = screen.getPrimaryDisplay().workAreaSize
  settingsWindow = new BrowserWindow({
    x: Math.round(width / 2 - 340),
    y: 80,
    width: 680,
    height: 580,
    frame: false,
    transparent: false,
    backgroundColor: '#F7FFFC',
    skipTaskbar: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  settingsWindow.setAlwaysOnTop(true, 'pop-up-menu')
  const query: Record<string, string> = { w: 'settings' }
  if (tab) query.tab = tab
  if (VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(makeURL(query))
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  }
  settingsWindow.on('closed', () => { settingsWindow = null })
  if (VITE_DEV_SERVER_URL && DEVTOOLS_ENABLED) {
    settingsWindow.webContents.openDevTools({ mode: 'detach' })
  }
  settingsWindow.show()
  settingsWindow.focus()
}

// ── Broadcast to all windows ──────────────────────────────

export function broadcastToAll(channel: string, data: unknown): void {
  const wins = [
    ...characterWindows.values(),
    inputWindow,
    logWindow,
    settingsWindow
  ].filter(w => w && !w.isDestroyed()) as BrowserWindow[]
  for (const w of wins) w.webContents.send(channel, data)
}
