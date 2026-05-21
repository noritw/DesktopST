import { app, Tray, Menu, nativeImage, protocol, screen, shell, BrowserWindow, globalShortcut } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { loadSettings, saveSettings, flushSaveSettings, loadCharacters, initDefaultCharacters, initDefaultPresets, loadPersonaPresets, loadWorldPresets } from './fileStore'
import { initState, registerIpcHandlers, dismissAllAuxWindows, restoreDismissedAuxWindows, hasDismissedAuxWindows, getSettings, triggerReminderSpeak } from './ipcHandlers'
import { checkForUpdates } from './updateChecker'
import { initReminderScheduler } from './reminderScheduler'
import {
  createCharacterWindow,
  createCharacterLibraryWindow,
  toggleInputWindow,
  broadcastToAll,
  hideAuxWindowsRememberingState,
  restoreAuxWindowsFromRememberedState,
  isCursorOverInteractiveCharacter,
  shouldSuppressAuxAutoHide,
  openSettingsWindow,
  openPinnedNotesManager,
  openRemindersManager,
  getCharacterWindowSize,
  suppressAuxAutoHide,
  setCharactersAlwaysOnTop,
  getCharactersAlwaysOnTop,
  destroyAllCharacterWindows
} from './windowManager'

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

  const appRoot = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : app.getAppPath()

  // Load settings
  const settings = loadSettings()

  // Init default characters if first run
  const existingChars = loadCharacters()
  let chars = existingChars
  let desktopState = settings.ui.desktopCharacters

  if (existingChars.length === 0) {
    const result = await initDefaultCharacters(appRoot)
    chars = result.chars
    desktopState = result.desktopState
    if (desktopState.length > 0) {
      settings.ui.desktopCharacters = desktopState
      saveSettings(settings)
    }
  }
  // Init default presets if first run
  const { personas, worlds } = initDefaultPresets(appRoot)
  if (!settings.activePersonaId && personas.length > 0) {
    settings.activePersonaId = personas[0].id
    saveSettings(settings)
  }
  if (!settings.activeWorldId && worlds.length > 0) {
    settings.activeWorldId = worlds[0].id
    saveSettings(settings)
  }

  // Filter out desktop entries whose character card no longer exists
  if (chars.length > 0 && desktopState.length > 0) {
    const charIds = new Set(chars.map(c => c.id))
    const valid = desktopState.filter(ds => charIds.has(ds.characterId))
    if (valid.length !== desktopState.length) {
      desktopState = valid
      settings.ui.desktopCharacters = valid
      saveSettings(settings)
    }
  }

  // Safety: if we have characters but none on desktop, put at least one on.
  if (chars.length > 0 && (!desktopState || desktopState.length === 0)) {
    desktopState = [{
      characterId: chars[0].id,
      position: { x: 80, y: 400 },
      size: 1,
      flipped: false,
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

  // Init reminder scheduler (after state is ready)
  initReminderScheduler(triggerReminderSpeak)

  // Version check on startup (5s delay so UI is ready first)
  setTimeout(() => {
    const s = getSettings()
    if (s.updates?.checkOnStartup !== false) {
      void checkForUpdates({ silent: true, dismissedVersion: s.updates?.dismissedVersion }).then(result => {
        if (result.dismissed && result.latestVersion) {
          s.updates = { ...s.updates, dismissedVersion: result.latestVersion }
          saveSettings(s)
          broadcastToAll('settings:updated', s)
        }
      })
    }
  }, 5000)

  // Create character windows for all desktop characters
  let didFixOffscreen = false
  for (const ds of settings.ui.desktopCharacters) {
    const scale = Number.isFinite(ds.size) && ds.size > 0 ? ds.size : 1
    const win = getCharacterWindowSize(scale)
    if (isOffscreen(ds.position, win)) {
      ds.position = centerInPrimary(win)
      didFixOffscreen = true
    }
    createCharacterWindow(ds.characterId, ds.position, ds.size)
  }
  if (didFixOffscreen) saveSettings(settings)

  const noCharacters = chars.length === 0
  const onboardingPending = settings.ui.onboardingCompleted === false

  // 只在「真的需要設定」時強制開啟設定視窗
  // 無 API Key 時允許先操作，在對話時再提示
  if (noCharacters || onboardingPending) {
    suppressAuxAutoHide(5000)
    setImmediate(() => {
      openSettingsWindow(onboardingPending ? 'llm' : 'general')
    })
  }

  // 註冊開發者工具快捷鍵
  if (!app.isPackaged) {
    globalShortcut.register('F12', () => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed() && win.webContents) {
          if (win.webContents.isDevToolsOpened()) {
            win.webContents.closeDevTools()
          } else {
            win.webContents.openDevTools({ mode: 'detach' })
          }
        }
      })
    })

    globalShortcut.register('CmdOrCtrl+Shift+I', () => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed() && win.webContents) {
          if (win.webContents.isDevToolsOpened()) {
            win.webContents.closeDevTools()
          } else {
            win.webContents.openDevTools({ mode: 'detach' })
          }
        }
      })
    })
  }

  // System tray
  setupTray(appRoot)
})

// When app loses focus to another application, hide all auxiliary UI to reduce distractions.
let blurTimer: NodeJS.Timeout | null = null
app.on('browser-window-blur', () => {
  if (blurTimer) clearTimeout(blurTimer)
  blurTimer = setTimeout(() => {
    // If we still don't have a focused window, the user has switched to another app.
    const anyFocusedWindow = BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && w.isFocused())
    if (!anyFocusedWindow && !isCursorOverInteractiveCharacter() && !shouldSuppressAuxAutoHide()) {
      hideAuxWindowsRememberingState()
      broadcastToAll('ui:app-focus', { focused: false })
    }
  }, 260)
})

app.on('browser-window-focus', () => {
  if (blurTimer) { clearTimeout(blurTimer); blurTimer = null }
  restoreAuxWindowsFromRememberedState()
  broadcastToAll('ui:app-focus', { focused: true })
})

app.on('window-all-closed', () => {
  // Do nothing — keep app running in tray
})

app.on('before-quit', () => {
  flushSaveSettings()
})

// ── System tray ───────────────────────────────────────────

function setupTray(appRoot: string) {
  const trayCandidates = ['AppIcon_16x16.png', 'Icon16x16.png', 'icon.png', 'icon.ico'].map(f => path.join(appRoot, 'assets', f))
  let iconPath = trayCandidates.find(p => fs.existsSync(p)) ?? ''

  const icon = iconPath && fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty()

  const tray = new Tray(icon)
  tray.setToolTip('DesktopST')

  const refreshTrayMenu = () => {
    const auxAction = hasDismissedAuxWindows()
      ? { label: '重新開啟所有輔助視窗', click: () => { restoreDismissedAuxWindows(); refreshTrayMenu() } }
      : { label: '收起所有輔助視窗', click: async () => { await dismissAllAuxWindows(); refreshTrayMenu() } }
    const isAlwaysOnTop = getCharactersAlwaysOnTop()
    const menu = Menu.buildFromTemplate([
      { label: '開啟輸入視窗', click: () => toggleInputWindow() },
      { label: '開啟角色庫', click: () => createCharacterLibraryWindow({ mode: 'home' }) },
      { label: '開啟便利貼管理', click: () => openPinnedNotesManager() },
      { label: '管理提醒', click: () => openRemindersManager() },
      auxAction,
      { type: 'separator' },
      {
        label: '角色保持在最上層',
        type: 'checkbox',
        checked: isAlwaysOnTop,
        click: () => {
          const next = !getCharactersAlwaysOnTop()
          const s = getSettings()
          s.ui.alwaysOnTop = next
          setCharactersAlwaysOnTop(next)
          saveSettings(s)
          broadcastToAll('settings:updated', s)
          refreshTrayMenu()
        }
      },
      { type: 'separator' },
      { label: '開啟設定', click: () => openSettingsWindow('llm') },
      {
        label: '檢查更新',
        click: () => {
          const s = getSettings()
          void checkForUpdates({ silent: false, dismissedVersion: s.updates?.dismissedVersion }).then(result => {
            if (result.dismissed && result.latestVersion) {
              s.updates = { ...s.updates, dismissedVersion: result.latestVersion }
              saveSettings(s)
              broadcastToAll('settings:updated', s)
            }
          })
        }
      },
      {
        label: '新手教學',
        click: () => {
          const guideFile = app.isPackaged
            ? path.join(process.resourcesPath, '../docs/getting-started.html')
            : path.join(app.getAppPath(), 'docs/getting-started.html')
          void shell.openPath(guideFile)
        }
      },
      { type: 'separator' },
      {
        label: '修復角色視窗（重建桌面）',
        click: () => {
          const s = getSettings()
          destroyAllCharacterWindows()
          for (const d of s.ui.desktopCharacters) {
            createCharacterWindow(d.characterId, d.position, d.size)
          }
          broadcastToAll('desktop:updated', s.ui.desktopCharacters)
        }
      },
      { type: 'separator' },
      { label: '結束', click: () => app.quit() }
    ])
    tray.setContextMenu(menu)
  }

  refreshTrayMenu()
  tray.on('click', () => toggleInputWindow())
}
