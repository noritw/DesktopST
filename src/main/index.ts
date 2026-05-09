import { app, Tray, Menu, nativeImage, protocol, screen } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { loadSettings, saveSettings, loadCharacters, initDefaultCharacters } from './fileStore'
import { initState, registerIpcHandlers } from './ipcHandlers'
import { createCharacterWindow, toggleInputWindow } from './windowManager'

function isOffscreen(pos: { x: number; y: number }, win: { width: number; height: number }): boolean {
  const px = Number.isFinite(pos.x) ? pos.x : 0
  const py = Number.isFinite(pos.y) ? pos.y : 0
  const rect = { x: px, y: py, w: win.width, h: win.height }
  const displays = screen.getAllDisplays()
  return !displays.some(d => {
    const wa = d.workArea
    // Intersect test
    const x1 = Math.max(rect.x, wa.x)
    const y1 = Math.max(rect.y, wa.y)
    const x2 = Math.min(rect.x + rect.w, wa.x + wa.width)
    const y2 = Math.min(rect.y + rect.h, wa.y + wa.height)
    return x2 > x1 && y2 > y1
  })
}

function centerInPrimary(win: { width: number; height: number }): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea
  return {
    x: Math.round(wa.x + (wa.width - win.width) / 2),
    y: Math.round(wa.y + (wa.height - win.height) / 2)
  }
}

// ── App lifecycle ─────────────────────────────────────────

app.on('ready', async () => {
  // Register local:// file protocol before any window loads
  protocol.registerFileProtocol('local', (request, callback) => {
    const raw = request.url.slice('local://'.length)
    callback({ path: decodeURIComponent(raw) })
  })

  const appRoot = app.getAppPath()

  // Load settings
  const settings = loadSettings()

  // Init default characters if first run
  const existingChars = loadCharacters()
  let chars = existingChars
  let desktopState = settings.ui.desktopCharacters

  if (existingChars.length === 0) {
    const result = initDefaultCharacters(appRoot)
    chars = result.chars
    desktopState = result.desktopState
    if (desktopState.length > 0) {
      settings.ui.desktopCharacters = desktopState
      saveSettings(settings)
    }
  }
  // Safety: if we have characters but none on desktop, put at least one on.
  if (chars.length > 0 && (!desktopState || desktopState.length === 0)) {
    desktopState = [{
      characterId: chars[0].id,
      position: { x: 80, y: 400 },
      size: 1,
      muted: false,
      zIndex: 1
    }]
    settings.ui.desktopCharacters = desktopState
    saveSettings(settings)
  }

  // Register IPC handlers
  registerIpcHandlers()

  // Init in-memory state
  initState(settings, chars, desktopState)

  // Create character windows for all desktop characters
  let didFixOffscreen = false
  for (const ds of settings.ui.desktopCharacters) {
    const scale = Number.isFinite(ds.size) && ds.size > 0 ? ds.size : 1
    const win = { width: Math.round(220 * scale), height: Math.round(380 * scale) }
    if (isOffscreen(ds.position, win)) {
      ds.position = centerInPrimary(win)
      didFixOffscreen = true
    }
    createCharacterWindow(ds.characterId, ds.position, ds.size)
  }
  if (didFixOffscreen) saveSettings(settings)

  // System tray
  setupTray(appRoot)
})

app.on('window-all-closed', () => {
  // Do nothing — keep app running in tray
})

app.on('before-quit', () => {
  app.exit(0)
})

// ── System tray ───────────────────────────────────────────

function setupTray(appRoot: string) {
  let iconPath = path.join(appRoot, 'assets', 'KT_default.png')
  if (!fs.existsSync(iconPath)) iconPath = ''

  const icon = iconPath && fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty()

  const tray = new Tray(icon)
  tray.setToolTip('DesktopST')

  const menu = Menu.buildFromTemplate([
    { label: '顯示輸入框', click: () => toggleInputWindow() },
    { type: 'separator' },
    { label: '結束', click: () => app.exit(0) }
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => toggleInputWindow())
}
