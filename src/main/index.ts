import { app, Tray, Menu, nativeImage, protocol } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { loadSettings, saveSettings, loadCharacters, initDefaultCharacters } from './fileStore'
import { initState, registerIpcHandlers } from './ipcHandlers'
import { createCharacterWindow, toggleInputWindow } from './windowManager'

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

  // Register IPC handlers
  registerIpcHandlers()

  // Init in-memory state
  initState(settings, chars, desktopState)

  // Create character windows for all desktop characters
  for (const ds of settings.ui.desktopCharacters) {
    createCharacterWindow(ds.characterId, ds.position, ds.size)
  }

  // System tray
  setupTray(appRoot)
})

app.on('window-all-closed', (e: Event) => {
  e.preventDefault()
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
  tray.setToolTip('Desktop Familiar')

  const menu = Menu.buildFromTemplate([
    { label: '顯示輸入框', click: () => toggleInputWindow() },
    { type: 'separator' },
    { label: '結束', click: () => app.exit(0) }
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => toggleInputWindow())
}
