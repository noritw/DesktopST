import { BrowserWindow, screen } from 'electron'
import * as path from 'path'

const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL']

function makeURL(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  if (VITE_DEV_SERVER_URL) return `${VITE_DEV_SERVER_URL}?${query}`
  return `file://${path.join(__dirname, '../renderer/index.html')}?${query}`
}

// ── Character windows ─────────────────────────────────────

const characterWindows = new Map<string, BrowserWindow>()

export function createCharacterWindow(
  characterId: string,
  position: { x: number; y: number },
  size: number
): BrowserWindow {
  const win = new BrowserWindow({
    x: position.x,
    y: position.y,
    width: Math.round(220 * size),
    height: Math.round(380 * size),
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

  win.setIgnoreMouseEvents(true, { forward: true })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(makeURL({ w: 'character', id: characterId }))
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'character', id: characterId }
    })
  }

  characterWindows.set(characterId, win)
  win.on('closed', () => characterWindows.delete(characterId))
  return win
}

export function getCharacterWindow(characterId: string): BrowserWindow | undefined {
  return characterWindows.get(characterId)
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
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (VITE_DEV_SERVER_URL) {
    inputWindow.loadURL(makeURL({ w: 'input' }))
  } else {
    inputWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      query: { w: 'input' }
    })
  }

  inputWindow.on('closed', () => { inputWindow = null })
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
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    if (VITE_DEV_SERVER_URL) {
      logWindow.loadURL(makeURL({ w: 'log' }))
    } else {
      logWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
        query: { w: 'log' }
      })
    }
    logWindow.on('closed', () => { logWindow = null })
    return
  }
  if (logWindow.isVisible()) logWindow.hide()
  else { logWindow.show(); logWindow.focus() }
}

export function getLogWindow(): BrowserWindow | null {
  return logWindow && !logWindow.isDestroyed() ? logWindow : null
}

// ── Settings window ───────────────────────────────────────

let settingsWindow: BrowserWindow | null = null

export function openSettingsWindow(tab?: string): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
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
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const query: Record<string, string> = { w: 'settings' }
  if (tab) query.tab = tab
  if (VITE_DEV_SERVER_URL) {
    settingsWindow.loadURL(makeURL(query))
  } else {
    settingsWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  }
  settingsWindow.on('closed', () => { settingsWindow = null })
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
